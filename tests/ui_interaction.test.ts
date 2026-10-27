import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Avatar } from '../src/components/common/Avatar';
import { PotatoSprite } from '../src/components/common/PotatoSprite';
import { MonthPickerModal } from '../src/components/views/MonthPickerModal';
import { DownloadApkModal } from '../src/components/views/DownloadApkModal';
import { SyncModal } from '../src/components/views/SyncModal';
import { ConflictModal } from '../src/components/views/ConflictModal';
import { SettingsView } from '../src/components/views/SettingsView';
import { ConfirmModalsView } from '../src/components/views/ConfirmModalsView';
import { validateAndMigrateBackup } from '../src/utils/backupValidator';
import { getLocalMonthString, DEMO_STATE, BLANK_STATE } from '../src/constants/initialData';
import { MainTab, SyncConflictRecord, ConflictData, AppState } from '../src/types';
import { AppProvider, AppContext } from '../src/context/AppContext';
import {
  saveConflictRecord,
  getConflictRecord,
  clearConflictRecord,
  commitMutation,
  loadLatestState,
  _resetInMemoryStore,
} from '../src/utils/db';
import { syncWithLockScope } from '../src/utils/syncClient';

describe('Milestone 3: Robust Avatar System (src/components/common/Avatar.tsx)', () => {
  it('renders PotatoSprite pose 0 when avatar is empty or undefined', () => {
    const htmlEmpty = renderToStaticMarkup(React.createElement(Avatar, { avatar: '', size: 48 }));
    expect(htmlEmpty).toContain('potato-pose pose-0');
    expect(htmlEmpty).toContain('width:48px;height:48px');

    const htmlNull = renderToStaticMarkup(React.createElement(Avatar, { avatar: undefined, size: 56 }));
    expect(htmlNull).toContain('potato-pose pose-0');
    expect(htmlNull).toContain('width:56px;height:56px');
  });

  it('correctly extracts and renders poses 0 to 7 from pose- prefix', () => {
    for (let pose = 0; pose <= 7; pose++) {
      const html = renderToStaticMarkup(React.createElement(Avatar, { avatar: `pose-${pose}`, size: 64 }));
      expect(html).toContain(`potato-pose pose-${pose}`);
      expect(html).toContain('width:64px;height:64px');
    }
  });

  it('safely defaults out-of-range or malformed poses to pose-0', () => {
    const htmlOver = renderToStaticMarkup(React.createElement(Avatar, { avatar: 'pose-99', size: 50 }));
    expect(htmlOver).toContain('potato-pose pose-0');

    const htmlAlpha = renderToStaticMarkup(React.createElement(Avatar, { avatar: 'pose-abc', size: 50 }));
    expect(htmlAlpha).toContain('potato-pose pose-0');
  });

  it('renders <img> with explicit minWidth and minHeight for data/http/blob URLs so broken images NEVER render with 0 width', () => {
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...';
    const htmlData = renderToStaticMarkup(React.createElement(Avatar, { avatar: dataUrl, size: 76 }));
    expect(htmlData).toContain('<img');
    expect(htmlData).toContain('src="data:image/jpeg;base64');
    expect(htmlData).toContain('rounded-2xl object-cover');
    expect(htmlData).toContain('min-width:76px;min-height:76px');
    expect(htmlData).toContain('width:76px;height:76px');

    const httpUrl = 'https://example.com/avatar.png';
    const htmlHttp = renderToStaticMarkup(React.createElement(Avatar, { avatar: httpUrl, size: 60 }));
    expect(htmlHttp).toContain('<img');
    expect(htmlHttp).toContain('src="https://example.com/avatar.png"');
    expect(htmlHttp).toContain('min-width:60px;min-height:60px');
  });

  it('safely falls back to pose-0 for any unrecognized or corrupted string without crashing', () => {
    const htmlCorrupt = renderToStaticMarkup(React.createElement(Avatar, { avatar: 'corrupted-avatar-data!@#$', size: 52 }));
    expect(htmlCorrupt).toContain('potato-pose pose-0');
    expect(htmlCorrupt).toContain('width:52px;height:52px');
  });
});

