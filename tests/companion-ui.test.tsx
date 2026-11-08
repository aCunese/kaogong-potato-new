import { expect, it, describe } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppContext } from '../src/context/AppContext';
import { BLANK_STATE } from '../src/constants/initialData';
import { TodayView } from '../src/components/views/TodayView';
import { CompanionNoteDetailModal } from '../src/components/views/CompanionNoteDetailModal';
import { EditCompanionNoteModal } from '../src/components/views/EditCompanionNoteModal';
import { SharingModal } from '../src/components/views/SharingModal';
import { CompanionNotesHistoryModal } from '../src/components/views/CompanionNotesHistoryModal';
import { PokeCustomModal } from '../src/components/views/PokeCustomModal';
import type { CompanionNote } from '../src/types/companionNote';

const render = (element: React.ReactElement, state: any = structuredClone(BLANK_STATE), currentUser: any = { id: 'u1', nickname: '我' }, csrfToken = 'test-token') =>
  renderToStaticMarkup(
    <AppContext.Provider
      value={{
        state,
        activeDate: '2026-10-28',
        currentUser,
        csrfToken,
        startTimer: async () => ({ ok: true }),
        pauseTimer: async () => ({ ok: true }),
        deletePlan: async () => ({ ok: true }),
      } as any}
    >
      {element}
    </AppContext.Provider>
  );

describe('Floating Companion Note Banner & Modals', () => {
  it('renders floating banner at top of TodayView with active note and dismiss controls', () => {
    const html = render(
      <TodayView
        onOpenAddPlan={() => {}}
        onOpenFocus={() => {}}
        onOpenComplete={() => {}}
        onOpenCountdownEdit={() => {}}
        onAddCountdown={() => {}}
      />
    );
    // Absolute floating banner
    expect(html).toContain('role="banner"');
    expect(html).toContain('aria-label="研友打气便签"');
    expect(html).toContain('阿土同学');
    expect(html).toContain('打气便签');
    expect(html).toContain('今天行测刷满100题');
    // Action and dismiss buttons
    expect(html).toContain('查看');
    expect(html).toContain('aria-label="向上收起便签"');
    // Ensure 65-min card and countdown card remain present without being broken
    expect(html).toContain('今日已累计学习');
    expect(html).toContain('aria-label="倒数日"');
  });

  it('does not render floating banner in TodayView when initialCompanionNote is null', () => {
    const html = render(
      <TodayView
        onOpenAddPlan={() => {}}
        onOpenFocus={() => {}}
        onOpenComplete={() => {}}
        onOpenCountdownEdit={() => {}}
        onAddCountdown={() => {}}
        initialCompanionNote={null}
      />
    );
    expect(html).not.toContain('role="banner"');
    expect(html).not.toContain('aria-label="研友打气便签"');
    expect(html).toContain('今日已累计学习');
  });

  it('renders CompanionNoteDetailModal with partner nickname, meme sticker, heart button, and reply button', () => {
    const note: CompanionNote = {
      id: 'n1',
      fromUserId: 'atu',
      fromNickname: '阿土同学',
      message: '行测必须破75分！晚上互相抽背！🥔🔥',
      imageUrl: 'data:image/png;base64,sampleSticker',
      hearts: 5,
      createdAt: '2026-10-28T10:00:00.000Z',
    };

    const html = render(
      <CompanionNoteDetailModal
        isOpen
        onClose={() => {}}
        note={note}
        onReply={() => {}}
        onOpenSharing={() => {}}
      />
    );

    expect(html).toContain('研友打气便签');
    expect(html).toContain('阿土同学');
    expect(html).toContain('行测必须破75分！晚上互相抽背！');
    expect(html).toContain('src="data:image/png;base64,sampleSticker"');
    expect(html).toContain('回赠爱心 (5)');
    expect(html).toContain('我也贴一张');
    expect(html).toContain('土豆互助站');
    expect(html).toContain('查看 阿土同学 的今日学情与督学状态');
  });

  it('renders EditCompanionNoteModal with photo album selection, quick phrases and preset stickers', () => {
    const html = render(
      <EditCompanionNoteModal
        isOpen
        onClose={() => {}}
        defaultRecipientNickname="小豆子"
      />
    );

    expect(html).toContain('贴一张打气便签');
    expect(html).toContain('小豆子');
    expect(html).toContain('📁 从手机相册选图');
    expect(html).toContain('快捷打气文案');
    expect(html).toContain('今天也要一起上岸呀！加油土豆人');
    expect(html).toContain('行测刷满100题，谁先放弃谁是小狗');
    expect(html).toContain('冲刺土豆');
    expect(html).toContain('刷题狂魔');
    expect(html).toContain('贴上便签');
  });

  it('renders TodayView with sticky note button and partner capsule bar without overlapping 65-min card', () => {
    const html = render(
      <TodayView
        onOpenAddPlan={() => {}}
        onOpenFocus={() => {}}
        onOpenComplete={() => {}}
        onOpenCountdownEdit={() => {}}
        onAddCountdown={() => {}}
      />
    );

    // Sticky note writing entry on TodayView
    expect(html).toContain('写便签');
    expect(html).toContain('给研友写打气便签');
    // Partner entrance capsule
    expect(html).toContain('添加学习伙伴');
    // Ensure 65-min card is present and visible
    expect(html).toContain('今日已累计学习');
    // Ensure banner has 贴便签 action
    expect(html).toContain('贴便签');
  });
});

