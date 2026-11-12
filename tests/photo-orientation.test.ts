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

it('rotates wrong images by 90 and 270 degrees in succession and preserves siblings', () => {
  const state = fixture();
  expect(mutations).toHaveProperty('applyRotateWrongImage');
  // Initial state: imageOrientations: [result (270), null]
  // Rotate index 0 by 90 degrees: (270 + 90) % 360 = 0
  const rot1 = mutations.applyRotateWrongImage(state, 'w', 0, 90);
  expect(rot1).not.toHaveProperty('error');
  expect(state.wrong[0].imageOrientations?.[0]).toEqual({ status: 'resolved', rotation: 0, version: 1 });
  expect(state.wrong[0].imageOrientations?.[1]).toBeNull();

  // Rotate index 0 again by 90 degrees: 90
  const rot2 = mutations.applyRotateWrongImage(state, 'w', 0, 90);
  expect(rot2).not.toHaveProperty('error');
  expect(state.wrong[0].imageOrientations?.[0]).toEqual({ status: 'resolved', rotation: 90, version: 1 });

  // Rotate index 1 (was null, defaults to 0): (0 + 90) = 90
  const rot3 = mutations.applyRotateWrongImage(state, 'w', 1, 90);
  expect(rot3).not.toHaveProperty('error');
  expect(state.wrong[0].imageOrientations?.[1]).toEqual({ status: 'resolved', rotation: 90, version: 1 });

  // Rotate index 1 by 270 degrees: (90 + 270) % 360 = 0
  const rot4 = mutations.applyRotateWrongImage(state, 'w', 1, 270);
  expect(rot4).not.toHaveProperty('error');
  expect(state.wrong[0].imageOrientations?.[1]).toEqual({ status: 'resolved', rotation: 0, version: 1 });

  // Rejects invalid index or non-existent wrong record
  const badIndex = mutations.applyRotateWrongImage(state, 'w', 5, 90);
  expect(badIndex).toHaveProperty('error');
  const badId = mutations.applyRotateWrongImage(state, 'nonexistent', 0, 90);
  expect(badId).toHaveProperty('error');
});

it('applyPrepareWrongImageOrientations supports targeting a single image index without wiping siblings', () => {
  const state = fixture();
  // state has 2 images: [result (270), null]
  const images = state.wrong[0].images!;

  // Resolve index 1 first
  mutations.applyRotateWrongImage(state, 'w', 1, 90);
  expect(state.wrong[0].imageOrientations?.[0]).toEqual(result);
  expect(state.wrong[0].imageOrientations?.[1]).toEqual({ status: 'resolved', rotation: 90, version: 1 });

  // Targeted re-identification of index 1 only: index 0 remains resolved (270)
  const targeted = mutations.applyPrepareWrongImageOrientations(state, 'w', images, true, 1);
  expect(targeted).not.toHaveProperty('error');
  expect(state.wrong[0].imageOrientations?.[0]).toEqual(result);
  expect(state.wrong[0].imageOrientations?.[1]).toBeNull();

  // Full force re-identification without targetIndex: both reset to null
  const fullForce = mutations.applyPrepareWrongImageOrientations(state, 'w', images, true);
  expect(fullForce).not.toHaveProperty('error');
  expect(state.wrong[0].imageOrientations?.[0]).toBeNull();
  expect(state.wrong[0].imageOrientations?.[1]).toBeNull();
});