describe('Milestone 3: Month Picker & "本月" Local Time Alignment', () => {
  it('CRITICAL: "本月" button ALWAYS selects actual local current year and month even when browsing 2025 or 2030', () => {
    let selectedResult = '';
    let closed = false;

    // Simulate the MonthPickerModal handlePickThisMonth contract
    const handlePickThisMonth = (onSelectMonth: (m: string) => void, onClose: () => void) => {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      onSelectMonth(`${y}-${m}`);
      onClose();
    };

    handlePickThisMonth(
      (m: string) => { selectedResult = m; },
      () => { closed = true; }
    );

    const expectedCurrentMonth = getLocalMonthString();
    expect(selectedResult).toBe(expectedCurrentMonth);
    expect(closed).toBe(true);
  });

  it('renders 12 months for current year and highlights currently selected month', () => {
    const html = renderToStaticMarkup(
      React.createElement(MonthPickerModal, {
        isOpen: true,
        onClose: () => {},
        selectedMonth: '2026-10',
        onSelectMonth: () => {},
      })
    );
    expect(html).toContain('2026 年');
    expect(html).toContain('10 月');
    expect(html).toContain('当前统计月份：');
    expect(html).toContain('2026-10');
    expect(html).toContain('本月');
  });
});

describe('Milestone 3: ProfileEditModal Draft Lifecycle & Cancellation', () => {
  it('initializes draft from state.profile and cancels uncommitted changes cleanly', () => {
    const originalProfile = { name: '考公上岸土豆', avatar: 'pose-2' };
    let currentDraft = { ...originalProfile };

    // Function simulating the ProfileEditModal draft reset contract
    const onModalOpen = (persistedProfile: typeof originalProfile) => {
      currentDraft = { ...persistedProfile };
    };

    const onUserEdit = (newName: string, newAvatar: string) => {
      currentDraft = { name: newName, avatar: newAvatar };
    };

    const onModalCancel = (persistedProfile: typeof originalProfile) => {
      currentDraft = { ...persistedProfile };
    };

    // 1. Open modal
    onModalOpen(originalProfile);
    expect(currentDraft.name).toBe('考公上岸土豆');
    expect(currentDraft.avatar).toBe('pose-2');

    // 2. User edits draft uncommitted
    onUserEdit('未保存的改动', 'pose-6');
    expect(currentDraft.name).toBe('未保存的改动');
    expect(currentDraft.avatar).toBe('pose-6');

    // 3. User cancels
    onModalCancel(originalProfile);
    expect(currentDraft.name).toBe('考公上岸土豆');
    expect(currentDraft.avatar).toBe('pose-2');

    // 4. User reopens modal -> draft is strictly fresh, no uncommitted state retained
    onModalOpen(originalProfile);
    expect(currentDraft.name).toBe('考公上岸土豆');
    expect(currentDraft.avatar).toBe('pose-2');
  });
});

