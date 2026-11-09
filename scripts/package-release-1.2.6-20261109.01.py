#!/usr/bin/env python3
import os
import sys
import json
import hashlib
import tarfile
import subprocess
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent
target_dir = repo_root / 'output' / 'release-1.2.6-20261109.01'
target_dir.mkdir(parents=True, exist_ok=True)

version = '1.2.6'
build = '20261109.01'
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo_root, text=True).strip()

print(f"Packaging release {version}-{build} from commit {commit}...")

# 1. Package git-tracked files into source.tar.gz
archive_path = target_dir / 'source.tar.gz'
files = subprocess.check_output(['git', 'ls-files'], cwd=repo_root, text=True).splitlines()

# Filter files to guarantee no sensitive data or build caches
valid_files = []
for f in files:
    p = Path(f)
    if p.parts[0] in ('data', '.git', 'node_modules', '.superpowers', 'output'):
        continue
    if p.name.startswith('.env') and not p.name.endswith('.example'):
        continue
    if p.suffix in ('.keystore', '.jks', '.db'):
        continue
    valid_files.append(f)

# Also ensure any modified files tracked by git are included from disk
with tarfile.open(archive_path, 'w:gz') as tar:
    for f in sorted(valid_files):
        tar.add(repo_root / f, arcname=f)

archive_bytes = archive_path.read_bytes()
archive_sha256 = hashlib.sha256(archive_bytes).hexdigest()

manifest = {
    'version': version,
    'build': build,
    'commit': commit,
    'archiveSha256': archive_sha256,
    'files': len(valid_files),
    'privateDataIncluded': False
}
(target_dir / 'source-manifest.json').write_text(json.dumps(manifest, indent=2))
print(f"source.tar.gz created: {len(archive_bytes)} bytes, sha256: {archive_sha256}")

# 2. Copy prod-data-audit.cjs
audit_script = (repo_root / 'output' / 'release-1.2.6-20261108.01' / 'prod-data-audit.cjs').read_text()
(target_dir / 'prod-data-audit.cjs').write_text(audit_script)

# 3. Create prepare-backup.py
prepare_py = f'''import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile

container = 'kaogong-potato-app'
release_root = Path('/home/ubuntu/kaogong-releases/{version}-{build}')
release_root.mkdir(parents=True, exist_ok=True, mode=0o700)
release_root.chmod(0o700)
info = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
assert info['Config']['Image'] == 'kaogong-potato-app:1.2.6-20261108.12'
assert info['State']['Status'] == 'running'
assert info['State'].get('Health', {{}}).get('Status') == 'healthy'
mounts = [m for m in info['Mounts'] if m['Destination'] == '/app/data']
assert len(mounts) == 1
assert mounts[0]['Source'] == '/home/ubuntu/kaogong-app/data'
assert mounts[0]['RW']
assert info['HostConfig']['PortBindings']['3000/tcp'] == [{{'HostIp': '127.0.0.1', 'HostPort': '3000'}}]
private_snapshot = release_root / 'previous-container.private.json'
if private_snapshot.exists():
    private_snapshot.unlink()
fd = os.open(private_snapshot, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as f:
    json.dump(info, f)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d_%H%M%S')
name = 'backup_predeploy_{version}_' + stamp
data = Path(mounts[0]['Source'])
target = data / 'backups' / name
assert not target.exists()
subprocess.run(['docker', 'exec', container, 'node', '--import', 'tsx', 'server/cli.ts', 'hot-backup', '/app/data/backups/' + name], check=True)
manifest = json.loads((target / 'manifest.json').read_text())
database = target / 'potato.db'
assert database.stat().st_size == manifest['database']['byteSize']
assert hashlib.sha256(database.read_bytes()).hexdigest() == manifest['database']['sha256']
for attachment in manifest['attachments']:
    assert Path(attachment['filename']).name == attachment['filename']
    file = target / 'attachments' / attachment['filename']
    assert file.stat().st_size == attachment['byteSize']
    assert hashlib.sha256(file.read_bytes()).hexdigest() == attachment['sha256']
archive = Path(str(target) + '.tar.gz')
assert not archive.exists()
with tarfile.open(archive, 'w:gz') as f:
    f.add(target, arcname=name)
archive.chmod(0o600)
summary = {{'archive': str(archive), 'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
    'backup': str(target), 'generation': manifest['generationId'], 'attachments': manifest['attachmentsCount'],
    'databaseBytes': database.stat().st_size, 'oldImage': info['Config']['Image'], 'oldImageId': info['Image'],
    'releaseRoot': str(release_root)}}
(release_root / 'predeploy.json').write_text(json.dumps(summary, indent=2))
print(json.dumps(summary, indent=2))
'''
(target_dir / 'prepare-backup.py').write_text(prepare_py)

