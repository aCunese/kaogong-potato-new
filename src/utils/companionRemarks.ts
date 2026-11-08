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

export function getCompanionRemark(partnerKey: string): string {
  if (!partnerKey) return '';
  try {
    const storage = getStorage();
    return storage.getItem(`${REMARK_KEY_PREFIX}${partnerKey}`) || '';
  } catch {
    return '';
  }
}

export function setCompanionRemark(partnerKey: string, remark: string): void {
  if (!partnerKey) return;
  try {
    const storage = getStorage();
    const trimmed = remark.trim();
    if (trimmed) {
      storage.setItem(`${REMARK_KEY_PREFIX}${partnerKey}`, trimmed);
    } else {
      storage.removeItem(`${REMARK_KEY_PREFIX}${partnerKey}`);
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('companion_remark_changed', {
        detail: { partnerKey, remark: trimmed }
      }));
    }
  } catch {}
}

export function getCompanionDisplayName(partnerKey: string, defaultNickname: string): string {
  const remark = getCompanionRemark(partnerKey);
  return remark || defaultNickname || '研友';
}

