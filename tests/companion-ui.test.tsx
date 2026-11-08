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

  it('verifies custom companion remark overrides default nickname', () => {
    const { getCompanionDisplayName, setCompanionRemark } = require('../src/utils/companionRemarks');
    expect(getCompanionDisplayName('u-custom', '默认阿土')).toBe('默认阿土');
    setCompanionRemark('u-custom', '考公战友小王');
    expect(getCompanionDisplayName('u-custom', '默认阿土')).toBe('考公战友小王');
    setCompanionRemark('u-custom', '');
    expect(getCompanionDisplayName('u-custom', '默认阿土')).toBe('默认阿土');
  });
});


