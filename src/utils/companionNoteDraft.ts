/**
 * Companion Note Draft Persistence Helper
 * Automatically saves user draft (message text, image / sticker, image name) to localStorage.
 * Restores the draft whenever the user opens the modal, so unsent work is never lost.
 * Clears the draft ONLY when the note has been successfully sent.
 */

export interface CompanionNoteDraft {
  message: string;
  imageUrl?: string | null;
  imageName?: string;
  recipientId?: string;
  grantId?: string;
  updatedAt: number;
}

const DRAFT_KEY_PREFIX = 'potato_companion_note_draft_';
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

export function getCompanionNoteDraftKey(userId?: string, recipientId?: string, grantId?: string): string {
  const u = userId || 'guest';
  const target = recipientId || grantId || 'default';
  return `${DRAFT_KEY_PREFIX}${u}_${target}`;
}

export function loadCompanionNoteDraft(
  userId?: string,
  recipientId?: string,
  grantId?: string
): CompanionNoteDraft | null {
  try {
    const storage = getStorage();
    const primaryKey = getCompanionNoteDraftKey(userId, recipientId, grantId);
    let raw = storage.getItem(primaryKey);

    // Fallback: if not found by primaryKey, check alternate key by grantId / recipientId
    if (!raw && recipientId && grantId) {
      const altKey = getCompanionNoteDraftKey(userId, grantId);
      raw = storage.getItem(altKey);
    }

    // Fallback: if still not found, check the latest draft for this user
    if (!raw) {
      const lastKey = `${DRAFT_KEY_PREFIX}${userId || 'guest'}_latest`;
      const lastRaw = storage.getItem(lastKey);
      if (lastRaw) {
        try {
          const parsed = JSON.parse(lastRaw) as CompanionNoteDraft;
          if (
            !recipientId ||
            !parsed.recipientId ||
            parsed.recipientId === recipientId ||
            parsed.grantId === grantId ||
            parsed.recipientId === grantId ||
            parsed.grantId === recipientId
          ) {
            raw = lastRaw;
          }
        } catch {}
      }
    }

    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || (typeof parsed.message !== 'string' && !parsed.imageUrl)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveCompanionNoteDraft(
  userId: string | undefined,
  recipientId: string | undefined,
  grantId: string | undefined,
  draft: { message: string; imageUrl?: string | null; imageName?: string }
): void {
  try {
    const storage = getStorage();
    const primaryKey = getCompanionNoteDraftKey(userId, recipientId, grantId);
    const lastKey = `${DRAFT_KEY_PREFIX}${userId || 'guest'}_latest`;

    const trimmedMsg = (draft.message || '').trim();
    if (!trimmedMsg && !draft.imageUrl) {
      storage.removeItem(primaryKey);
      storage.removeItem(lastKey);
      if (grantId) storage.removeItem(getCompanionNoteDraftKey(userId, grantId));
      if (recipientId) storage.removeItem(getCompanionNoteDraftKey(userId, recipientId));
      return;
    }

    const payload: CompanionNoteDraft = {
      message: draft.message,
      imageUrl: draft.imageUrl || null,
      imageName: draft.imageName || '',
      recipientId,
      grantId,
      updatedAt: Date.now(),
    };

    const serialized = JSON.stringify(payload);
    try {
      storage.setItem(primaryKey, serialized);
      storage.setItem(lastKey, serialized);
    } catch {
      // Quota exceeded protection: fallback to storing message text only
      const textOnlyPayload: CompanionNoteDraft = {
        message: draft.message,
        imageUrl: null,
        imageName: draft.imageName || '',
        recipientId,
        grantId,
        updatedAt: Date.now(),
      };
      const textSerialized = JSON.stringify(textOnlyPayload);
      try {
        storage.setItem(primaryKey, textSerialized);
        storage.setItem(lastKey, textSerialized);
      } catch {}
    }
  } catch (err) {
    console.warn('[CompanionNoteDraft] Failed to save draft:', err);
  }
}

export function clearCompanionNoteDraft(
  userId?: string,
  recipientId?: string,
  grantId?: string
): void {
  try {
    const storage = getStorage();
    const primaryKey = getCompanionNoteDraftKey(userId, recipientId, grantId);
    const lastKey = `${DRAFT_KEY_PREFIX}${userId || 'guest'}_latest`;
    storage.removeItem(primaryKey);
    storage.removeItem(lastKey);
    if (grantId) storage.removeItem(getCompanionNoteDraftKey(userId, grantId));
    if (recipientId) storage.removeItem(getCompanionNoteDraftKey(userId, recipientId));
  } catch (err) {
    console.warn('[CompanionNoteDraft] Failed to clear draft:', err);
  }
}
