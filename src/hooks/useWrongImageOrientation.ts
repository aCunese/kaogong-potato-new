import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ExecuteMutationOptions, MutationResult, OperationScope } from '../types';
import { applyPrepareWrongImageOrientations, applyWrongImageOrientation, getWrongRecordImages, MutatorReturn } from '../utils/workflowMutators';
import { orientationMediaId } from '../utils/imageOrientation';
import { requestImageOrientation } from '../utils/orientationClient';

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
          const saved = await o.mutate(draft => applyWrongImageOrientation(draft, task.id, task.index, task.mediaId, result), 'wrong_image_orientation', {
            context: { scope, isCurrent: () => o.isValid(scope), abortSignal: scope.signal },
          });
          if (!saved.ok) {
            if (saved.code === 'IMAGE_CHANGED' || saved.code === 'NOT_FOUND' || saved.code === 'AUTH_EPOCH_CHANGED') continue;
            throw new Error(saved.message);
          }
          if (mounted.current && o.isValid(scope)) setErrors(prev => { const next = { ...prev }; delete next[task.key]; return next; });
        } catch (error) {
          const current = latest.current;
          const record = current.state.wrong.find(record => record.id === task.id);
          const image = record && getWrongRecordImages(record)[task.index];
          if (o.isValid(scope) && mounted.current && image && keyFor(current.userId, task.id, task.index, image) === task.key) {
            retryAt.current.set(task.key, Date.now() + 60000);
            setErrors(prev => ({ ...prev, [task.key]: error instanceof Error && error.name !== 'AbortError' ? error.message : '识别暂未完成，请重试' }));
          }
        } finally {
          if (mounted.current && o.isValid(scope)) setActivity(null);
        }
      }
    } finally { running.current = false; }
  }, []);
  pumpRef.current = () => { void pump(); };

  const request = useCallback(async (id: string, force = false) => {
    const o = latest.current;
    const record = o.state.wrong.find(record => record.id === id);
    if (!record) return;
    const images = getWrongRecordImages(record);
    images.forEach((image, index) => retryAt.current.delete(keyFor(o.userId, id, index, image)));
    if (record.imageOrientations === undefined || (force && record.imageOrientations.some(result => result?.status === 'unresolved'))) {
      const scope = o.createScope(o.userId ?? null);
      const result = await o.mutate(draft => applyPrepareWrongImageOrientations(draft, id, images, force), 'prepare_image_orientation', {
        context: { scope, isCurrent: () => o.isValid(scope), abortSignal: scope.signal },
      });
      if (!result.ok) return;
    }
    pumpRef.current();
  }, []);

  useEffect(() => {
    retryAt.current.clear(); setErrors({}); setActivity(null);
  }, [options.userId]);
  useEffect(() => { pumpRef.current(); }, [options.state, options.enabled, options.csrf, options.userId]);
  useEffect(() => {
    mounted.current = true;
    const resume = () => { retryAt.current.clear(); pumpRef.current(); };
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    return () => { mounted.current = false; clearTimeout(timer.current); window.removeEventListener('online', resume); window.removeEventListener('focus', resume); };
  }, []);
  const orientationErrors: Record<string, string> = {};
  for (const record of options.state.wrong) {
    getWrongRecordImages(record).forEach((image, index) => {
      const error = errors[keyFor(options.userId, record.id, index, image)];
      if (error) orientationErrors[`${record.id}:${index}`] = error;
    });
  }
  return { requestWrongImageOrientations: request, orientationActivity: activity, orientationErrors };
}