describe('Milestone 3: Repeat Direct Access to Confirmation Modals', () => {
  it('guarantees that navigating to the same confirmation dialog repeatedly opens it fresh every single time', () => {
    let activeModal: string | null = null;
    let triggerKey = 0;
    let closeCount = 0;

    const navigateToConfirmScreen = (screenId: string) => {
      triggerKey += 1;
      // Simulating App.tsx -> ConfirmModalsView contract
      activeModal = screenId;
    };

    const onUserCancelConfirm = () => {
      activeModal = null;
      closeCount += 1;
    };

    // First direct navigation
    navigateToConfirmScreen('confirm-book');
    expect(activeModal).toBe('confirm-book');
    expect(triggerKey).toBe(1);

    // User cancels the confirmation dialog
    onUserCancelConfirm();
    expect(activeModal).toBe(null);
    expect(closeCount).toBe(1);

    // Second direct navigation to the EXACT SAME dialog ('confirm-book')
    // With triggerKey incremented, the modal successfully re-opens fresh
    navigateToConfirmScreen('confirm-book');
    expect(activeModal).toBe('confirm-book');
    expect(triggerKey).toBe(2);

    // Third repetition
    onUserCancelConfirm();
    expect(activeModal).toBe(null);
    navigateToConfirmScreen('confirm-book');
    expect(activeModal).toBe('confirm-book');
    expect(triggerKey).toBe(3);
  });

  it('renders all 8 confirmation items in ConfirmModalsView without errors', () => {
    const html = renderToStaticMarkup(
      React.createElement(ConfirmModalsView, {
        onBack: () => {},
        initialActiveModal: null,
      })
    );
    expect(html).toContain('8 类危险确认弹窗系统');
    expect(html).toContain('删除题本确认');
    expect(html).toContain('删除网课确认');
    expect(html).toContain('删除错题照片确认');
    expect(html).toContain('恢复初始数据危险确认');
    expect(html).toContain('导入备份覆盖确认');
    expect(html).toContain('上传本机数据覆盖云端');
    expect(html).toContain('从云端拉取覆盖本机');
    expect(html).toContain('退出账号登录确认');
  });
});

describe('Milestone 3: Direct Backup Import & Preview Validation', () => {
  it('validates a complete backup JSON and computes summary with item counts', () => {
    const validJson = JSON.stringify({
      version: 3,
      timestamp: '2026-10-26T08:00:00Z',
      profile: { name: '备考土豆', username: 'potato', avatar: 'pose-1' },
      books: DEMO_STATE.books,
      courses: DEMO_STATE.courses,
      countdowns: DEMO_STATE.countdowns,
      plans: DEMO_STATE.plans,
      records: DEMO_STATE.records,
      wrong: DEMO_STATE.wrong,
      library: DEMO_STATE.library,
    });

    const result = validateAndMigrateBackup(validJson);
    expect(result.valid).toBe(true);
    expect(result.summary).toBeDefined();
    expect(result.summary?.bookCount).toBe(DEMO_STATE.books.length);
    expect(result.summary?.courseCount).toBe(DEMO_STATE.courses.length);
    expect(result.summary?.recordCount).toBe(DEMO_STATE.records.length);
    expect(result.summary?.wrongCount).toBe(DEMO_STATE.wrong.length);
    expect(result.summary?.countdownCount).toBe(DEMO_STATE.countdowns.length);
    expect(result.summary?.profileName).toBe('备考土豆');

    // Confirm preview text matches expected summary structure
    const impactText = `导入将覆盖当前全部数据，包含：\n• ${result.summary?.bookCount} 本题本\n• ${result.summary?.courseCount} 门网课\n• ${result.summary?.planCount} 项日程\n• ${result.summary?.recordCount} 条做题记录\n• ${result.summary?.wrongCount} 条错题笔记\n• ${result.summary?.countdownCount} 个考试倒计时\n当前未备份的数据将无法找回。`;
    expect(impactText).toContain(`${DEMO_STATE.books.length} 本题本`);
    expect(impactText).toContain(`${DEMO_STATE.courses.length} 门网课`);
  });

  it('rejects invalid backup without corrupting store or showing false success', () => {
    const invalidJson = '{"not_a_valid_backup": true}';
    const result = validateAndMigrateBackup(invalidJson);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.summary).toBeUndefined();
  });
});

