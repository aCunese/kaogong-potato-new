/** Empty drafts stay empty in the UI; convert only at the save boundary. */
export function parseIntegerDraft(value: string, kind: 'positive' | 'nonnegative' | 'optional' = 'positive'): number | null {
  if (kind === 'optional' && value === '') return 0;
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && (kind === 'nonnegative' ? number >= 0 : number > 0) ? number : null;
}
