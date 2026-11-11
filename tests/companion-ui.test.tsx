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
import {
  saveCompanionNoteDraft,
  loadCompanionNoteDraft,
  clearCompanionNoteDraft,
} from '../src/utils/companionNoteDraft';

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
    expect(html).toContain('aria-label="学友打气便签"');
    expect(html).toContain('touch-none');
    expect(html).toContain('overflow-hidden');
    expect(html).toContain('max-h-32 mb-2');
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
    expect(html).not.toContain('aria-label="学友打气便签"');
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

    expect(html).toContain('学友打气便签');
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
    expect(html).toContain('给学友写打气便签');
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
    expect(focusingHtml).toContain('学友正在专注学习中，请勿打扰~');

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
        id: 'n-self',
        fromUserId: 'u1',
        fromNickname: '我',
        fromAvatar: 'pose-0',
        message: '我自己发给学友的便签不应该出现在我自己的便签箱中',
        hearts: 0,
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
    expect(html).toContain('今日收到');
    expect(html).toContain('往常回忆');
    expect(html).toContain('我写出的');
    expect(html).toContain('今天行测真题冲80分！');
    expect(html).not.toContain('我自己发给学友的便签不应该出现在我自己的便签箱中');
    expect(html).toContain('置顶展示');
    expect(html).toContain('回赠爱心');
  });

  it('renders CompanionNotesHistoryModal sent tab with recipient info, love back feedback, and re-note button without self-pin/self-heart', () => {
    const sampleNotes: CompanionNote[] = [
      {
        id: 'n-sent-1',
        fromUserId: 'u1',
        fromNickname: '我',
        fromAvatar: 'pose-0',
        toUserId: 'u2',
        toNickname: '阿土',
        toAvatar: 'pose-2',
        message: '今天写给阿土的冲刺打气便签！',
        imageUrl: 'data:image/png;base64,sentSticker',
        hearts: 3,
        createdAt: new Date().toISOString(),
      },
    ];

    const html = render(
      <CompanionNotesHistoryModal
        isOpen
        onClose={() => {}}
        notes={sampleNotes}
        currentUserId="u1"
        initialTab="sent"
        onPinNoteToTop={() => {}}
        onReply={() => {}}
      />
    );

    expect(html).toContain('打气便签箱 · 往常与今日');
    expect(html).toContain('我写出的');
    expect(html).toContain('阿土');
    expect(html).toContain('寄给学友');
    expect(html).toContain('今天写给阿土的冲刺打气便签！');
    expect(html).toContain('学友已回赠 3 颗爱心');
    expect(html).toContain('再贴一张');
    // Cannot self-pin or self-heart in sent tab
    expect(html).not.toContain('置顶展示');
    expect(html).not.toContain('回赠爱心');
  });

  it('correctly categorizes local notes sent as "me" into sent tab and suppresses self actions', () => {
    const localSentNotes: CompanionNote[] = [
      {
        id: 'local-note-1',
        fromUserId: 'me',
        fromNickname: '我',
        toUserId: 'demo-atu',
        toNickname: '阿土同学',
        toAvatar: 'pose-2',
        message: '阿土同学加油！',
        hearts: 0,
        createdAt: new Date().toISOString(),
      },
    ];

    const html = render(
      <CompanionNotesHistoryModal
        isOpen
        onClose={() => {}}
        notes={localSentNotes}
        initialTab="sent"
        onPinNoteToTop={() => {}}
        onReply={() => {}}
      />
    );

    expect(html).toContain('我写出的');
    expect(html).toContain('阿土同学');
    expect(html).toContain('寄给学友');
    expect(html).toContain('阿土同学加油！');
    expect(html).toContain('学友暂未回赠爱心');
    expect(html).toContain('再贴一张');
    expect(html).not.toContain('置顶展示');
    expect(html).not.toContain('>回赠爱心<');
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

  it('renders TodayView companion live status on left with breathing light (green for 学习中, yellow for 未学习) and shows screenshot 3 detail on click', () => {
    const focusingPartner: SharedGrant = {
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

    // 1. Focusing state: compact green breathing light labeled "学习中"
    const focusingHtml = render(
      <TodayView
        onOpenAddPlan={() => {}}
        onOpenFocus={() => {}}
        onOpenComplete={() => {}}
        onOpenCountdownEdit={() => {}}
        onAddCountdown={() => {}}
        initialPartner={focusingPartner}
      />
    );

    // Left indicator has green breathing light and "学习中" label
    expect(focusingHtml).toContain('学习中');
    expect(focusingHtml).toContain('bg-emerald-50 text-emerald-800');
    expect(focusingHtml).toContain('bg-emerald-500');
    expect(focusingHtml).toContain('animate-ping');
    expect(focusingHtml).toContain('animate-pulse');
    // Action buttons group has ml-auto for elegant right alignment
    expect(focusingHtml).toContain('ml-auto');
    expect(focusingHtml).toContain('便签箱');
    expect(focusingHtml).toContain('写便签');

    // 2. Clicked into (showStatusDetail): displays Screenshot 3 content without jumping to friend space
    const detailHtml = render(
      <TodayView
        onOpenAddPlan={() => {}}
        onOpenFocus={() => {}}
        onOpenComplete={() => {}}
        onOpenCountdownEdit={() => {}}
        onAddCountdown={() => {}}
        initialPartner={focusingPartner}
        initialShowStatusDetail={true}
      />
    );

    expect(detailHtml).toContain('正在专注《粉笔行测真题 5000 题》45m');
    expect(detailHtml).toContain('专注中');
    expect(detailHtml).toContain('bg-emerald-50 text-emerald-700');
    expect(detailHtml).toContain('animate-pop-in');
    expect(detailHtml).toContain('rounded-full bg-emerald-50 text-emerald-700');

    // 3. Not focusing state: yellow breathing light labeled "未学习"
    const idlePartner: SharedGrant = {
      id: 'demo-idle',
      nickname: '小敏同学',
      createdAt: new Date().toISOString(),
      liveStatus: {
        state: 'idle',
        canPoke: true,
      },
    };

    const idleHtml = render(
      <TodayView
        onOpenAddPlan={() => {}}
        onOpenFocus={() => {}}
        onOpenComplete={() => {}}
        onOpenCountdownEdit={() => {}}
        onAddCountdown={() => {}}
        initialPartner={idlePartner}
      />
    );

    expect(idleHtml).toContain('未学习');
    expect(idleHtml).toContain('bg-amber-50 text-amber-800');
    expect(idleHtml).toContain('bg-amber-500');

    // Idle detail shows partner not studying + poke action
    const idleDetailHtml = render(
      <TodayView
        onOpenAddPlan={() => {}}
        onOpenFocus={() => {}}
        onOpenComplete={() => {}}
        onOpenCountdownEdit={() => {}}
        onAddCountdown={() => {}}
        initialPartner={idlePartner}
        initialShowStatusDetail={true}
      />
    );
    expect(idleDetailHtml).toContain('小敏同学 未在学习');
    expect(idleDetailHtml).toContain('戳一下');
  });

  it('verifies CompanionNotesHistoryModal scheme 1: 55vh fixed height container, long text folding, break-words, and pagination', () => {
    // Generate 7 notes (exceeding PAGE_SIZE 5) with both short and very long messages including unbroken strings
    const todayNotes: CompanionNote[] = [
      {
        id: 'n-long-1',
        fromUserId: 'u2',
        fromNickname: '阿土',
        message: '亲爱的学友，这是为你写的一段非常非常长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长长的备考打气长文！一定要坚持下去，胜利属于我们！' + 'a'.repeat(80),
        hearts: 3,
        imageUrl: 'https://example.com/sticker.png',
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

    // 2. Long text folding & break-words: long note gets line-clamp-3, break-words and '展开全文' button
    expect(html).toContain('line-clamp-3');
    expect(html).toContain('break-words');
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

  it('saves and restores companion note draft, retaining unsent edits and clearing only on success', () => {
    // 1. Initial state: no draft
    clearCompanionNoteDraft('u1', 'p1');
    expect(loadCompanionNoteDraft('u1', 'p1')).toBeNull();

    // 2. User edits draft with text and sticker image
    saveCompanionNoteDraft('u1', 'p1', undefined, {
      message: '这是未发送成功的考公骚话！',
      imageUrl: 'data:image/png;base64,test-sticker-data',
      imageName: '🔥 刷题狂魔',
    });

    const draft = loadCompanionNoteDraft('u1', 'p1');
    expect(draft).not.toBeNull();
    expect(draft?.message).toBe('这是未发送成功的考公骚话！');
    expect(draft?.imageUrl).toBe('data:image/png;base64,test-sticker-data');
    expect(draft?.imageName).toBe('🔥 刷题狂魔');

    // 2b. Alternate lookup by grantId fallback
    saveCompanionNoteDraft('u2', undefined, 'g1', {
      message: '通过授权ID保存的草稿',
    });
    expect(loadCompanionNoteDraft('u2', 'any-recipient', 'g1')?.message).toBe('通过授权ID保存的草稿');

    // 3. EditCompanionNoteModal automatically restores draft when opened
    const htmlWithDraft = render(
      <EditCompanionNoteModal
        isOpen
        onClose={() => {}}
        defaultRecipientNickname="学友小豆"
        defaultRecipientId="p1"
      />
    );

    expect(htmlWithDraft).toContain('已自动恢复未发送内容');
    expect(htmlWithDraft).toContain('这是未发送成功的考公骚话！');
    expect(htmlWithDraft).toContain('🔥 刷题狂魔');
    expect(htmlWithDraft).toContain('data:image/png;base64,test-sticker-data');

    // 4. Closing or canceling preserves the draft (not cleared)
    expect(loadCompanionNoteDraft('u1', 'p1')).not.toBeNull();

    // 5. Successful send triggers clearCompanionNoteDraft
    clearCompanionNoteDraft('u1', 'p1');
    expect(loadCompanionNoteDraft('u1', 'p1')).toBeNull();

    // Next time opening: clean blank state without restored badge
    const htmlClean = render(
      <EditCompanionNoteModal
        isOpen
        onClose={() => {}}
        defaultRecipientNickname="学友小豆"
        defaultRecipientId="p1"
      />
    );
    expect(htmlClean).not.toContain('已自动恢复未发送内容');
    expect(htmlClean).not.toContain('这是未发送成功的考公骚话！');
  });

  it('TodayView displays pending unregistered study time banner when plans have unrecorded elapsed time and hides when completed', () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const mockStateWithPending = {
      ...BLANK_STATE,
      plans: [
        {
          id: 'p1',
          name: '超格600图推纠错',
          date: todayStr,
          libraryId: 'lib1',
          type: 'book' as const,
          sourceId: 'b1',
          subject: '判断推理' as const,
          plannedMinutes: 60,
          actualMinutes: 45,
          accumulatedMs: 45 * 60 * 1000,
          done: false,
        },
        {
          id: 'p2',
          name: '申论范文精读',
          date: todayStr,
          libraryId: 'lib2',
          type: 'custom' as const,
          sourceId: '',
          subject: '申论' as const,
          plannedMinutes: 30,
          actualMinutes: 30,
          accumulatedMs: 30 * 60 * 1000,
          done: true,
        },
      ],
    };

    const pendingHtml = render(
      <AppContext.Provider value={{ state: mockStateWithPending, dispatch: () => {}, activeDate: todayStr } as any}>
        <TodayView
          onOpenAddPlan={() => {}}
          onOpenFocus={() => {}}
          onOpenComplete={() => {}}
          onOpenCountdownEdit={() => {}}
          onAddCountdown={() => {}}
        />
      </AppContext.Provider>
    );

    // Main summary card includes note about pending registration minutes
    expect(pendingHtml).toContain('今日已累计学习');
    expect(pendingHtml).toContain('含 45 分钟待登记投入');

    // Helper banner above plan list reminds user to click 完成登记
    expect(pendingHtml).toContain('项已投入');
    expect(pendingHtml).toContain('45');
    expect(pendingHtml).toContain('分钟待登记');
    expect(pendingHtml).toContain('完成登记');

    // State with all plans completed: no pending banner
    const mockStateCompleted = {
      ...mockStateWithPending,
      plans: mockStateWithPending.plans.map(p => ({ ...p, done: true })),
    };

    const completedHtml = render(
      <AppContext.Provider value={{ state: mockStateCompleted, dispatch: () => {}, activeDate: todayStr } as any}>
        <TodayView
          onOpenAddPlan={() => {}}
          onOpenFocus={() => {}}
          onOpenComplete={() => {}}
          onOpenCountdownEdit={() => {}}
          onAddCountdown={() => {}}
        />
      </AppContext.Provider>
    );

    expect(completedHtml).not.toContain('待登记投入');
    expect(completedHtml).not.toContain('有 1 项已投入');
  });

  it('SharingModal renders dedicated focus status row in header and helper prompt in SharedOverview without truncation', () => {
    // When focusing: header card has dedicated full-width emerald row
    const demoGrant: SharedGrant = {
      id: 'demo-atu',
      nickname: '阿土同学',
      createdAt: '',
      liveStatus: {
        state: 'focusing',
        focusTitle: '超格600图推纠错',
        focusMinutes: 13,
        pendingMinutes: 119,
      },
    };

    const mockOverview = {
      ownerNickname: '阿土同学',
      updatedAt: new Date().toISOString(),
      range: { from: null, to: null },
      selectedTotals: { minutes: 324, questions: 80, errors: 12, accuracy: 85, lessons: 0 },
      allTimeTotals: { minutes: 324, questions: 80, errors: 12, accuracy: 85, lessons: 0 },
      books: [],
      courses: [],
      records: { items: [], page: 1, pageSize: 30, total: 0 },
      studyDates: [new Date().toISOString().slice(0, 10)],
    };

    const html = render(
      <SharingModal
        isOpen
        onClose={() => {}}
        initialSelectedId="demo-atu"
        initialOverview={mockOverview}
        initialGrants={{ owned: [], received: [demoGrant], codes: [] }}
      />
    );

    // Dedicated focus row prevents mobile truncation and eliminates duplicate green circle emoji
    expect(html).toContain('data-testid="partner-detail-focus-banner"');
    expect(html).toContain('bg-emerald-500');
    expect(html).toContain('正在专注');
    expect(html).not.toContain('🟢 正在专注');
    expect(html).not.toContain('⚡️ 戳一下');
    expect(html).toContain('《超格600图推纠错》');
    expect(html).toContain('13m');

    // SharedOverview explains the discrepancy between recorded 324m and live/pending 119m
    expect(html).toContain('今日学情概况');
    expect(html).toContain('学友当前正在专注《超格600图推纠错》');
    expect(html).toContain('约 13 分钟进行中');
    expect(html).toContain('另有约 106 分钟暂存待登记');
    expect(html).toContain('完成登记');
  });

  it('TodayView handles legacy actualMinutes pending plans, paused <1m vs running <1m copy accurately', () => {
    const todayStr = '2026-11-12';

    // 1. Legacy plan lacking accumulatedMs but with actualMinutes = 25
    const legacyState = {
      ...BLANK_STATE,
      plans: [
        {
          id: 'p-legacy',
          name: '历史字段计划',
          date: todayStr,
          libraryId: 'lib1',
          type: 'custom' as const,
          sourceId: '',
          subject: '申论' as const,
          plannedMinutes: 40,
          actualMinutes: 25,
          timerStart: 0,
          done: false,
        },
      ],
    };
    const legacyHtml = render(
      <TodayView
        onOpenAddPlan={() => {}}
        onOpenFocus={() => {}}
        onOpenComplete={() => {}}
        onOpenCountdownEdit={() => {}}
        onAddCountdown={() => {}}
      />,
      legacyState
    );
    // Note activeDate defaults to 2026-10-28 in helper render, so override activeDate to todayStr:
    const legacyWithDateHtml = renderToStaticMarkup(
      <AppContext.Provider value={{ state: legacyState, dispatch: () => {}, activeDate: todayStr, currentUser: { id: 'u1', nickname: '我' }, csrfToken: 't' } as any}>
        <TodayView
          onOpenAddPlan={() => {}}
          onOpenFocus={() => {}}
          onOpenComplete={() => {}}
          onOpenCountdownEdit={() => {}}
          onAddCountdown={() => {}}
        />
      </AppContext.Provider>
    );
    expect(legacyHtml).toBeTruthy();
    expect(legacyWithDateHtml).toContain('含 25 分钟待登记投入');
    expect(legacyWithDateHtml).toContain('25');

    // 2. Paused <1m plan (45s accumulatedMs, timerStart: 0): MUST NOT say "正在计时中"
    const pausedSubMinState = {
      ...BLANK_STATE,
      plans: [
        {
          id: 'p-submin-paused',
          name: '暂停不到一分钟',
          date: todayStr,
          libraryId: 'lib2',
          type: 'custom' as const,
          sourceId: '',
          subject: '资料分析' as const,
          plannedMinutes: 30,
          actualMinutes: 0,
          accumulatedMs: 45_000,
          timerStart: 0,
          done: false,
        },
      ],
    };
    const pausedHtml = renderToStaticMarkup(
      <AppContext.Provider value={{ state: pausedSubMinState, dispatch: () => {}, activeDate: todayStr, currentUser: { id: 'u1', nickname: '我' }, csrfToken: 't' } as any}>
        <TodayView
          onOpenAddPlan={() => {}}
          onOpenFocus={() => {}}
          onOpenComplete={() => {}}
          onOpenCountdownEdit={() => {}}
          onAddCountdown={() => {}}
        />
      </AppContext.Provider>
    );
    expect(pausedHtml).toContain('已累计不足 1 分钟待登记');
    expect(pausedHtml).not.toContain('正在计时中');

    // 3. Running <1m plan: accurately shows 正在计时中（暂不足 1 分钟）
    const runningSubMinState = {
      ...BLANK_STATE,
      plans: [
        {
          id: 'p-submin-running',
          name: '刚开始计时',
          date: todayStr,
          libraryId: 'lib3',
          type: 'custom' as const,
          sourceId: '',
          subject: '言语理解' as const,
          plannedMinutes: 30,
          actualMinutes: 0,
          accumulatedMs: 0,
          timerStart: Date.now() - 15_000,
          done: false,
        },
      ],
    };
    const runningHtml = renderToStaticMarkup(
      <AppContext.Provider value={{ state: runningSubMinState, dispatch: () => {}, activeDate: todayStr, currentUser: { id: 'u1', nickname: '我' }, csrfToken: 't' } as any}>
        <TodayView
          onOpenAddPlan={() => {}}
          onOpenFocus={() => {}}
          onOpenComplete={() => {}}
          onOpenCountdownEdit={() => {}}
          onAddCountdown={() => {}}
        />
      </AppContext.Provider>
    );
    expect(runningHtml).toContain('正在计时中（暂不足 1 分钟）');
  });

  it('SharingModal uses otherPendingMinutes for Pomodoro sessions and renders untruncated full-width partner list banner', () => {
    const focusingGrant: SharedGrant = {
      id: 'g-pomo',
      nickname: '考研考公双料长昵称学友同学',
      createdAt: '',
      liveStatus: {
        state: 'focusing',
        focusTitle: '超格600图推纠错与资料分析速算高阶专项训练',
        focusMinutes: 25,
        pendingMinutes: 40,
        otherPendingMinutes: 40,
      },
    };
    const missedGrant: SharedGrant = {
      id: 'g-missed',
      nickname: '小豆子',
      createdAt: '',
      liveStatus: {
        state: 'missed',
        scheduledTime: '14:00',
        overdueHours: 2,
        missedText: '约定 14:00 学习，已超 2 小时未学',
        canPoke: true,
      },
    };

    // Partner list card view
    const listHtml = render(
      <SharingModal
        isOpen
        onClose={() => {}}
        initialGrants={{ owned: [], received: [focusingGrant, missedGrant], codes: [] }}
      />
    );
    expect(listHtml).toContain('data-testid="partner-list-focus-banner"');
    expect(listHtml).toContain('《超格600图推纠错与资料分析速算高阶专项训练》');
    expect(listHtml).not.toContain('🟢 正在专注');
    expect(listHtml).not.toContain('⚡️ 戳一戳');
    expect(listHtml).not.toContain('max-w-[180px]');

    // Detail view with explicit otherPendingMinutes (25m Pomodoro + 40m paused plan = show 40m pending, NOT 15m)
    const detailHtml = render(
      <SharingModal
        isOpen
        onClose={() => {}}
        initialSelectedId="g-pomo"
        initialOverview={{
          ownerNickname: '考研考公双料长昵称学友同学',
          updatedAt: new Date().toISOString(),
          range: { from: null, to: null },
          selectedTotals: { minutes: 120, questions: 30, errors: 3, accuracy: 90, lessons: 1 },
          allTimeTotals: { minutes: 500, questions: 300, errors: 30, accuracy: 90, lessons: 5 },
          books: [],
          courses: [],
          records: { items: [], page: 1, pageSize: 30, total: 0 },
          studyDates: ['2026-10-28'],
        }}
        initialGrants={{ owned: [], received: [focusingGrant, missedGrant], codes: [] }}
      />
    );
    expect(detailHtml).toContain('约 25 分钟进行中');
    expect(detailHtml).toContain('另有约 40 分钟暂存待登记');
  });
});




