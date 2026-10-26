import { describe, it, expect } from 'bun:test';
import { ALL_50_SCREENS } from '../src/components/views/ScreenInspectorModal';
import { SUBJECTS } from '../src/types';
import { DEMO_STATE, BLANK_STATE } from '../src/constants/initialData';

describe('Milestone 4: 50-Screen Registry & Verification Audit', () => {
  it('contains exactly 50 registered screens with unique IDs and Node IDs', () => {
    expect(ALL_50_SCREENS.length).toBe(50);

    const ids = new Set<string>();
    const nodeIds = new Set<string>();

    for (const screen of ALL_50_SCREENS) {
      expect(screen.id).toBeDefined();
      expect(screen.name).toBeDefined();
      expect(screen.nodeId).toBeDefined();
      expect(screen.category).toBeDefined();
      expect(screen.desc).toBeDefined();

      expect(ids.has(screen.id)).toBe(false);
      expect(nodeIds.has(screen.nodeId)).toBe(false);

      ids.add(screen.id);
      nodeIds.add(screen.nodeId);
    }

    expect(ids.size).toBe(50);
    expect(nodeIds.size).toBe(50);
  });

  it('verifies category breakdown matches design architecture', () => {
    const categories = ALL_50_SCREENS.reduce((acc, s) => {
      acc[s.category] = (acc[s.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    expect(categories.core).toBe(8);     // 8 Core modules
    expect(categories.flow).toBe(20);   // 20 Workflow pages & modals
    expect(categories.confirm).toBe(8); // 8 Confirm modals
    expect(categories.states).toBe(3);  // 3 States boards
    expect(categories.extra).toBe(11);  // 11 Extra variants
    expect(categories.core + categories.flow + categories.confirm + categories.states + categories.extra).toBe(50);
  });

  it('asserts all 8 core screens are correctly mapped', () => {
    const coreIds = ['today', 'library', 'books', 'courses', 'wrong', 'overall', 'monthly', 'settings'];
    for (const id of coreIds) {
      const found = ALL_50_SCREENS.find(s => s.id === id);
      expect(found).toBeDefined();
      expect(found?.category).toBe('core');
      expect(found?.hasRefScreenshot).toBe(true);
    }
  });

  it('asserts all 8 confirmation screens are correctly registered', () => {
    const confirmIds = [
      'confirm-book',
      'confirm-course',
      'confirm-photo',
      'confirm-reset',
      'confirm-import',
      'confirm-upload',
      'confirm-pull',
      'confirm-logout',
    ];

    for (const id of confirmIds) {
      const found = ALL_50_SCREENS.find(s => s.id === id);
      expect(found).toBeDefined();
      expect(found?.category).toBe('confirm');
      expect(found?.desc.length).toBeGreaterThan(0);
    }
  });

  it('asserts all 3 long states collection boards are registered', () => {
    const stateIds = ['states-empty', 'states-sync', 'states-form'];
    for (const id of stateIds) {
      const found = ALL_50_SCREENS.find(s => s.id === id);
      expect(found).toBeDefined();
      expect(found?.category).toBe('states');
    }
  });

  it('verifies DEMO_STATE maintains consistent baseline statistics', () => {
    expect(DEMO_STATE.books.length).toBe(14);
    expect(DEMO_STATE.courses.length).toBe(7);
    expect(DEMO_STATE.plans.length).toBe(4);
    expect(DEMO_STATE.records.length).toBe(17);
    expect(DEMO_STATE.wrong.length).toBe(3);

    // Sum of minutes in October 2026: 1260 mins
    const totalMinutes = DEMO_STATE.records.reduce((sum, r) => sum + r.minutes, 0);
    expect(totalMinutes).toBe(1260);

    // Questions: 420, Errors: 84
    const totalQuestions = DEMO_STATE.records.reduce((sum, r) => sum + r.questions, 0);
    const totalErrors = DEMO_STATE.records.reduce((sum, r) => sum + r.errors, 0);
    expect(totalQuestions).toBe(420);
    expect(totalErrors).toBe(84);
    expect((totalQuestions - totalErrors) / totalQuestions).toBe(0.8); // Exactly 80%

    // 8 Subjects check
    const subjects = new Set(DEMO_STATE.records.map(r => r.subject));
    expect(subjects.size).toBe(8);
    for (const subj of SUBJECTS) {
      expect(subjects.has(subj)).toBe(true);
    }
  });

  it('verifies BLANK_STATE provides clean zero-baseline for fresh installations', () => {
    expect(BLANK_STATE.books.length).toBe(0);
    expect(BLANK_STATE.courses.length).toBe(0);
    expect(BLANK_STATE.plans.length).toBe(0);
    expect(BLANK_STATE.records.length).toBe(0);
    expect(BLANK_STATE.wrong.length).toBe(0);
    expect(BLANK_STATE.profile.username).toBe('');
    expect(BLANK_STATE.version).toBe(3);
    expect(BLANK_STATE.countdowns.length).toBe(3);
  });
});
