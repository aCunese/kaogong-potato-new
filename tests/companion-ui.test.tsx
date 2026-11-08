import { expect, it, describe } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppContext } from '../src/context/AppContext';
import { BLANK_STATE } from '../src/constants/initialData';
import { TodayView } from '../src/components/views/TodayView';
import { CompanionNoteDetailModal } from '../src/components/views/CompanionNoteDetailModal';
import { EditCompanionNoteModal } from '../src/components/views/EditCompanionNoteModal';
import { SharingModal } from '../src/components/views/SharingModal';
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
    expect(html).toContain('14:00 (下午起步 · 推荐)');
    expect(html).toContain('规则说明');
    expect(html).toContain('伙伴列表');
    expect(html).toContain('正在读取伙伴列表…');
  });
});