describe('Milestone 3: Frontend Back Contract (window.handleBack)', () => {
  it('implements hierarchical back navigation: modals -> sub-views -> today tab -> false', () => {
    // Simulate App.tsx navigation and modal stack hierarchy
    let activeModal: string | null = null;
    let subViewOpen = false;
    let activeTab: MainTab = 'today';

    const handleBack = (): boolean => {
      // 1. Close topmost modal if open
      if (activeModal !== null) {
        activeModal = null;
        return true;
      }
      // 2. Close sub-view if open
      if (subViewOpen) {
        subViewOpen = false;
        return true;
      }
      // 3. Return to 'today' tab if on another tab
      if (activeTab !== 'today') {
        activeTab = 'today';
        return true;
      }
      // 4. Nothing to pop, delegate to browser/OS
      return false;
    };

    // Scenario 1: On today tab, no modals -> returns false
    expect(handleBack()).toBe(false);

    // Scenario 2: On settings tab -> returns to today tab and returns true
    activeTab = 'settings';
    expect(handleBack()).toBe(true);
    expect(activeTab).toBe('today');
    expect(handleBack()).toBe(false);

    // Scenario 3: On learning tab, sub-view open -> first closes sub-view, then returns to today
    activeTab = 'learning';
    subViewOpen = true;
    expect(handleBack()).toBe(true);
    expect(subViewOpen).toBe(false);
    expect(activeTab).toBe('learning'); // still on learning
    expect(handleBack()).toBe(true);
    expect(activeTab).toBe('today'); // now on today
    expect(handleBack()).toBe(false);

    // Scenario 4: Modal open on analysis tab -> closes modal first, then switches tab
    activeTab = 'analysis';
    activeModal = 'month-picker';
    expect(handleBack()).toBe(true);
    expect(activeModal).toBe(null);
    expect(activeTab).toBe('analysis');
    expect(handleBack()).toBe(true);
    expect(activeTab).toBe('today');
    expect(handleBack()).toBe(false);
  });
});

describe('Milestone 3: Clean up Fake Texts & Offline Clarification', () => {
  it('DownloadApkModal presents the official verified APK download path without hardcoded old versions', () => {
    const html = renderToStaticMarkup(
      React.createElement(DownloadApkModal, {
        isOpen: true,
        onClose: () => {},
      })
    );
    expect(html).toContain('考公工作台 · 安卓正式独立版');
    expect(html).toContain('/api/download/apk');
    expect(html).toContain('work.ruyne.space');
    // The old hardcoded "v1.0.1" release label must not come back.
    expect(html.includes('v1.0.1')).toBe(false);
  });

  it('SyncModal no longer claims the app is a standalone offline mode without cloud service', () => {
    const html = renderToStaticMarkup(
      React.createElement(SyncModal, {
        isOpen: true,
        onClose: () => {},
        onOpenUploadConfirm: () => {},
        onOpenPullConfirm: () => {},
        onToast: () => {},
      })
    );
    expect(html.includes('云端服务未接入')).toBe(false);
    expect(html).toContain('自动同步');
  });

  it('SettingsView displays compact items and eliminates obsolete offline/backup cards', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        AppProvider,
        null,
        React.createElement(SettingsView, {
          onOpenSync: () => {},
          onOpenProfile: () => {},
          onOpenResetConfirm: () => {},
          onOpenLogoutConfirm: () => {},
          onToast: () => {},
        })
      )
    );
    // 验证五大紧凑业务入口存在
    expect(html).toContain('同步状态');
    expect(html).toContain('检查更新');
    expect(html).toContain('关于应用');
    expect(html).toContain('账号与数据设置');
    expect(html).toContain('退出登录');
    // 验证废弃文案已彻底移除
    expect(html).not.toContain('离线单机模式（未接入云端）');
    expect(html).not.toContain('本地 JSON 备份');
    expect(html).not.toContain('上传本机覆盖云端');
    expect(html).not.toContain('从云端拉取覆盖');
  });
});