# 4. Create stage-release.py
stage_py = f'''import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import time
import urllib.request
import urllib.error

root = Path('/home/ubuntu/kaogong-releases/{version}-{build}')
meta = json.loads((root / 'source-manifest.json').read_text())
assert meta['version'] == '{version}' and meta['build'] == '{build}'
archive = root / 'source.tar.gz'
assert hashlib.sha256(archive.read_bytes()).hexdigest() == meta['archiveSha256']
source = root / 'source'
if source.exists():
    import shutil
    shutil.rmtree(source)
source.mkdir(mode=0o700)
with tarfile.open(archive, 'r:gz') as tar:
    for member in tar.getmembers():
        p = Path(member.name)
        assert not p.is_absolute() and '..' not in p.parts
        assert p.parts[0] not in ('data', '.git', 'node_modules', '.superpowers', 'output')
        assert not p.name.startswith('.env') or p.name.endswith('.example')
        assert p.suffix not in ('.keystore', '.jks', '.db')
    tar.extractall(source, filter='data')
release = json.loads((source / 'release.json').read_text())
assert (release['webVersion'], release['webBuild'], release['schemaVersion']) == ('{version}', '{build}', 5)
image = 'kaogong-potato-app:{version}-{build}'
print('Starting docker build for', image)
with (root / 'build.log').open('w') as log:
    build = subprocess.run(['docker', 'build', '--pull=false', '-t', image, str(source)], stdout=log, stderr=subprocess.STDOUT)
if build.returncode:
    print('\\n'.join((root / 'build.log').read_text().splitlines()[-30:]))
    raise RuntimeError('Image build failed')
image_id = subprocess.check_output(['docker', 'image', 'inspect', '--format', '{{{{.Id}}}}', image], text=True).strip()
smoke_data = root / 'smoke-data'
if not smoke_data.exists():
    smoke_data.mkdir(mode=0o700)
smoke_name = 'kaogong-potato-smoke-{version}-{build}'
subprocess.run(['docker', 'rm', '-f', smoke_name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.run(['docker', 'run', '-d', '--name', smoke_name, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--cpus', '1', '--memory', '512m', '--memory-swap', '512m', '-p', '127.0.0.1:3001:3000', '--mount', 'type=bind,src=' + str(smoke_data) + ',dst=/app/data',
    '-e', 'NODE_ENV=production', '-e', 'DATA_DIR=/app/data', image], check=True, stdout=subprocess.DEVNULL)
def fetch(route):
    with urllib.request.urlopen('http://127.0.0.1:3001' + route, timeout=5) as r:
        return r.status, r.read()
try:
    for attempt in range(50):
        try:
            status, health = fetch('/api/health')
            health = json.loads(health)
            if status == 200 and health['status'] == 'healthy':
                break
        except (OSError, ValueError):
            pass
        time.sleep(1)
    else:
        raise RuntimeError('Isolated image did not become healthy')
    status, body = fetch('/version.json')
    version_json = json.loads(body)
    assert (version_json['version'], version_json['build']) == ('{version}', '{build}')
    status, sw = fetch('/sw.js')
    assert f"RELEASE_VERSION = '{version}'".encode() in sw and f"RELEASE_BUILD = '{build}'".encode() in sw
    status, html = fetch('/')
    assert status == 200 and b'<div id="root">' in html
    status, apk = fetch('/api/download/apk')
    assert len(apk) == release['apkSizeBytes']
    assert hashlib.sha256(apk).hexdigest() == release['apkSha256']
    try:
        fetch('/api/auth/me')
        raise RuntimeError('Anonymous auth check should be unauthorized')
    except urllib.error.HTTPError as error:
        assert error.code == 401
    with (root / 'linux-process-gate.log').open('w') as gate_log:
        lifecycle = subprocess.run(['docker', 'run', '--rm', '--cpus', '1', '--memory', '512m', '--memory-swap', '512m', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--mount', 'type=bind,src=' + str(source / 'tests') + ',dst=/app/tests,readonly', image, 'node', '--import', 'tsx', '--test', 'tests/image-orientation-service.test.ts', 'tests/image-orientation-shutdown-server.test.ts'], stdout=gate_log, stderr=subprocess.STDOUT)
    assert lifecycle.returncode == 0, 'Linux lifecycle gate failed; inspect release log'
    inspect = json.loads(subprocess.check_output(['docker', 'inspect', smoke_name]))[0]
    assert not inspect['State']['OOMKilled'] and inspect['RestartCount'] == 0
    assert inspect['HostConfig']['Memory'] == 536870912 and inspect['HostConfig']['NanoCpus'] == 1000000000
    result = {{'isolatedRuntimeGate': True, 'linuxLifecycleGate': True, 'memoryLimit': 536870912, 'cpuLimit': 1, 'image': image, 'imageId': image_id, 'commit': meta['commit'], 'version': version_json['version'],
        'build': version_json['build'], 'isolatedHealth': health['status'], 'apkSha256': release['apkSha256'],
        'smokeContainer': smoke_name, 'productionDataMounted': False}}
    (root / 'staging-result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
finally:
    subprocess.run(['docker', 'stop', '--time', '10', smoke_name], stdout=subprocess.DEVNULL)
    subprocess.run(['docker', 'rm', '-f', smoke_name], stdout=subprocess.DEVNULL)
'''
(target_dir / 'stage-release.py').write_text(stage_py)

