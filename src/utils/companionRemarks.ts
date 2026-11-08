/**
 * Companion Remark Names Storage Helper
 * Allows users to set a custom remark/nickname for their study partners.
 */

const REMARK_KEY_PREFIX = 'potato_companion_remark_';
const inMemoryFallback = new Map<string, string>();

function getStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) return (globalThis as any).localStorage;
  } catch {}
  return {
    getItem: (k: string) => inMemoryFallback.get(k) ?? null,
    setItem: (k: string, v: string) => { inMemoryFallback.set(k, v); },
    removeItem: (k: string) => { inMemoryFallback.delete(k); },
  };
}

export function getCompanionRemark(partnerKey: string, alternateKey?: string): string {
  if (!partnerKey && !alternateKey) return '';
  try {
    const storage = getStorage();
    if (partnerKey) {
      const val = storage.getItem(`${REMARK_KEY_PREFIX}${partnerKey}`);
      if (val) return val;
    }
    if (alternateKey) {
      const altVal = storage.getItem(`${REMARK_KEY_PREFIX}${alternateKey}`);
      if (altVal) return altVal;
    }
    return '';
  } catch {
    return '';
  }
}

export function setCompanionRemark(partnerKey: string, remark: string, alternateKey?: string): void {
  if (!partnerKey && !alternateKey) return;
  try {
    const storage = getStorage();
    const trimmed = remark.trim();
    if (trimmed) {
      if (partnerKey) storage.setItem(`${REMARK_KEY_PREFIX}${partnerKey}`, trimmed);
      if (alternateKey) storage.setItem(`${REMARK_KEY_PREFIX}${alternateKey}`, trimmed);
    } else {
      if (partnerKey) storage.removeItem(`${REMARK_KEY_PREFIX}${partnerKey}`);
      if (alternateKey) storage.removeItem(`${REMARK_KEY_PREFIX}${alternateKey}`);
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('companion_remark_changed', {
        detail: { partnerKey, alternateKey, remark: trimmed }
      }));
    }
  } catch {}
}

export function getCompanionDisplayName(partnerKey: string, defaultNickname: string, alternateKey?: string): string {
  const remark = getCompanionRemark(partnerKey, alternateKey);
  return remark || defaultNickname || '研友';
}

