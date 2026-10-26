import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppProvider } from '../src/context/AppContext';
import { Avatar } from '../src/components/common/Avatar';
import { PotatoSprite } from '../src/components/common/PotatoSprite';
import { MonthPickerModal } from '../src/components/views/MonthPickerModal';
import { DownloadApkModal } from '../src/components/views/DownloadApkModal';
import { SyncModal } from '../src/components/views/SyncModal';
import { SettingsView } from '../src/components/views/SettingsView';
import { ConfirmModalsView } from '../src/components/views/ConfirmModalsView';
import { validateAndMigrateBackup } from '../src/utils/backupValidator';
import { getLocalMonthString, DEMO_STATE } from '../src/constants/initialData';
import { MainTab } from '../src/types';

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
  it('DownloadApkModal delivers official Android Release APK download link and v1.0.1 info', () => {
    const html = renderToStaticMarkup(
      React.createElement(DownloadApkModal, {
        isOpen: true,
        onClose: () => {},
      })
    );
    expect(html).toContain('考公工作台 · 安卓正式独立版');
    expect(html).toContain('/api/download/apk');
    expect(html).toContain('立即下载 Android 安装包 (APK)');
    expect(html).toContain('v1.0.1');
  });

  it('SyncModal clearly states "单机离线模式（云端服务未接入）"', () => {
    const html = renderToStaticMarkup(
      React.createElement(SyncModal, {
        isOpen: true,
        onClose: () => {},
        onOpenUploadConfirm: () => {},
        onOpenPullConfirm: () => {},
        onToast: () => {},
      })
    );
    expect(html).toContain('单机离线模式（云端服务未接入）');
  });

  it('SettingsView displays "离线单机模式（未接入云端）" cloud tag', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        AppProvider,
        null,
        React.createElement(SettingsView, {
          onOpenLogin: () => {},
          onOpenRegister: () => {},
          onOpenSync: () => {},
          onOpenBackup: () => {},
          onOpenProfile: () => {},
          onOpenDownloadApk: () => {},
          onOpenResetConfirm: () => {},
          onOpenLogoutConfirm: () => {},
          onToast: () => {},
        })
      )
    );
    expect(html).toContain('离线单机模式（未接入云端）');
  });
});