# 5. Create switch-release.py
switch_py = f'''import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import time
import urllib.request

root = Path('/home/ubuntu/kaogong-releases/{version}-{build}')
old = json.loads((root / 'previous-container.private.json').read_text())
staged = json.loads((root / 'staging-result.json').read_text())
image = staged['image']
assert subprocess.check_output(['docker', 'image', 'inspect', '--format', '{{{{.Id}}}}', image], text=True).strip() == staged['imageId']
primary = 'kaogong-potato-app'
current = json.loads(subprocess.check_output(['docker', 'inspect', primary]))[0]
assert current['Id'] == old['Id'] and current['Image'] == old['Image']
assert current['State']['Running'] and current['State']['Health']['Status'] == 'healthy'
assert current['Mounts'] == old['Mounts']
env_values = lambda values: dict(entry.split('=', 1) for entry in values)
assert env_values(current['Config']['Env']) == env_values(old['Config']['Env'])
mount = next(m for m in old['Mounts'] if m['Destination'] == '/app/data')
assert mount['Source'] == '/home/ubuntu/kaogong-app/data'
candidate = 'kaogong-potato-app-next-{version}-{build}'
previous = 'kaogong-potato-app-prev-1.2.6-20261108.12'
for name in [candidate, previous]:
    subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
env_file = root / 'runtime.private.env'
if env_file.exists():
    env_file.unlink()
fd = os.open(env_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as f:
    for entry in old['Config']['Env']:
        assert '\\n' not in entry and '\\r' not in entry
        f.write(entry + '\\n')
host = old['HostConfig']
assert host['NetworkMode'] in ('default', 'bridge')
assert len(old['Mounts']) == 1
args = ['docker', 'create', '--name', candidate, '--env-file', str(env_file), '--user', old['Config']['User'] or 'node',
    '--restart', host['RestartPolicy']['Name'], '-p', '127.0.0.1:3000:3000',
    '--mount', 'type=bind,src=' + mount['Source'] + ',dst=/app/data']
for cap in host.get('CapDrop') or []:
    args += ['--cap-drop', cap]
for opt in host.get('SecurityOpt') or []:
    args += ['--security-opt', opt]
logging = host['LogConfig']
args += ['--log-driver', logging['Type']]
for k, v in logging['Config'].items():
    args += ['--log-opt', k + '=' + v]
if host.get('ReadonlyRootfs'):
    args += ['--read-only']
for field, flag in [('Memory', '--memory'), ('NanoCpus', '--cpus'), ('PidsLimit', '--pids-limit')]:
    val = host.get(field)
    if val and val > 0:
        args += [flag, str(val / 1e9 if field == 'NanoCpus' else val)]
args.append(image)
subprocess.run(args, check=True, stdout=subprocess.DEVNULL)
audit = (root / 'prod-data-audit.cjs').read_text()
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d_%H%M%S')
backup_name = 'backup_stop_{version}_' + stamp
backup = Path(mount['Source']) / 'backups' / backup_name
assert not backup.exists()
stopped = False
renamed = False
new_started = False
try:
    subprocess.run(['docker', 'stop', '--time', '30', primary], check=True, stdout=subprocess.DEVNULL)
    stopped = True
    subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
        '--mount', 'type=bind,src=' + mount['Source'] + ',dst=/app/data', '-e', 'DATA_DIR=/app/data', old['Image'],
        'node', '--import', 'tsx', 'server/cli.ts', 'hot-backup', '/app/data/backups/' + backup_name], check=True)
    before = json.loads(subprocess.check_output(['docker', 'run', '--rm', '-i', '--network', 'none',
        '--mount', 'type=bind,src=' + mount['Source'] + ',dst=/app/data', '-e', 'DATA_DIR=/app/data', old['Image'], 'node'], input=audit, text=True))
    (root / 'data-frozen-before.json').write_text(json.dumps(before, indent=2))
    manifest = json.loads((backup / 'manifest.json').read_text())
    db_file = backup / 'potato.db'
    assert db_file.stat().st_size == manifest['database']['byteSize']
    assert hashlib.sha256(db_file.read_bytes()).hexdigest() == manifest['database']['sha256']
    for attachment in manifest['attachments']:
        assert Path(attachment['filename']).name == attachment['filename']
        attachment_file = backup / 'attachments' / attachment['filename']
        assert attachment_file.stat().st_size == attachment['byteSize']
        assert hashlib.sha256(attachment_file.read_bytes()).hexdigest() == attachment['sha256']
    archive = Path(str(backup) + '.tar.gz')
    assert not archive.exists()
    with tarfile.open(archive, 'w:gz') as tar:
        tar.add(backup, arcname=backup_name)
    archive.chmod(0o600)
    subprocess.run(['docker', 'rename', primary, previous], check=True)
    renamed = True
    subprocess.run(['docker', 'rename', candidate, primary], check=True)
    subprocess.run(['docker', 'start', primary], check=True, stdout=subprocess.DEVNULL)
    new_started = True
    for attempt in range(50):
        try:
            with urllib.request.urlopen('http://127.0.0.1:3000/api/health', timeout=5) as r:
                health = json.load(r)
            with urllib.request.urlopen('http://127.0.0.1:3000/version.json', timeout=5) as r:
                version_json = json.load(r)
            if health['status'] == 'healthy' and (version_json['version'], version_json['build']) == ('{version}', '{build}'):
                break
        except (OSError, ValueError):
            pass
        time.sleep(1)
    else:
        raise RuntimeError('New production container failed readiness checks')
    after = json.loads(subprocess.check_output(['docker', 'exec', '-i', primary, 'node'], input=audit, text=True))
    (root / 'data-after.json').write_text(json.dumps(after, indent=2))
    for key in ['generation', 'counts', 'workspaceTotals', 'workspaceDigest', 'attachmentAudit']:
        assert before[key] == after[key], 'Data acceptance mismatch: ' + key
    assert after['integrity'] == ['ok'] and after['foreignKeyErrors'] == 0
    new = json.loads(subprocess.check_output(['docker', 'inspect', primary]))[0]
    mount_values = lambda mounts: sorted((m['Type'], m['Source'], m['Destination'], m['RW']) for m in mounts)
    assert new['Image'] == staged['imageId'] and mount_values(new['Mounts']) == mount_values(old['Mounts'])
    assert env_values(new['Config']['Env']) == env_values(old['Config']['Env'])
    result = {{'version': version_json['version'], 'build': version_json['build'], 'image': image, 'imageId': staged['imageId'],
        'commit': staged['commit'], 'health': health['status'], 'generation': health['generationId'],
        'dataPreserved': True, 'counts': after['counts'], 'workspaceTotals': after['workspaceTotals'],
        'attachmentAudit': after['attachmentAudit'], 'previousContainer': previous,
        'finalBackup': str(backup), 'finalArchive': str(archive), 'finalArchiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
        'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}}
    (root / 'deployment-result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
except BaseException:
    if new_started:
        subprocess.run(['docker', 'stop', '--time', '15', primary], stdout=subprocess.DEVNULL)
        subprocess.run(['docker', 'rename', primary, 'kaogong-potato-app-failed-{version}-{build}'], check=True)
    elif renamed:
        candidate_info = subprocess.run(['docker', 'inspect', primary], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if candidate_info.returncode == 0:
            subprocess.run(['docker', 'rename', primary, 'kaogong-potato-app-failed-{version}-{build}'], check=True)
    if renamed:
        subprocess.run(['docker', 'rename', previous, primary], check=True)
    if stopped:
        subprocess.run(['docker', 'start', primary], check=True, stdout=subprocess.DEVNULL)
    print('Production switch failed; previous container restart attempted; data volume retained.')
    raise
'''
(target_dir / 'switch-release.py').write_text(switch_py)

print("Release packaging complete.")
