import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ExecuteMutationOptions, MutationResult, OperationScope } from '../types';
import { applyPrepareWrongImageOrientations, applyWrongImageOrientation, getWrongRecordImages, MutatorReturn } from '../utils/workflowMutators';
import { orientationMediaId } from '../utils/imageOrientation';
import { requestImageOrientation, OrientationClientError } from '../utils/orientationClient';

interface Options {
  state: AppState;
  userId?: string;
  csrf: string | null;
  enabled: boolean;
  createScope: (userId?: string | null) => OperationScope;
  isValid: (scope: OperationScope) => boolean;
  mutate: <T>(mutator: (draft: AppState) => MutatorReturn<T>, reason?: string, options?: ExecuteMutationOptions) => Promise<MutationResult<T>>;
}

export function useWrongImageOrientation(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const running = useRef(false);
  const mounted = useRef(true);
  const retryAt = useRef(new Map<string, number>());
  const retryCounts = useRef(new Map<string, number>());
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [activity, setActivity] = useState<{ recordId: string; index: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pumpRef = useRef<() => void>(() => {});
  const keyFor = (userId: string | undefined, id: string, index: number, image: string) => `${userId}:${id}:${index}:${image}`;

  const pump = useCallback(async () => {
    if (running.current || !mounted.current) return;
    running.current = true;
    clearTimeout(timer.current);
    try {
      while (mounted.current) {
        const o = latest.current;
        if (!o.enabled || !o.userId || !o.csrf || !navigator.onLine) break;
        let next: { id: string; index: number; mediaId: string; key: string } | undefined;
        let soonest = Infinity;
        for (const record of o.state.wrong) {
          if (!record.imageOrientations) continue;
          for (const [index, image] of getWrongRecordImages(record).entries()) {
            if (record.imageOrientations[index] != null) continue;
            const mediaId = orientationMediaId(image);
            if (!mediaId) continue; // Offline photos become eligible after media sync replaces their reference.
            const key = keyFor(o.userId, record.id, index, image);
            const due = retryAt.current.get(key) ?? 0;
            if (due > Date.now()) { soonest = Math.min(soonest, due); continue; }
            next = { id: record.id, index, mediaId, key }; break;
          }
          if (next) break;
        }
        if (!next) {
          if (Number.isFinite(soonest)) timer.current = setTimeout(() => pumpRef.current(), Math.max(50, soonest - Date.now()));
          break;
        }
        const task = next;
        const scope = o.createScope(o.userId);
        retryAt.current.set(task.key, Infinity);
        setActivity({ recordId: task.id, index: task.index });
        try {
          const result = await requestImageOrientation(task.mediaId, o.csrf, o.userId, scope.signal);
          if (!o.isValid(scope)) continue;
          const saved = await o.mutate(draft => {
            const currentRecord = draft.wrong.find(r => r.id === task.id);
            // If user manually rotated/resolved the image while recognition was in flight, preserve the manual decision
            if (currentRecord?.imageOrientations?.[task.index]?.status === 'resolved') {
              return { nextState: draft, value: currentRecord };
            }
            return applyWrongImageOrientation(draft, task.id, task.index, task.mediaId, result);
          }, 'wrong_image_orientation', {
            context: { scope, isCurrent: () => o.isValid(scope), abortSignal: scope.signal },
          });
          if (!saved.ok) {
            if (saved.code === 'IMAGE_CHANGED' || saved.code === 'NOT_FOUND' || saved.code === 'AUTH_EPOCH_CHANGED') continue;
            throw new Error(saved.message);
          }
          if (mounted.current && o.isValid(scope)) {
            retryCounts.current.delete(task.key);
            setErrors(prev => { const next = { ...prev }; delete next[task.key]; return next; });
          }
        } catch (error) {
          const current = latest.current;
          const record = current.state.wrong.find(record => record.id === task.id);
          const image = record && getWrongRecordImages(record)[task.index];
          if (o.isValid(scope) && mounted.current && image && keyFor(current.userId, task.id, task.index, image) === task.key) {
            const isBusy = (error instanceof OrientationClientError && error.status === 429) || (error instanceof Error && error.message.includes('排队'));
            if (isBusy) {
              const attempts = (retryCounts.current.get(task.key) ?? 0) + 1;
              retryCounts.current.set(task.key, attempts);
              if (attempts <= 5) {
                const retryAfterSec = error instanceof OrientationClientError ? error.retryAfterSeconds : 2;
                const delayMs = Math.max(retryAfterSec * 1000, 1500 * Math.pow(1.5, attempts - 1));
                retryAt.current.set(task.key, Date.now() + delayMs);
                setErrors(prev => { const next = { ...prev }; delete next[task.key]; return next; });
                continue;
              }
            }
            retryAt.current.set(task.key, Infinity);
            const message = error instanceof Error && error.name !== 'AbortError' ? error.message : '识别暂未完成，请重试';
            setErrors(prev => ({ ...prev, [task.key]: message }));
          }
        } finally {
          if (mounted.current && o.isValid(scope)) setActivity(null);
        }
      }
    } finally { running.current = false; }
  }, []);
  pumpRef.current = () => { void pump(); };

  const request = useCallback(async (id: string, force = false, targetIndex?: number) => {
    const o = latest.current;
    const record = o.state.wrong.find(record => record.id === id);
    if (!record) return;
    const images = getWrongRecordImages(record);
    images.forEach((image, index) => {
      if (targetIndex === undefined || index === targetIndex) {
        const k = keyFor(o.userId, id, index, image);
        retryAt.current.delete(k);
        retryCounts.current.delete(k);
      }
    });
    if (record.imageOrientations === undefined || force || (images.some((_, index) => record.imageOrientations?.[index] == null))) {
      const scope = o.createScope(o.userId ?? null);
      const result = await o.mutate(draft => applyPrepareWrongImageOrientations(draft, id, images, force, targetIndex), 'prepare_image_orientation', {
        context: { scope, isCurrent: () => o.isValid(scope), abortSignal: scope.signal },
      });
      if (!result.ok) return;
    }
    pumpRef.current();
  }, []);

  useEffect(() => {
    retryAt.current.clear(); retryCounts.current.clear(); setErrors({}); setActivity(null);
  }, [options.userId]);
  useEffect(() => { pumpRef.current(); }, [options.state, options.enabled, options.csrf, options.userId]);
  useEffect(() => {
    mounted.current = true;
    const resume = () => { retryAt.current.clear(); retryCounts.current.clear(); pumpRef.current(); };
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    return () => { mounted.current = false; clearTimeout(timer.current); window.removeEventListener('online', resume); window.removeEventListener('focus', resume); };
  }, []);
  const orientationErrors: Record<string, string> = {};
  for (const record of options.state.wrong) {
    getWrongRecordImages(record).forEach((image, index) => {
      // Resolved images should never linger with stale transient errors
      if (record.imageOrientations?.[index]?.status === 'resolved') return;
      const error = errors[keyFor(options.userId, record.id, index, image)];
      if (error) orientationErrors[`${record.id}:${index}`] = error;
    });
  }
  return { requestWrongImageOrientations: request, orientationActivity: activity, orientationErrors };
}
