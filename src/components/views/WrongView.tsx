import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Eye,
  Trash2,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Search,
  Image as ImageIcon,
  LayoutGrid,
  List as ListIcon,
  Grid3X3,
  Plus,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { PotatoSprite } from '../common/PotatoSprite';
import { Button, Card, Tag, CustomSelect } from '../common/UIComponents';
import { FloatingDatePicker } from '../common/FloatingDatePicker';
import { STUDY_SUBJECTS, StudySubject, WrongRecord } from '../../types';
import { SUBJECT_COLORS } from './TimeDistribution';
import {
  resolveWrongRecordSubject,
  getWrongRecordImages,
  formatWrongRecordTime,
  extractWrongRecordTimestamp,
  readPersistedWrongSubject,
  writePersistedWrongSubject,
  WRONG_VIEW_MODE_KEY,
} from '../../utils/workflowMutators';

interface WrongViewProps {
  onOpenImportModal: (presetSubject?: StudySubject) => void;
  onOpenDetailModal: (record: WrongRecord) => void;
  onOpenDeleteConfirm: (recordId: string, categoryName: string) => void;
}

type ViewMode = 'grid2' | 'list' | 'grid3';

function readPersistedViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'grid2';
  try {
    const raw = window.localStorage.getItem(WRONG_VIEW_MODE_KEY);
    if (raw === 'grid2' || raw === 'list' || raw === 'grid3') return raw;
  } catch {
    // ignore storage errors
  }
  return 'grid2';
}

function writePersistedViewMode(mode: ViewMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WRONG_VIEW_MODE_KEY, mode);
  } catch {
    // ignore storage errors
  }
}

