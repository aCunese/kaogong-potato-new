/**
 * V10 & V11 regression tests:
 * - V10: SW Lifecycle & applyWebUpdate without hang / infinite loops
 * - V11: Version check cache binding to client identity & dynamic re-evaluation
 */
import { describe, expect, it, beforeEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppProvider, useApp } from '../src/context/AppContext';
import {
  CURRENT_WEB_BUILD,
  CURRENT_WEB_VERSION,
  UPDATE_CHECK_THROTTLE_MS,
  STORAGE_KEY_PENDING_RELOAD,
  STORAGE_KEY_RELOAD_ATTEMPTS,
  getClientIdentity,
  isSameClientIdentity,
  getCachedUpdateResult,
  resetUpdateCheckState,
  checkAppUpdate,
  applyWebUpdate,
  type ClientIdentity,
  type RemoteVersionInfo,
} from '../src/utils/versionCheck';

const REPO_ROOT = path.resolve(__dirname, '..');

const mockStorage = new Map<string, string>();
if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = {
    getItem: (k: string) => mockStorage.get(k) || null,
    setItem: (k: string, v: string) => mockStorage.set(k, v),
    removeItem: (k: string) => mockStorage.delete(k),
    clear: () => mockStorage.clear(),
  };
}

describe('V10: Service Worker Lifecycle & Web Update', () => {
  it('sw.js does not call self.skipWaiting() unconditionally in install', () => {
    const swContent = fs.readFileSync(path.join(REPO_ROOT, 'public', 'sw.js'), 'utf8');
    
    // Install listener must not end with .then(() => self.skipWaiting())
    const installBlock = swContent.match(/self\.addEventListener\(['"]install['"],([\s\S]*?)\}\);/);
    expect(installBlock).not.toBeNull();
    expect(installBlock![1]).not.toContain('self.skipWaiting()');
  });

  it('sw.js implements GET_RELEASE_INFO and conditional SKIP_WAITING handlers', () => {
    const swContent = fs.readFileSync(path.join(REPO_ROOT, 'public', 'sw.js'), 'utf8');
    
    expect(swContent).toContain("event.data.type === 'GET_RELEASE_INFO'");
    expect(swContent).toContain("type: 'RELEASE_INFO'");
    expect(swContent).toContain("event.data.type === 'SKIP_WAITING'");
    expect(swContent).toContain("targetBuild");
  });

  it('applyWebUpdate respects canActivate guard', async () => {
    const res = await applyWebUpdate({
      canActivate: () => ({ ok: false, reason: '学习计时器运行中' }),
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('学习计时器运行中');
    expect(res.controllerChanged).toBe(false);
  });

  it('A04: active worker mismatch does not claim activation and calls update()', async () => {
    let updateCalls = 0;
    const sessionStore = new Map<string, string>();
    const oldWorker: any = {
      postMessage(msg: any, ports: any[]) {
        if (msg.type === 'GET_RELEASE_INFO' && ports[0]) {
          ports[0].postMessage({
            type: 'RELEASE_INFO',
            build: '20261026.01',
            cacheName: 'kaogong-shell-v3-1.0.2-20261026.01',
          });
        }
      },
    };
    const reg: any = {
      active: oldWorker,
      waiting: null,
      installing: null,
      async update() {
        updateCalls++;
      },
    };

    const originalNavigator = globalThis.navigator;
    const originalSessionStorage = (globalThis as any).sessionStorage;
    const originalMessageChannel = (globalThis as any).MessageChannel;

    try {
      class MockMC {
        port1 = {
          onmessage: null as any,
        };
        port2 = {
          postMessage: (data: any) => {
            this.port1.onmessage?.({ data });
          },
        };
      }
      (globalThis as any).MessageChannel = MockMC;
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => sessionStore.get(k) || null,
        setItem: (k: string, v: string) => sessionStore.set(k, v),
        removeItem: (k: string) => sessionStore.delete(k),
        clear: () => sessionStore.clear(),
      };
      (globalThis as any).navigator = {
        serviceWorker: {
          controller: oldWorker,
          async getRegistration() {
            return reg;
          },
          addEventListener: () => {},
          removeEventListener: () => {},
        },
      };

      const result = await applyWebUpdate({ targetBuild: '20261027.02' });
      expect(updateCalls).toBe(1);
      expect(result.ok).toBe(false);
      expect(result.status).toBe('failed');
      expect(sessionStore.has(STORAGE_KEY_PENDING_RELOAD)).toBe(false);
    } finally {
      if (originalNavigator) (globalThis as any).navigator = originalNavigator;
      else delete (globalThis as any).navigator;
      if (originalSessionStorage) (globalThis as any).sessionStorage = originalSessionStorage;
      else delete (globalThis as any).sessionStorage;
      if (originalMessageChannel) (globalThis as any).MessageChannel = originalMessageChannel;
      else delete (globalThis as any).MessageChannel;
    }
  });

  it('A04: reload attempts limit prevents infinite reload loop', async () => {
    const sessionStore = new Map<string, string>();
    sessionStore.set(STORAGE_KEY_PENDING_RELOAD, '20261028.99');
    sessionStore.set(STORAGE_KEY_RELOAD_ATTEMPTS, '1');

    const originalSessionStorage = (globalThis as any).sessionStorage;
    const originalNavigator = (globalThis as any).navigator;

    try {
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => sessionStore.get(k) || null,
        setItem: (k: string, v: string) => sessionStore.set(k, v),
        removeItem: (k: string) => sessionStore.delete(k),
        clear: () => sessionStore.clear(),
      };
      (globalThis as any).navigator = {
        serviceWorker: {
          async getRegistration() {
            return { active: null, waiting: null, installing: null, update: async () => {} };
          },
        },
      };

      const result = await applyWebUpdate({ targetBuild: '20261028.99' });
      expect(result.ok).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.message).toContain('仍未更新至预期构建');
      expect(sessionStore.has(STORAGE_KEY_PENDING_RELOAD)).toBe(false);
    } finally {
      if (originalSessionStorage) (globalThis as any).sessionStorage = originalSessionStorage;
      else delete (globalThis as any).sessionStorage;
      if (originalNavigator) (globalThis as any).navigator = originalNavigator;
      else delete (globalThis as any).navigator;
    }
  });
});

describe('V11: Client Identity & Cache Binding', () => {
  beforeEach(() => {
    resetUpdateCheckState();
  });

  it('getClientIdentity extracts accurate identity from release configuration', () => {
    const identity = getClientIdentity();
    expect(identity.webVersion).toBe(CURRENT_WEB_VERSION);
    expect(identity.webBuild).toBe(CURRENT_WEB_BUILD);
    expect(typeof identity.isNativeApp).toBe('boolean');
  });

  it('isSameClientIdentity validates all 7 identity dimensions', () => {
    const base: ClientIdentity = {
      webVersion: '1.0.3',
      webBuild: '20261027.01',
      isNativeApp: false,
    };

    expect(isSameClientIdentity(base, { ...base })).toBe(true);
    expect(isSameClientIdentity(base, { ...base, webVersion: '1.0.4' })).toBe(false);
    expect(isSameClientIdentity(base, { ...base, webBuild: '20261027.02' })).toBe(false);
    expect(isSameClientIdentity(base, { ...base, isNativeApp: true })).toBe(false);
    expect(isSameClientIdentity(base, { ...base, appVersionCode: 5 })).toBe(false);
    expect(isSameClientIdentity(base, { ...base, appPackageName: 'other' })).toBe(false);
    expect(isSameClientIdentity(base, { ...base, certFingerprint: 'abc' })).toBe(false);
    expect(isSameClientIdentity(base, { ...base, bridgeProtocol: 3 })).toBe(false);
  });

  it('cache binding discards outdated cache and re-evaluates dynamically', () => {
    const storageKey = 'kaogong.updateCheck.state.v1';
    
    // Simulate cache written by older build (1.0.2 / 20261026.03)
    const oldCache = {
      verifiedAt: Date.now(),
      identity: {
        webVersion: '1.0.2',
        webBuild: '20261026.03',
        isNativeApp: false,
      },
      remote: {
        version: '1.0.3',
        build: '20261027.01',
      },
    };
    localStorage.setItem(storageKey, JSON.stringify(oldCache));

    // getCachedUpdateResult must detect identity mismatch and discard cache immediately
    const cached = getCachedUpdateResult();
    expect(cached).toBeNull();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('dynamic re-evaluation does not return stale webUpdateAvailable when current build matches remote', () => {
    const storageKey = 'kaogong.updateCheck.state.v1';
    
    // Simulate cache with matching identity (1.0.3 / 20261027.01) and remote is also 20261027.01
    const matchingCache = {
      verifiedAt: Date.now(),
      identity: {
        webVersion: CURRENT_WEB_VERSION,
        webBuild: CURRENT_WEB_BUILD,
        isNativeApp: false,
      },
      remote: {
        version: CURRENT_WEB_VERSION,
        build: CURRENT_WEB_BUILD,
      },
    };
    localStorage.setItem(storageKey, JSON.stringify(matchingCache));

    const cached = getCachedUpdateResult();
    expect(cached).not.toBeNull();
    expect(cached!.webUpdateAvailable).toBe(false);
    expect(cached!.status).toBe('latest');
    expect(cached!.fromCache).toBe(true);
  });
});

describe('S11: Update Blocker Guard & Registration (AppContext)', () => {
  it('registerUpdateBlocker blocks updateGuard and unregisters idempotently', () => {
    let contextValue: any = null;
    const TestConsumer = () => {
      contextValue = useApp();
      return React.createElement('div', null, 'loaded');
    };

    renderToStaticMarkup(
      React.createElement(AppProvider, { preview: true }, React.createElement(TestConsumer, null))
    );

    expect(contextValue).not.toBeNull();
    const initialGuard = contextValue.updateGuard();
    expect(initialGuard.ok).toBe(true);

    // Register a blocker
    const unregister = contextValue.registerUpdateBlocker('modal_edit', '正在进行题本编辑');
    const blockedGuard = contextValue.updateGuard();
    expect(blockedGuard.ok).toBe(false);
    expect(blockedGuard.reason).toBe('正在进行数据编辑或操作，已暂缓应用更新');

    // Unregister blocker
    unregister();
    const unblockedGuard = contextValue.updateGuard();
    expect(unblockedGuard.ok).toBe(true);

    // Idempotent call to unregister must not throw or affect anything
    expect(() => unregister()).not.toThrow();
    expect(contextValue.updateGuard().ok).toBe(true);
  });
});
