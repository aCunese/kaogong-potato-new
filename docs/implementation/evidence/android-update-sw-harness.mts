/**
 * public/sw.js 行为验证（R16：/version.json 网络直通、绝不缓存回退；预缓存列表防御性剔除版本文件）
 * Node 环境模拟 Service Worker 全局对象，不修改仓库文件。
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.REPO_ROOT as string;
const swPath = path.join(REPO, 'public/sw.js');
let code = fs.readFileSync(swPath, 'utf-8');

// 模拟构建期插件误注入 /version.json（vite.config.ts 当前仍会注入，脚本需防御）
if (!code.includes("'/version.json'")) {
  code = code.replace(
    /const PRECACHE_RESOURCES = \[[^\]]*\];/,
    "const PRECACHE_RESOURCES = ['/', '/index.html', '/manifest.json', '/version.json', '/api/version'];",
  );
}

type Listener = (event: unknown) => void;

interface MockCache {
  addAll: (urls: string[]) => Promise<void>;
  put: (req: unknown, res: unknown) => Promise<void>;
}

function createEnvironment(options: { fetchImpl: (req: { url: string }) => Promise<Response> }) {
  const listeners = new Map<string, Listener[]>();
  const precached: string[] = [];
  const cachedPuts: string[] = [];
  const cacheMatchCalls: string[] = [];

  const mockCache: MockCache = {
    addAll: async (urls: string[]) => {
      precached.push(...urls);
    },
    put: async (req: unknown) => {
      const url = typeof req === 'object' && req !== null && 'url' in req ? String((req as { url: string }).url) : String(req);
      cachedPuts.push(url);
    },
  };

  const self = {
    listeners,
    addEventListener(type: string, cb: Listener) {
      const arr = listeners.get(type) ?? [];
      arr.push(cb);
      listeners.set(type, arr);
    },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };

  const caches = {
    open: async () => mockCache,
    keys: async () => [],
    delete: async () => true,
    match: async (req: unknown) => {
      const url = typeof req === 'object' && req !== null && 'url' in req ? String((req as { url: string }).url) : String(req);
      cacheMatchCalls.push(url);
      return undefined;
    },
  };

  const runtimeFetch = async (req: { url: string }) => options.fetchImpl(req);

  const factory = new Function('self', 'caches', 'fetch', 'Response', 'URL', 'console', `${code}\nreturn self;`);
  factory(self, caches, runtimeFetch, Response, URL, console);

  return { listeners, precached, cachedPuts, cacheMatchCalls };
}

let pass = 0;
let fail = 0;
function check(name: string, condition: boolean, extra?: unknown) {
  if (condition) {
    pass += 1;
    console.log(`PASS ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL ${name}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

async function main() {
  // 1) install 事件：预缓存列表防御性剔除 /version.json 与 /api/version
  {
    const env = createEnvironment({ fetchImpl: async () => new Response('ok') });
    const install = env.listeners.get('install')?.[0];
    check('sw has install listener', typeof install === 'function');
    const waits: Promise<unknown>[] = [];
    install?.({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    check(
      'R16 precache excludes /version.json and /api/version even if injected',
      !env.precached.includes('/version.json') && !env.precached.includes('/api/version'),
      env.precached,
    );
    check('SW keeps /index.html precached', env.precached.includes('/index.html'), env.precached);
  }

  // 2) /version.json 网络失败 => 503 JSON，且不查缓存、不写缓存
  {
    const env = createEnvironment({
      fetchImpl: async () => {
        throw new TypeError('network down');
      },
    });
    const fetchHandler = env.listeners.get('fetch')?.[0];
    check('sw has fetch listener', typeof fetchHandler === 'function');
    let responded: Promise<Response> | null = null;
    fetchHandler?.({
      request: { url: 'https://work.ruyne.space/version.json?nonce=abc', mode: 'cors', destination: '' },
      respondWith: (p: Promise<Response>) => {
        responded = p;
      },
    });
    const res = await responded!;
    const body = await res.json();
    check(
      'R16 /version.json network failure => HTTP 503 JSON (not cached fallback)',
      res.status === 503 && body && body.code === 'VERSION_UNAVAILABLE' && body.offline === true,
      { status: res.status, body },
    );
    check('R16 /version.json never consults cache', env.cacheMatchCalls.length === 0, env.cacheMatchCalls);
    check('R16 /version.json never written to cache', env.cachedPuts.length === 0, env.cachedPuts);
  }

  // 3) /version.json 网络成功 => 原样返回，且不写缓存
  {
    const env = createEnvironment({
      fetchImpl: async () => new Response(JSON.stringify({ version: '1.0.2', nonce: 'abc' }), { status: 200 }),
    });
    const fetchHandler = env.listeners.get('fetch')?.[0];
    let responded: Promise<Response> | null = null;
    fetchHandler?.({
      request: { url: 'https://work.ruyne.space/version.json?nonce=abc', mode: 'cors', destination: '' },
      respondWith: (p: Promise<Response>) => {
        responded = p;
      },
    });
    const res = await responded!;
    check('R16 fresh /version.json response passed through untouched', res.status === 200);
    check('R16 fresh /version.json not cached by SW', env.cachedPuts.length === 0, env.cachedPuts);
  }

  // 4) /api/version 网络失败 => 503 JSON
  {
    const env = createEnvironment({
      fetchImpl: async () => {
        throw new TypeError('network down');
      },
    });
    const fetchHandler = env.listeners.get('fetch')?.[0];
    let responded: Promise<Response> | null = null;
    fetchHandler?.({
      request: { url: 'https://work.ruyne.space/api/version', mode: 'cors', destination: '' },
      respondWith: (p: Promise<Response>) => {
        responded = p;
      },
    });
    const res = await responded!;
    check('R16 /api/version network failure => 503 JSON', res.status === 503);
  }

  console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('HARNESS ERROR', err);
  process.exit(2);
});
