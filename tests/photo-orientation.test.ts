import { expect, it } from 'bun:test';
import { BLANK_STATE } from '../src/constants/initialData';
import { validateAndMigrateBackup } from '../src/utils/backupValidator';
import * as mutations from '../src/utils/workflowMutators';

const image = 'data:image/png;base64,iVBORw0KGgo=';
const result = { status: 'resolved', rotation: 270, version: 1 } as const;
function fixture() {
  const state = structuredClone(BLANK_STATE);
  state.wrong = [{ id: 'w', bookId: '资料分析', date: '2026-11-04', note: 'keep', image, images: [image, '/api/media/media_test2'], imageOrientations: [result, null] }];
  return state;
}
it('retains independent photo orientation results through portable backup import', () => {
  const restored = validateAndMigrateBackup(JSON.stringify(fixture()));
  expect(restored.valid).toBe(true);
  expect(restored.migratedState?.wrong[0].imageOrientations).toEqual([result, null]);
});
it('rejects malformed, oversized or mismatched photo orientation metadata', () => {
  for (const invalid of [[{...result, rotation: 45}], [{...result, version: 2}], [{...result, status:'bad'}], Array(10).fill(null), [null,null,null]]) {
    const state = fixture(); state.wrong[0].imageOrientations = invalid as any;
    expect(validateAndMigrateBackup(JSON.stringify(state)).valid).toBe(false);
  }
});
it('updates the matching image atomically without changing original bytes, notes or siblings', () => {
  const state = fixture();
  expect(mutations).toHaveProperty('applyWrongImageOrientation');
  const saved = (mutations as any).applyWrongImageOrientation(state, 'w', 1, 'media_test2', result);
  expect(saved).not.toHaveProperty('error');
  expect(state.wrong[0]).toMatchObject({ note: 'keep', image, images: [image, '/api/media/media_test2'], imageOrientations: [result, result] });
});
it('rejects stale image results and invalid payloads without partially changing the record', () => {
  expect(mutations).toHaveProperty('applyWrongImageOrientation');
  for (const [id, index, mediaId, orientation] of [['w',1,'media_old',result],['w',0,'media_test2',result],['deleted',1,'media_test2',result],['w',1,'media_test2',{...result,rotation:45}]] as const) {
    const state = fixture(), before = structuredClone(state);
    expect((mutations as any).applyWrongImageOrientation(state,id,index,mediaId,orientation)).toHaveProperty('error');
    expect(state).toEqual(before);
  }
});