export const WrongView: React.FC<WrongViewProps> = ({
  onOpenImportModal,
  onOpenDetailModal,
  onOpenDeleteConfirm,
}) => {
  const { state, activeDate } = useApp();
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedSubject, setSelectedSubject] = useState<'all' | StudySubject>(
    readPersistedWrongSubject
  );
  const [viewMode, setViewMode] = useState<ViewMode>(readPersistedViewMode);
  const [pickerTarget, setPickerTarget] = useState<'from' | 'to' | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pages, setPages] = useState<Record<string, number>>({});
  const touchStartRef = useRef<Record<string, { x: number; y: number }>>({});

  // Sync with category updates triggered by PhotoImportModal
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleSubjectSync = (e: Event) => {
      const custom = e as CustomEvent<'all' | StudySubject>;
      if (custom.detail) {
        setSelectedSubject(custom.detail);
        if (custom.detail !== 'all') {
          setExpanded(prev => ({ ...prev, [custom.detail]: true }));
        }
      }
    };
    window.addEventListener('kaogong-wrong-subject-change', handleSubjectSync);
    return () => window.removeEventListener('kaogong-wrong-subject-change', handleSubjectSync);
  }, []);

  const updateSelectedSubject = (nextSubj: 'all' | StudySubject) => {
    setSelectedSubject(nextSubj);
    writePersistedWrongSubject(nextSubj);
    setPages({});
    if (nextSubj !== 'all') {
      setExpanded(prev => ({ ...prev, [nextSubj]: true }));
    }
  };

  const updateViewMode = (nextMode: ViewMode) => {
    setViewMode(nextMode);
    writePersistedViewMode(nextMode);
    setPages({});
  };

  // Single-screen page size so cards never require long vertical scrolling; flip left/right instead
  const pageSize = viewMode === 'grid3' ? 6 : 4;

  const datesWithWrong = useMemo(
    () => new Set(state.wrong.map(w => w.date)),
    [state.wrong]
  );

  const totalPhotoCount = useMemo(
    () =>
      state.wrong.reduce((sum, w) => {
        const imgs = getWrongRecordImages(w);
        return sum + Math.max(1, imgs.length);
      }, 0),
    [state.wrong]
  );

  const invalidRange = Boolean(from && to && from > to);

  // First filter by date range & search keyword so category dropdown shows accurate counts
  const dateAndQueryFiltered = useMemo(
    () =>
      state.wrong
        .filter(
          w =>
            !invalidRange &&
            (!query.trim() ||
              w.note.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) &&
            (!from || w.date >= from) &&
            (!to || w.date <= to)
        )
        .sort((a, b) => {
          const cmp = b.date.localeCompare(a.date);
          if (cmp !== 0) return cmp;
          return extractWrongRecordTimestamp(b) - extractWrongRecordTimestamp(a);
        }),
    [state.wrong, query, from, to, invalidRange]
  );

  // Group records into the 9 categories (8 subjects + 其他)
  const subjectGroupsAll = useMemo(() => {
    return STUDY_SUBJECTS.map((subj, idx) => {
      const records = dateAndQueryFiltered.filter(
        w => resolveWrongRecordSubject(w, state.books) === subj
      );
      return {
        id: subj,
        subject: subj,
        color: SUBJECT_COLORS[idx] || '#61794F',
        records,
      };
    });
  }, [dateAndQueryFiltered, state.books]);

  const filtered = useMemo(
    () =>
      selectedSubject === 'all'
        ? dateAndQueryFiltered
        : dateAndQueryFiltered.filter(
            w => resolveWrongRecordSubject(w, state.books) === selectedSubject
          ),
    [dateAndQueryFiltered, selectedSubject, state.books]
  );

  // When a specific category is selected in the dropdown, locate that category directly;
  // when 'all' is selected, show categories that have matching records.
  const visibleGroups = useMemo(() => {
    if (selectedSubject !== 'all') {
      return subjectGroupsAll.filter(g => g.subject === selectedSubject);
    }
    return subjectGroupsAll.filter(g => g.records.length > 0);
  }, [subjectGroupsAll, selectedSubject]);

  const categorySelectOptions = useMemo(
    () => [
      {
        value: 'all',
        label: `全部九大分类`,
        badge: `${dateAndQueryFiltered.length}道`,
        badgeVariant: 'sage' as const,
      },
      ...subjectGroupsAll.map(g => ({
        value: g.subject,
        label: g.subject,
        dotColor: g.color,
        badge: `${g.records.length}道`,
        badgeVariant: (g.records.length > 0 ? 'sage' : 'gray') as 'sage' | 'gray',
      })),
    ],
    [dateAndQueryFiltered.length, subjectGroupsAll]
  );

  const filter = (change: () => void) => {
    change();
    setPages({});
    setExpanded({});
  };

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between pt-1">
        <div>
          <h1 className="text-2xl font-bold text-ink-main">错题照片复盘</h1>
          <p className="text-xs text-ink-muted mt-1">
            按九大分类收纳，检索复盘原因与思路
          </p>
        </div>
        <PotatoSprite pose={3} size={64} />
      </div>

      {/* 顶部归档统计与上传主入口 */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-muted">
          已归档错题 ({state.wrong.length} 道 · 共 {totalPhotoCount} 张照片)
        </span>
        <Button
          size="sm"
          onClick={() =>
            onOpenImportModal(selectedSubject !== 'all' ? selectedSubject : undefined)
          }
        >
          <Camera size={14} />
          从相册上传错题
        </Button>
      </div>

      {/* 检索、分类定位与日期筛选卡片 */}
      <Card className="p-3 space-y-3">
        <label className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-cream/60 border border-line/80">
          <Search size={16} className="shrink-0 text-sage" />
          <input
            aria-label="搜索复盘原因和思路"
            type="search"
            value={query}
            onChange={e => filter(() => setQuery(e.target.value))}
            placeholder="搜索复盘原因和思路"
            className="w-full min-w-0 bg-transparent text-sm py-0.5 outline-none"
          />
        </label>

        {/* 所属分类选择定位器（自动持久化记忆上次所选类别） + 起止日期 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="min-w-0">
            <span className="text-xs text-ink-muted block mb-1">
              所属分类（选择即定位 · 自动记忆）
            </span>
            <CustomSelect
              ariaLabel="筛选错题分类"
              compact
              columns={2}
              value={selectedSubject}
              options={categorySelectOptions}
              onChange={val => updateSelectedSubject(val as 'all' | StudySubject)}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:col-span-2">
            <div className="min-w-0">
              <span className="text-xs text-ink-muted block mb-1">开始日期</span>
              <button
                type="button"
                aria-label="错题开始日期"
                onClick={() => setPickerTarget('from')}
                className="w-full flex items-center justify-between border border-line rounded-lg px-2.5 py-1.5 bg-paper text-xs text-left active:bg-cream transition"
              >
                <span className={from ? 'text-ink-main font-medium truncate' : 'text-ink-muted/50 truncate'}>
                  {from || '选择开始日期'}
                </span>
                <ChevronDown size={14} className="text-ink-muted shrink-0" />
              </button>
            </div>
            <div className="min-w-0">
              <span className="text-xs text-ink-muted block mb-1">结束日期</span>
              <button
                type="button"
                aria-label="错题结束日期"
                onClick={() => setPickerTarget('to')}
                className="w-full flex items-center justify-between border border-line rounded-lg px-2.5 py-1.5 bg-paper text-xs text-left active:bg-cream transition"
              >
                <span className={to ? 'text-ink-main font-medium truncate' : 'text-ink-muted/50 truncate'}>
                  {to || '选择结束日期'}
                </span>
                <ChevronDown size={14} className="text-ink-muted shrink-0" />
              </button>
            </div>
          </div>
        </div>

        {invalidRange && (
          <p role="alert" className="text-xs text-alarm">
            开始日期不能晚于结束日期。
          </p>
        )}

        {/* 底部状态与浏览视图密度切换 */}
        <div className="text-xs text-ink-muted flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-line/60">
          <div className="flex items-center gap-2">
            <span>
              {selectedSubject === 'all' ? (
                <>匹配 {filtered.length} 道错题</>
              ) : (
                <>
                  已定位：<strong className="text-ink-main">{selectedSubject}</strong> ({filtered.length} 道)
                </>
              )}
            </span>
            {(query || from || to || selectedSubject !== 'all') && (
              <button
                type="button"
                className="text-sage font-medium hover:underline"
                onClick={() =>
                  filter(() => {
                    setQuery('');
                    setFrom('');
                    setTo('');
                    updateSelectedSubject('all');
                  })
                }
              >
                查看全部九类
              </button>
            )}
          </div>

          <div
            role="group"
            aria-label="错题浏览模式"
            className="flex items-center gap-1 bg-cream/80 p-0.5 rounded-lg border border-line/60"
          >
            <button
              type="button"
              onClick={() => updateViewMode('grid2')}
              className={`px-2 py-1 rounded-md text-xs inline-flex items-center gap-1 transition ${
                viewMode === 'grid2'
                  ? 'bg-sage text-white font-bold shadow-sm'
                  : 'text-ink-muted hover:text-ink-main'
              }`}
            >
              <LayoutGrid size={12} />
              <span>2列</span>
            </button>
            <button
              type="button"
              onClick={() => updateViewMode('list')}
              className={`px-2 py-1 rounded-md text-xs inline-flex items-center gap-1 transition ${
                viewMode === 'list'
                  ? 'bg-sage text-white font-bold shadow-sm'
                  : 'text-ink-muted hover:text-ink-main'
              }`}
            >
              <ListIcon size={12} />
              <span>列表</span>
            </button>
            <button
              type="button"
              onClick={() => updateViewMode('grid3')}
              className={`px-2 py-1 rounded-md text-xs inline-flex items-center gap-1 transition ${
                viewMode === 'grid3'
                  ? 'bg-sage text-white font-bold shadow-sm'
                  : 'text-ink-muted hover:text-ink-main'
              }`}
            >
              <Grid3X3 size={12} />
              <span>3列</span>
            </button>
          </div>
        </div>
      </Card>

      {!visibleGroups.length && (
        <Card className="text-center py-10 text-sm text-ink-muted space-y-3">
          <p>
            {state.wrong.length
              ? '没有匹配的复盘笔记，请调整关键词或日期。'
              : '暂无错题照片，上传后按九大分类收纳。'}
          </p>
          <Button
            size="sm"
            variant="light"
            onClick={() =>
              onOpenImportModal(selectedSubject !== 'all' ? selectedSubject : undefined)
            }
          >
            <Camera size={14} />
            立即上传错题照片
          </Button>
        </Card>
      )}

      {visibleGroups.map(group => {
        const open =
          expanded[group.id] ?? (selectedSubject !== 'all' || Boolean(query.trim()));
        const totalPages = Math.max(1, Math.ceil(group.records.length / pageSize));
        const currentPage = Math.min(totalPages, Math.max(1, pages[group.id] ?? 1));
        const startIdx = (currentPage - 1) * pageSize;
        const pageRecords = group.records.slice(startIdx, startIdx + pageSize);

        const goPrev = () =>
          setPages(prev => ({ ...prev, [group.id]: Math.max(1, currentPage - 1) }));
        const goNext = () =>
          setPages(prev => ({ ...prev, [group.id]: Math.min(totalPages, currentPage + 1) }));

        return (
          <section
            key={group.id}
            className="rounded-2xl border border-line bg-paper overflow-hidden shadow-soft"
          >
            {/* 分类标题栏 + 顶部左右快翻 + 右侧快速添加照片按钮 */}
            <div className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 bg-paper">
              <button
                type="button"
                aria-expanded={open}
                onClick={() =>
                  setExpanded(prev => ({ ...prev, [group.id]: !open }))
                }
                className="flex-1 min-w-0 flex items-center gap-2 text-left"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: group.color }}
                />
                <span className="text-sm font-bold text-ink-main truncate">
                  {group.subject}
                </span>
                <Tag
                  variant={group.records.length > 0 ? 'sage' : 'gray'}
                  className="shrink-0 font-mono text-xs py-0"
                >
                  {group.records.length}道
                </Tag>
                <span className="text-ink-muted ml-0.5">
                  {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
              </button>

              {open && totalPages > 1 && (
                <div className="flex items-center gap-1 bg-cream/80 px-1.5 py-0.5 rounded-full border border-line/70 shrink-0">
                  <button
                    type="button"
                    aria-label="上一页"
                    disabled={currentPage <= 1}
                    onClick={goPrev}
                    className="p-0.5 text-ink-main disabled:opacity-30"
                  >
                    <ChevronLeft size={13} />
                  </button>
                  <span className="text-[11px] font-mono text-ink-main font-semibold px-0.5">
                    {currentPage}/{totalPages}
                  </span>
                  <button
                    type="button"
                    aria-label="下一页"
                    disabled={currentPage >= totalPages}
                    onClick={goNext}
                    className="p-0.5 text-ink-main disabled:opacity-30"
                  >
                    <ChevronRight size={13} />
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => onOpenImportModal(group.subject)}
                className="shrink-0 px-2.5 py-1 rounded-full bg-sage-light text-sage-dark hover:bg-sage hover:text-white text-xs font-bold inline-flex items-center gap-1 transition"
              >
                <Plus size={12} />
                <span>添加照片</span>
              </button>
            </div>

            {open && (
              <div
                className="border-t border-line p-3 bg-cream/30 space-y-3"
                onTouchStart={e => {
                  const t = e.touches[0];
                  if (t) {
                    touchStartRef.current[group.id] = { x: t.clientX, y: t.clientY };
                  }
                }}
                onTouchEnd={e => {
                  if (totalPages <= 1) return;
                  const start = touchStartRef.current[group.id];
                  const t = e.changedTouches[0];
                  if (!start || !t) return;
                  const dx = t.clientX - start.x;
                  const dy = t.clientY - start.y;
                  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) {
                    if (dx < 0 && currentPage < totalPages) goNext();
                    else if (dx > 0 && currentPage > 1) goPrev();
                  }
                }}
              >
                {group.records.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-line bg-paper/80 py-6 px-4 text-center space-y-2">
                    <p className="text-xs text-ink-muted">
                      【{group.subject}】分类下暂无错题记录
                    </p>
                  </div>
                ) : viewMode === 'list' ? (
                  /* 模式 1：紧凑列表模式（每页 4 条，左右翻页） */
                  <div className="space-y-2">
                    {pageRecords.map(record => {
                      const imgs = getWrongRecordImages(record);
                      const cover = imgs[0] || record.image;
                      const timeText = formatWrongRecordTime(record);
                      return (
                        <div
                          key={record.id}
                          className="rounded-xl border border-line bg-paper p-2.5 flex items-center gap-3 shadow-sm hover:border-sage transition"
                        >
                          <button
                            type="button"
                            aria-label="查看错题大图"
                            onClick={() => onOpenDetailModal(record)}
                            className="w-20 h-16 rounded-lg bg-cream/70 overflow-hidden shrink-0 relative flex items-center justify-center border border-line/60"
                          >
                            {cover ? (
                              <img
                                loading="lazy"
                                decoding="async"
                                src={cover}
                                alt="错题缩略图"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <ImageIcon size={22} className="text-sage/40" />
                            )}
                            {imgs.length > 1 && (
                              <span className="absolute bottom-1 right-1 px-1.5 py-0.2 rounded bg-ink-main/80 text-white text-[11px] font-bold">
                                {imgs.length}张
                              </span>
                            )}
                          </button>

                          <div
                            onClick={() => onOpenDetailModal(record)}
                            className="flex-1 min-w-0 cursor-pointer"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-mono font-bold text-sage-dark bg-sage-light px-2 py-0.5 rounded-full">
                                {timeText}
                              </span>
                              {imgs.length > 1 && (
                                <span className="text-xs text-ink-muted">
                                  共 {imgs.length} 张图
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-ink-main line-clamp-2 break-words">
                              {record.note || '未填写复盘笔记'}
                            </p>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              aria-label="删除错题照片"
                              title="删除错题照片"
                              onClick={() => onOpenDeleteConfirm(record.id, group.subject)}
                              className="p-1.5 rounded-lg text-ink-muted hover:text-alarm hover:bg-alarm-light/50"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : viewMode === 'grid3' ? (
                  /* 模式 2：3列紧凑相册图墙（每页 6 道 = 2×3，左右翻页） */
                  <div className="grid grid-cols-3 gap-2">
                    {pageRecords.map(record => {
                      const imgs = getWrongRecordImages(record);
                      const cover = imgs[0] || record.image;
                      const timeText = formatWrongRecordTime(record);
                      return (
                        <div
                          key={record.id}
                          className="rounded-xl border border-line bg-paper overflow-hidden shadow-sm hover:border-sage transition flex flex-col"
                        >
                          <button
                            type="button"
                            aria-label="查看错题大图"
                            onClick={() => onOpenDetailModal(record)}
                            className="w-full aspect-square bg-cream/70 relative overflow-hidden flex items-center justify-center"
                          >
                            {cover ? (
                              <img
                                loading="lazy"
                                decoding="async"
                                src={cover}
                                alt="错题缩略图"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <ImageIcon size={24} className="text-sage/40" />
                            )}
                            {imgs.length > 1 && (
                              <span className="absolute top-1 right-1 px-1.5 py-0.2 rounded-full bg-ink-main/80 text-white text-[11px] font-bold">
                                {imgs.length}张
                              </span>
                            )}
                            <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[10px] px-1 py-0.5 truncate font-mono text-left">
                              {timeText}
                            </span>
                          </button>
                          <div className="p-1.5 flex items-center justify-between gap-1">
                            <span
                              onClick={() => onOpenDetailModal(record)}
                              className="text-xs text-ink-main truncate flex-1 cursor-pointer"
                            >
                              {record.note || '未填写笔记'}
                            </span>
                            <button
                              type="button"
                              aria-label="删除错题照片"
                              title="删除错题照片"
                              onClick={() => onOpenDeleteConfirm(record.id, group.subject)}
                              className="p-0.5 text-ink-muted hover:text-alarm shrink-0"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* 模式 3（默认）：2×2 单屏四宫格卡片（每页 4 道，左右翻页不拉长页面） */
                  <div className="grid grid-cols-2 gap-2.5">
                    {pageRecords.map(record => {
                      const imgs = getWrongRecordImages(record);
                      const cover = imgs[0] || record.image;
                      const timeText = formatWrongRecordTime(record);
                      return (
                        <Card key={record.id} className="p-2.5 min-w-0 overflow-hidden">
                          <button
                            type="button"
                            aria-label="查看错题大图"
                            onClick={() => onOpenDetailModal(record)}
                            className="w-full aspect-[4/3] rounded-xl bg-cream/70 overflow-hidden relative flex items-center justify-center"
                          >
                            {cover ? (
                              <img
                                loading="lazy"
                                decoding="async"
                                src={cover}
                                alt="错题缩略图"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <ImageIcon size={28} className="text-sage/40" />
                            )}
                            {imgs.length > 1 && (
                              <span className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-full bg-ink-main/80 text-white text-xs font-bold backdrop-blur-sm">
                                共 {imgs.length} 张
                              </span>
                            )}
                          </button>
                          <p className="text-[11px] font-mono text-sage-dark font-bold mt-1.5 truncate">
                            {timeText}
                          </p>
                          <p className="text-xs line-clamp-2 min-h-8 mt-0.5 break-words text-ink-main">
                            {record.note || '未填写复盘笔记'}
                          </p>
                          <div className="flex justify-between items-center border-t border-line mt-1.5 pt-1.5">
                            <button
                              type="button"
                              className="text-xs text-sage inline-flex items-center gap-1 font-medium"
                              onClick={() => onOpenDetailModal(record)}
                            >
                              <Eye size={13} />
                              查看详情
                            </button>
                            <button
                              type="button"
                              title="删除错题照片"
                              aria-label="删除错题照片"
                              className="p-1 text-ink-muted hover:text-alarm"
                              onClick={() => onOpenDeleteConfirm(record.id, group.subject)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}

                {/* 左右翻页控制栏（单屏展示 4 道错题，支持点击或左右滑动翻页） */}
                {group.records.length > 0 && (
                  <div className="pt-2 border-t border-line flex items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={currentPage <= 1}
                      onClick={goPrev}
                      className="px-2.5 py-1.5 rounded-xl bg-paper border border-line text-xs font-medium text-ink-main inline-flex items-center gap-1 active:bg-cream disabled:opacity-40"
                    >
                      <ChevronLeft size={14} />
                      上一页
                    </button>

                    <div className="flex flex-col items-center gap-0.5">
                      <div className="flex items-center gap-1 font-mono text-xs flex-wrap justify-center">
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setPages(prev => ({ ...prev, [group.id]: p }))}
                            className={`w-6 h-6 rounded-lg text-xs transition ${
                              p === currentPage
                                ? 'bg-sage text-white font-bold shadow-sm'
                                : 'bg-paper border border-line text-ink-muted hover:text-ink-main'
                            }`}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                      {totalPages > 1 && (
                        <span className="text-[10px] text-ink-muted">
                          第 {currentPage}/{totalPages} 页 · 可左右滑动翻页
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={currentPage >= totalPages}
                      onClick={goNext}
                      className="px-2.5 py-1.5 rounded-xl bg-paper border border-line text-xs font-medium text-ink-main inline-flex items-center gap-1 active:bg-cream disabled:opacity-40"
                    >
                      下一页
                      <ChevronRight size={14} />
                    </button>
                  </div>
                )}

                {/* 底部快速添加当前分类照片入口（无需滑回顶部） */}
                <button
                  type="button"
                  onClick={() => onOpenImportModal(group.subject)}
                  className="w-full py-2.5 rounded-xl border-2 border-dashed border-sage/40 bg-paper hover:bg-sage-light/50 text-xs font-bold text-sage-dark flex items-center justify-center gap-1.5 transition"
                >
                  <Camera size={14} />
                  <span>+ 快速添加【{group.subject}】错题照片</span>
                </button>
              </div>
            )}
          </section>
        );
      })}

      <FloatingDatePicker
        isOpen={pickerTarget !== null}
        onClose={() => setPickerTarget(null)}
        title={pickerTarget === 'from' ? '选择开始日期' : '选择结束日期'}
        value={pickerTarget === 'from' ? from : to}
        onChange={date => {
          if (pickerTarget === 'from') filter(() => setFrom(date));
          else if (pickerTarget === 'to') filter(() => setTo(date));
        }}
        onClear={() => {
          if (pickerTarget === 'from') filter(() => setFrom(''));
          else if (pickerTarget === 'to') filter(() => setTo(''));
        }}
        highlightDates={datesWithWrong}
        activeDate={activeDate}
      />
    </div>
  );
};
