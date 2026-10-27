#!/usr/bin/env python3
"""
Cross-process & cross-container data directory maintenance lock helper using POSIX fcntl.flock.

Usage: python3 scripts/lib/data-lock.py <canonicalDataDir> <shared|exclusive>
Exit codes:
  0: Clean release upon stdin EOF
  2: DATA_LOCK_BUSY (lock held by another process)
  3: DATA_LOCK_UNAVAILABLE (directory/file missing, invalid mode, or permission denied)
"""

import errno
import fcntl
import os
import signal
import sys


def main():
    if len(sys.argv) < 3:
        sys.stderr.write("DATA_LOCK_UNAVAILABLE: missing arguments. Usage: data-lock.py <dataDir> <shared|exclusive>\n")
        sys.stderr.flush()
        sys.exit(3)

    data_dir = sys.argv[1]
    mode_str = sys.argv[2].strip().lower()

    if mode_str == "shared":
        lock_flags = fcntl.LOCK_SH | fcntl.LOCK_NB
    elif mode_str == "exclusive":
        lock_flags = fcntl.LOCK_EX | fcntl.LOCK_NB
    else:
        sys.stderr.write(f"DATA_LOCK_UNAVAILABLE: invalid mode '{mode_str}', must be 'shared' or 'exclusive'\n")
        sys.stderr.flush()
        sys.exit(3)

    # Validate and canonicalize directory
    try:
        if not os.path.isdir(data_dir):
            sys.stderr.write(f"DATA_LOCK_UNAVAILABLE: dataDir does not exist or is not a directory: {data_dir}\n")
            sys.stderr.flush()
            sys.exit(3)
        canonical_dir = os.path.realpath(data_dir)
    except Exception as err:
        sys.stderr.write(f"DATA_LOCK_UNAVAILABLE: failed to resolve directory {data_dir}: {err}\n")
        sys.stderr.flush()
        sys.exit(3)

    # Fixed lock file inode is NEVER unlinked, deleted, or renamed.
    lock_file = os.path.join(canonical_dir, ".data-maintenance.lock")
    try:
        fd = os.open(lock_file, os.O_CREAT | os.O_RDWR, 0o600)
    except Exception as err:
        sys.stderr.write(f"DATA_LOCK_UNAVAILABLE: failed to open lock file: {err}\n")
        sys.stderr.flush()
        sys.exit(3)

    # Acquire non-blocking flock
    try:
        fcntl.flock(fd, lock_flags)
    except (BlockingIOError, IOError, OSError) as err:
        if hasattr(err, "errno") and err.errno in (errno.EACCES, errno.EAGAIN):
            sys.stderr.write("DATA_LOCK_BUSY\n")
            sys.stderr.flush()
            os.close(fd)
            sys.exit(2)
        else:
            sys.stderr.write(f"DATA_LOCK_UNAVAILABLE: flock failed: {err}\n")
            sys.stderr.flush()
            os.close(fd)
            sys.exit(3)

    # Signal handlers for clean exit on SIGTERM/SIGINT
    def _handle_signal(signum, frame):
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        except Exception:
            pass
        try:
            os.close(fd)
        except Exception:
            pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    # Handshake: notify parent that lock is held
    sys.stdout.write("READY\n")
    sys.stdout.flush()

    # Block waiting for stdin EOF (when parent closes pipe or dies)
    try:
        while True:
            chunk = sys.stdin.read(1024)
            if not chunk:
                break
    except Exception:
        pass
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        except Exception:
            pass
        try:
            os.close(fd)
        except Exception:
            pass

    sys.exit(0)


if __name__ == "__main__":
    main()