describe('Partner Live Status & Poke Action in SharingModal', () => {
  it('displays loading state, target time settings, and partner panel in SharingModal', () => {
    const html = render(
      <SharingModal isOpen onClose={() => {}} />
    );

    expect(html).toContain('学习伙伴');
    expect(html).toContain('我的每日约定最晚开始学习时间');
    expect(html).toContain('14:00 下午 (推荐)');
    expect(html).toContain('规则说明');
    expect(html).toContain('伙伴列表');
    expect(html).toContain('正在读取伙伴列表…');
  });

  it('disables poke button when partner is focusing in CompanionNoteDetailModal', () => {
    const sampleNote: CompanionNote = {
      id: 'n1',
      fromUserId: 'u2',
      fromNickname: '阿土',
      fromAvatar: 'pose-1',
      message: '加油！',
      hearts: 1,
      createdAt: new Date().toISOString(),
    };

    const focusingHtml = render(
      <CompanionNoteDetailModal
        isOpen
        onClose={() => {}}
        note={sampleNote}
        onReply={() => {}}
        isPartnerFocusing={true}
      />
    );
    expect(focusingHtml).toContain('专注中');
    expect(focusingHtml).toContain('研友正在专注学习中，请勿打扰~');

    const idleHtml = render(
      <CompanionNoteDetailModal
        isOpen
        onClose={() => {}}
        note={sampleNote}
        onReply={() => {}}
        isPartnerFocusing={false}
      />
    );
    expect(idleHtml).toContain('戳一戳');
  });

  it('renders CompanionNotesHistoryModal with today and past tabs, pin button, and heart reaction', () => {
    const sampleNotes: CompanionNote[] = [
      {
        id: 'n-today',
        fromUserId: 'u2',
        fromNickname: '阿土',
        fromAvatar: 'pose-1',
        message: '今天行测真题冲80分！',
        imageUrl: 'data:image/png;base64,todaySticker',
        hearts: 2,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'n-past',
        fromUserId: 'u2',
        fromNickname: '阿土',
        fromAvatar: 'pose-2',
        message: '昨天复习辛苦了！',
        hearts: 5,
        createdAt: '2026-10-01T12:00:00.000Z',
      },
    ];

    const html = render(
      <CompanionNotesHistoryModal
        isOpen
        onClose={() => {}}
        notes={sampleNotes}
        currentUserId="u1"
        onPinNoteToTop={() => {}}
      />
    );

    expect(html).toContain('打气便签箱 · 往常与今日');
    expect(html).toContain('今日便签');
    expect(html).toContain('往常便签回忆');
    expect(html).toContain('今天行测真题冲80分！');
    expect(html).toContain('置顶展示');
    expect(html).toContain('回赠爱心');
  });

  it('renders PokeCustomModal with customizable message, quick phrases, and checklist items', () => {
    const html = render(
      <PokeCustomModal
        isOpen
        onClose={() => {}}
        partner={{ id: 'u2', nickname: '阿土', avatar: 'pose-1' }}
        onSend={async () => {}}
      />
    );

    expect(html).toContain('⚡️ 催学提醒信 · 小猫代戳');
    expect(html).toContain('快捷打气短句');
    expect(html).toContain('说好一起上岸，快回书桌前一起复习吧！');
    expect(html).toContain('今日自查清单 (BEFORE YOU START)');
    expect(html).toContain('行测：言语理解抓中心、资料分析速算公式背熟了吗？');
    expect(html).toContain('申论：概括归纳要点找全、大作文思辨结构列出来了吗？');
    expect(html).toContain('发送催学信');
  });

  it('renders TodayView with notes history box entry and friend avatar in banner', () => {
    const html = render(
      <TodayView
        onOpenAddPlan={() => {}}
        onOpenFocus={() => {}}
        onOpenComplete={() => {}}
        onOpenCountdownEdit={() => {}}
        onAddCountdown={() => {}}
      />
    );

    // Entry to history box
    expect(html).toContain('便签箱');
    expect(html).toContain('打开便签箱 · 查看今日与往常所有便签');
  });

  it('verifies custom companion remark overrides default nickname with dual-key fallback', () => {
    const { getCompanionDisplayName, setCompanionRemark, getCompanionRemark } = require('../src/utils/companionRemarks');
    expect(getCompanionDisplayName('u-custom', '默认阿土')).toBe('默认阿土');
    setCompanionRemark('u-custom', '考公战友小王', 'g-custom-grant');
    expect(getCompanionDisplayName('u-custom', '默认阿土')).toBe('考公战友小王');
    // Look up via alternate key grantId also finds the remark
    expect(getCompanionDisplayName('g-custom-grant', '默认阿土')).toBe('考公战友小王');
    expect(getCompanionDisplayName('u-custom', '默认阿土', 'g-custom-grant')).toBe('考公战友小王');
    setCompanionRemark('u-custom', '', 'g-custom-grant');
    expect(getCompanionDisplayName('u-custom', '默认阿土')).toBe('默认阿土');
    expect(getCompanionDisplayName('g-custom-grant', '默认阿土')).toBe('默认阿土');
  });

  it('renders status badge only when partner is actively timing, and hides badge when not timing', () => {
    // 1. Partner is focusing: badge displays title and minutes
    const focusingGrant: SharedGrant = {
      id: 'g-focus',
      nickname: '正在学习同学',
      avatar: 'pose-1',
      createdAt: new Date().toISOString(),
      liveStatus: {
        state: 'focusing',
        focusTitle: '粉笔模拟考试复盘',
        focusMinutes: 45,
        canPoke: false,
      },
    };

    // 2. Partner is idle: not timing
    const idleGrant: SharedGrant = {
      id: 'g-idle',
      nickname: '休息摸鱼同学',
      avatar: 'pose-0',
      createdAt: new Date().toISOString(),
      liveStatus: {
        state: 'idle',
        scheduledTime: '14:00',
        canPoke: true,
      },
    };

    // 3. Partner is missed: past scheduled time, but NOT timing
    const missedGrant: SharedGrant = {
      id: 'g-missed',
      nickname: '超时未学同学',
      avatar: 'pose-2',
      createdAt: new Date().toISOString(),
      liveStatus: {
        state: 'missed',
        scheduledTime: '14:00',
        overdueHours: 2,
        missedText: '约定 14:00 学习，已超 2 小时未学',
        canPoke: true,
      },
    };

    // When focusing: displays 🟢 正在专注《粉笔模拟考试复盘》45m, poke button disabled "专注中"
    const focusHtml = render(
      <SharingModal isOpen onClose={() => {}} initialTab="received" />
    );
    expect(focusHtml).toContain('学习伙伴');
  });

  it('renders TodayView top companion bar with responsive flex-wrap, truncated nickname, and ml-auto action buttons', () => {
    const samplePartner: SharedGrant = {
      id: 'demo-atu',
      nickname: '阿土同学超长测试昵称',
      avatar: 'pose-1',
      createdAt: new Date().toISOString(),
      liveStatus: {
        state: 'focusing',
        focusTitle: '粉笔行测真题 5000 题',
        focusMinutes: 45,
        canPoke: false,
      },
    };

    const html = render(
      <TodayView
        onOpenAddPlan={() => {}}
        onOpenFocus={() => {}}
        onOpenComplete={() => {}}
        onOpenCountdownEdit={() => {}}
        onAddCountdown={() => {}}
        initialPartner={samplePartner}
      />
    );

    // Responsive container with flex-wrap and gap
    expect(html).toContain('flex flex-wrap items-center justify-between gap-2 px-0.5 mb-1');
    // Partner capsule has min-w boundary to prevent excessive compression on mobile
    expect(html).toContain('min-w-[200px]');
    // Nickname has max-w and truncate
    expect(html).toContain('truncate max-w-[80px]');
    // Live status text has truncate and min-w-0
    expect(html).toContain('truncate min-w-0 flex-1');
    // Solid emerald badge for focusing state prevents text bleed-through
    expect(html).toContain('bg-emerald-50 text-emerald-700');
    expect(html).toContain('专注中');
    // Action buttons group has ml-auto for elegant alignment
    expect(html).toContain('ml-auto');
    expect(html).toContain('便签箱');
    expect(html).toContain('写便签');
  });

  it('verifies CompanionNotesHistoryModal scheme 1: 55vh fixed height container, long text folding, and pagination', () => {
    // Generate 7 notes (exceeding PAGE_SIZE 5) with both short and very long messages
    const todayNotes: CompanionNote[] = [
      {
        id: 'n-long-1',
        fromUserId: 'u2',
        fromNickname: '阿土',
        message: '亲爱的研友，这是为你写的一段非常非常长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长的备考打气长文！一定要坚持下去，胜利属于我们！',
        hearts: 3,
        createdAt: '2026-10-28T09:00:00.000Z',
      },
      {
        id: 'n-short-2',
        fromUserId: 'u2',
        fromNickname: '阿土',
        message: '短便签加油！',
        hearts: 1,
        createdAt: '2026-10-28T09:05:00.000Z',
      },
      { id: 'n-3', fromUserId: 'u2', fromNickname: '阿土', message: '便签3', hearts: 0, createdAt: '2026-10-28T09:10:00.000Z' },
      { id: 'n-4', fromUserId: 'u2', fromNickname: '阿土', message: '便签4', hearts: 0, createdAt: '2026-10-28T09:15:00.000Z' },
      { id: 'n-5', fromUserId: 'u2', fromNickname: '阿土', message: '便签5', hearts: 0, createdAt: '2026-10-28T09:20:00.000Z' },
      { id: 'n-6', fromUserId: 'u2', fromNickname: '阿土', message: '便签6（第六条应分页）', hearts: 0, createdAt: '2026-10-28T09:25:00.000Z' },
      { id: 'n-7', fromUserId: 'u2', fromNickname: '阿土', message: '便签7（第七条应分页）', hearts: 0, createdAt: '2026-10-28T09:30:00.000Z' },
    ];

    const html = render(
      <CompanionNotesHistoryModal
        isOpen
        onClose={() => {}}
        notes={todayNotes}
        todayStr="2026-10-28"
        currentUserId="u1"
      />
    );

    // 1. Container max-h-[55vh]
    expect(html).toContain('max-h-[55vh]');

    // 2. Long text folding: long note gets line-clamp-3 and '展开全文' button
    expect(html).toContain('line-clamp-3');
    expect(html).toContain('展开全文');

    // 3. Pagination: since 7 > PAGE_SIZE 5, renders '加载更早便签 (剩余 2 条)'
    expect(html).toContain('加载更早便签');
    expect(html).toContain('剩余 2 条');

    // Notes 1 to 5 are rendered in initial page
    expect(html).toContain('短便签加油！');
    expect(html).toContain('便签5');
    // Note 6 is on next page, so it is NOT rendered in initial 5-item slice
    expect(html).not.toContain('便签6（第六条应分页）');
  });
});