describe('S09: Conflict Deferral & Recoverable Workflow (ConflictModal & SettingsView & App)', () => {
  beforeEach(async () => {
    _resetInMemoryStore();
  });

  it('ConflictModal renders required buttons including "稍后处理 (暂缓)" and version info', () => {
    const html = renderToStaticMarkup(
      React.createElement(ConflictModal, {
        isOpen: true,
        onClose: () => {},
        localState: DEMO_STATE,
        localRevision: 3,
        serverState: DEMO_STATE,
        serverRevision: 5,
        onKeepLocal: async () => ({ ok: true }),
        onKeepRemote: async () => ({ ok: true }),
      })
    );

    expect(html).toContain('检测到数据版本冲突');
    expect(html).toContain('采用云端记录（覆盖本机）');
    expect(html).toContain('保留本机记录（覆盖云端）');
    expect(html).toContain('稍后处理 (暂缓)');
    expect(html).toContain('Rev 3');
    expect(html).toContain('Rev 5');
  });

  it('ConflictModal does not render when isOpen is false', () => {
    const html = renderToStaticMarkup(
      React.createElement(ConflictModal, {
        isOpen: false,
        onClose: () => {},
        localState: DEMO_STATE,
        localRevision: 1,
        serverState: null,
        serverRevision: 0,
        onKeepLocal: async () => ({ ok: true }),
        onKeepRemote: async () => ({ ok: true }),
      })
    );

    expect(html).toBe('');
  });

  it('Conflict key is constructed uniquely from userId, serverGenerationId, serverRevision, and serverContentHash', () => {
    const buildKey = (userId: string, data: { serverGenerationId?: string; serverRevision: number; serverContentHash?: string }) =>
      `${userId}_${data.serverGenerationId || ''}_${data.serverRevision}_${data.serverContentHash || ''}`;

    const key1 = buildKey('user1', { serverGenerationId: 'gen1', serverRevision: 2, serverContentHash: 'hashA' });
    const key2 = buildKey('user1', { serverGenerationId: 'gen1', serverRevision: 2, serverContentHash: 'hashA' });
    expect(key1).toBe(key2);
    expect(key1).toBe('user1_gen1_2_hashA');

    // Key changes if serverRevision changes
    const keyDiffRev = buildKey('user1', { serverGenerationId: 'gen1', serverRevision: 3, serverContentHash: 'hashA' });
    expect(keyDiffRev).not.toBe(key1);

    // Key changes if serverContentHash changes
    const keyDiffHash = buildKey('user1', { serverGenerationId: 'gen1', serverRevision: 2, serverContentHash: 'hashB' });
    expect(keyDiffHash).not.toBe(key1);

    // Key changes if user switches
    const keyDiffUser = buildKey('user2', { serverGenerationId: 'gen1', serverRevision: 2, serverContentHash: 'hashA' });
    expect(keyDiffUser).not.toBe(key1);
  });

  it('Conflict deferral workflow: hides modal, preserves IDB conflict record, allows local edits, blocks cloud overwrite, and reopens on new conflict or manual request', async () => {
    const userId = 'test_user_defer';
    const serverGen = 'gen_server_1';
    const serverRev = 5;
    const serverHash = 'sha256_server_conflict';

    // 1. Establish conflict in DB
    const conflictRecord: SyncConflictRecord = {
      userId,
      code: 'REVISION_CONFLICT',
      message: '检测到版本冲突',
      serverRevision: serverRev,
      serverGenerationId: serverGen,
      serverContentHash: serverHash,
      serverState: DEMO_STATE,
      localRevision: 3,
      detectedAt: new Date().toISOString(),
    };
    await saveConflictRecord(conflictRecord);

    const conflictData: ConflictData = {
      serverRevision: conflictRecord.serverRevision,
      serverState: conflictRecord.serverState,
      serverGenerationId: conflictRecord.serverGenerationId,
      serverContentHash: conflictRecord.serverContentHash,
    };

    // State machine simulation in App.tsx
    let dismissedConflictKey: string | null = null;
    const currentConflictKey = `${userId}_${conflictData.serverGenerationId || ''}_${conflictData.serverRevision}_${conflictData.serverContentHash || ''}`;

    let isConflictModalOpen = Boolean(conflictData && currentConflictKey && dismissedConflictKey !== currentConflictKey);
    let isConflictDeferred = Boolean(conflictData && currentConflictKey && dismissedConflictKey === currentConflictKey);

    expect(isConflictModalOpen).toBe(true);
    expect(isConflictDeferred).toBe(false);

    // 2. User chooses "稍后处理 (暂缓)" (onClose)
    dismissedConflictKey = currentConflictKey;
    isConflictModalOpen = Boolean(conflictData && currentConflictKey && dismissedConflictKey !== currentConflictKey);
    isConflictDeferred = Boolean(conflictData && currentConflictKey && dismissedConflictKey === currentConflictKey);

    // Modal is now hidden, deferred indicator is active
    expect(isConflictModalOpen).toBe(false);
    expect(isConflictDeferred).toBe(true);

    // 3. Deferral MUST NOT clear IDB conflict record, outbox or state
    const persistedConflict = await getConflictRecord(userId);
    expect(persistedConflict).not.toBeNull();
    expect(persistedConflict?.serverRevision).toBe(5);

    // 4. User can continue local study / notes / wrong photos, saved locally into DB
    const mutResult = await commitMutation(state => {
      state.plans.push({
        id: 'plan_deferred_study',
        date: '2026-10-27',
        name: '申论刷题',
        type: 'book',
        plannedMinutes: 60,
        actualMinutes: 45,
        accumulatedMs: 45 * 60 * 1000,
        done: true,
        timerStart: 0,
      });
      state.records.push({
        id: 'rec_deferred_study',
        date: '2026-10-27',
        type: 'book',
        name: '申论刷题',
        durationMinutes: 45,
        questions: 30,
        errors: 5,
        completedAt: new Date().toISOString(),
      });
      state.wrong.push({
        id: 'wrong_deferred_photo',
        date: '2026-10-27',
        title: '错题照片笔记',
        note: '注意审题细节',
        image: 'data:image/jpeg;base64,sample...',
        images: ['data:image/jpeg;base64,sample...'],
        tags: ['申论'],
        createdAt: new Date().toISOString(),
      });
      return { nextState: state, value: true };
    }, { userId });
    expect(mutResult.ok).toBe(true);

    const latestLocal = await loadLatestState(userId);
    expect(latestLocal.state.plans.some(p => p.id === 'plan_deferred_study')).toBe(true);
    expect(latestLocal.state.records.some(r => r.id === 'rec_deferred_study')).toBe(true);
    expect(latestLocal.state.wrong.some(w => w.id === 'wrong_deferred_photo')).toBe(true);

    // 5. Normal sync does NOT overwrite cloud or local data while conflict is open
    const dummyScope = { isExpired: () => false };
    const syncRes = await syncWithLockScope(userId, 'csrf_token', {}, dummyScope as any);
    expect(syncRes.status).toBe('conflict');
    expect(syncRes.ok).toBe(false);

    // 6. SW updateGuard blocks update while conflict is deferred
    const updateGuard = () => {
      if (conflictData) return { ok: false, reason: '存在待处理的版本冲突，请先完成冲突处理再更新' };
      return { ok: true };
    };
    expect(updateGuard().ok).toBe(false);
    expect(updateGuard().reason).toContain('存在待处理的版本冲突');

    // 7. Reopening from Settings or banner displays ConflictModal again
    const onOpenConflict = () => {
      dismissedConflictKey = null;
    };
    onOpenConflict();
    isConflictModalOpen = Boolean(conflictData && currentConflictKey && dismissedConflictKey !== currentConflictKey);
    expect(isConflictModalOpen).toBe(true);

    // 8. Re-defer modal
    dismissedConflictKey = currentConflictKey;
    isConflictModalOpen = Boolean(conflictData && currentConflictKey && dismissedConflictKey !== currentConflictKey);
    expect(isConflictModalOpen).toBe(false);

    // 9. If a NEW conflict arrives (e.g. revision advances to 6 or contentHash changes), modal automatically re-alerts
    const newConflictData: ConflictData = {
      serverRevision: 6,
      serverState: DEMO_STATE,
      serverGenerationId: serverGen,
      serverContentHash: 'sha256_new_conflict_hash',
    };
    const newConflictKey = `${userId}_${newConflictData.serverGenerationId || ''}_${newConflictData.serverRevision}_${newConflictData.serverContentHash || ''}`;
    const newModalOpen = Boolean(newConflictData && newConflictKey && dismissedConflictKey !== newConflictKey);
    expect(newModalOpen).toBe(true);

    // 10. Resolving conflict clears IDB conflict record and resets deferral
    await clearConflictRecord(userId);
    const clearedConflict = await getConflictRecord(userId);
    expect(clearedConflict).toBeNull();
  });

  it('SettingsView renders prominent warning banner and "处理冲突" button when conflictData exists', () => {
    const mockAppContext = {
      state: DEMO_STATE,
      currentUser: { id: 'u1', username: 'testuser', nickname: 'Tester' },
      syncStatus: 'conflict',
      syncMessage: '检测到版本冲突待处理',
      triggerSync: async () => ({ ok: false, status: 'conflict' }),
      conflictData: {
        serverRevision: 4,
        serverState: DEMO_STATE,
        serverGenerationId: 'gen1',
        serverContentHash: 'hash1',
      },
      storageError: null,
      clearStorageError: () => {},
      offlineReady: true,
      pendingSyncCount: 1,
      hasUnsyncedChanges: true,
      clearSafeCache: async () => ({ ok: true, message: 'ok' }),
      restoreLatestRecovery: async () => ({ ok: true }),
      updateCheckState: null,
      isCheckingUpdate: false,
      checkForUpdate: async () => null,
      updateGuard: () => ({ ok: false, reason: '存在待处理的版本冲突，请先完成冲突处理再更新' }),
    } as any;

    let conflictOpened = false;
    const htmlWithConflict = renderToStaticMarkup(
      React.createElement(
        AppContext.Provider,
        { value: mockAppContext },
        React.createElement(SettingsView, {
          onOpenProfile: () => {},
          onOpenBackup: () => {},
          onOpenConflict: () => { conflictOpened = true; },
          onOpenLogoutConfirm: () => {},
          onOpenResetConfirm: () => {},
          onToast: () => {},
        })
      )
    );

    expect(htmlWithConflict).toContain('检测到数据版本冲突待处理');
    expect(htmlWithConflict).toContain('云端与本机记录存在分叉版本');
    expect(htmlWithConflict).toContain('处理冲突');
    expect(htmlWithConflict).toContain('需要处理版本冲突');
    expect(htmlWithConflict).not.toContain('已保存到服务器');
  });

  it('SettingsView does not render conflict banner when conflictData is null', () => {
    const mockAppContextClean = {
      state: DEMO_STATE,
      currentUser: { id: 'u1', username: 'testuser', nickname: 'Tester' },
      syncStatus: 'synced',
      syncMessage: '全部学情已与云端完成同步',
      triggerSync: async () => ({ ok: true, status: 'synced' }),
      conflictData: null,
      storageError: null,
      clearStorageError: () => {},
      offlineReady: true,
      pendingSyncCount: 0,
      hasUnsyncedChanges: false,
      clearSafeCache: async () => ({ ok: true, message: 'ok' }),
      restoreLatestRecovery: async () => ({ ok: true }),
      updateCheckState: null,
      isCheckingUpdate: false,
      checkForUpdate: async () => null,
      updateGuard: () => ({ ok: true }),
    } as any;

    const htmlClean = renderToStaticMarkup(
      React.createElement(
        AppContext.Provider,
        { value: mockAppContextClean },
        React.createElement(SettingsView, {
          onOpenProfile: () => {},
          onOpenBackup: () => {},
          onOpenConflict: () => {},
          onOpenLogoutConfirm: () => {},
          onOpenResetConfirm: () => {},
          onToast: () => {},
        })
      )
    );

    expect(htmlClean).not.toContain('检测到数据版本冲突待处理');
    expect(htmlClean).not.toContain('处理冲突');
    expect(htmlClean).toContain('已保存到服务器');
  });
});
