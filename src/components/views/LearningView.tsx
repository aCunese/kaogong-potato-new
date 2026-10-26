import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { PotatoSprite } from '../common/PotatoSprite';
import { Card, Button, Tag, Segment, ProgressBar } from '../common/UIComponents';
import { Plus, Edit2, Trash2, ExternalLink, BookOpen, Video, ListOrdered, CheckCircle2 } from 'lucide-react';
import { Book, Course, LibraryItem, LearningSubTab } from '../../types';

interface LearningViewProps {
  initialSubTab?: LearningSubTab;
  onOpenBookEdit: (book?: Book) => void;
  onOpenCourseEdit: (course?: Course) => void;
  onOpenCustomAdd: () => void;
  onOpenDeleteConfirm: (type: 'book' | 'course' | 'custom', id: string, name: string) => void;
  onToast: (msg: string) => void;
}

export const LearningView: React.FC<LearningViewProps> = ({
  initialSubTab = 'books',
  onOpenBookEdit,
  onOpenCourseEdit,
  onOpenCustomAdd,
  onOpenDeleteConfirm,
  onToast,
}) => {
  const { state, updateLibraryMinutes, quickAddPlan } = useApp();
  const [subTab, setSubTab] = useState<LearningSubTab>(initialSubTab);

  // Sync internal subTab whenever parent initialSubTab changes (Fixes A14)
  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  const subTabOptions = [
    { label: '题本进度', value: 'books' },
    { label: '网课进度', value: 'courses' },
    { label: '事项库', value: 'library' },
  ];

  return (
    <div className="space-y-4 pb-24">
      {/* 头部与吉祥物 */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <h1 className="text-2xl font-bold text-ink-main">备考学习库</h1>
          <p className="text-xs text-ink-muted mt-1">
            题本、网课与事项库联动维护，数据随时调整
          </p>
        </div>
        <PotatoSprite
          pose={subTab === 'books' ? 1 : subTab === 'courses' ? 2 : 7}
          size={64}
        />
      </div>

      {/* 分段选项卡 */}
      <Segment
        options={subTabOptions}
        value={subTab}
        onChange={val => setSubTab(val as LearningSubTab)}
      />

      {/* 1. 题本进度 */}
      {subTab === 'books' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-muted font-medium">
              共 {state.books.length} 本题本
            </span>
            <Button variant="primary" size="sm" onClick={() => onOpenBookEdit()}>
              <Plus size={14} />
              添加题本
            </Button>
          </div>

          <div className="space-y-3">
            {state.books.map(b => {
              const pct = b.total > 0 ? Math.min(100, Math.round((b.done / b.total) * 100)) : 0;
              const accuracy = b.done > 0 ? Math.max(0, Math.round(((b.done - b.errors) / b.done) * 100)) : 0;
              const avgMin = b.done > 0 ? (b.minutes / b.done).toFixed(1) : '0.0';

              return (
                <Card key={b.id} className="p-4 bg-paper border-line">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Tag variant="potato">{b.subject}</Tag>
                        {b.pages > 0 && (
                          <span className="text-[11px] text-ink-muted">全书 {b.pages} 页</span>
                        )}
                      </div>
                      <h3 className="text-sm font-bold text-ink-main truncate">
                        {b.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onOpenBookEdit(b)}
                        className="p-1.5 text-ink-muted hover:text-sage rounded-lg hover:bg-black/5"
                        title="编辑题本数据"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => onOpenDeleteConfirm('book', b.id, b.name)}
                        className="p-1.5 text-ink-muted hover:text-alarm rounded-lg hover:bg-black/5"
                        title="删除题本"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* 进度条 */}
                  <div className="space-y-1 mb-3">
                    <div className="flex justify-between text-xs text-ink-muted">
                      <span>已完成 {b.done} / {b.total} 题</span>
                      <span className="font-mono font-bold text-sage">{pct}%</span>
                    </div>
                    <ProgressBar value={pct} />
                  </div>

                  {/* 核心指标行 */}
                  <div className="grid grid-cols-3 gap-2 bg-cream/40 rounded-xl p-2.5 text-center text-xs">
                    <div>
                      <div className="text-[10px] text-ink-muted">错题数</div>
                      <div className="font-bold text-alarm font-mono mt-0.5">{b.errors} 题</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-ink-muted">正确率</div>
                      <div className="font-bold text-ink-main font-mono mt-0.5">
                        {b.done > 0 ? `${accuracy}%` : '暂无'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-ink-muted">均速</div>
                      <div className="font-bold text-ink-main font-mono mt-0.5">{avgMin} 分/题</div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. 网课进度 */}
      {subTab === 'courses' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-muted font-medium">
              共 {state.courses.length} 门课程
            </span>
            <Button variant="primary" size="sm" onClick={() => onOpenCourseEdit()}>
              <Plus size={14} />
              添加网课
            </Button>
          </div>

          <div className="space-y-3">
            {state.courses.map(c => {
              const pct = c.totalLessons > 0 ? Math.min(100, Math.round((c.completedLessons / c.totalLessons) * 100)) : 0;
              const hasUrl = Boolean(c.url && /^https?:\/\//i.test(c.url));

              return (
                <Card key={c.id} className="p-4 bg-paper border-line">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Tag variant="course">{c.subject}</Tag>
                      </div>
                      <h3 className="text-sm font-bold text-ink-main truncate">
                        {c.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onOpenCourseEdit(c)}
                        className="p-1.5 text-ink-muted hover:text-sage rounded-lg hover:bg-black/5"
                        title="编辑课程"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => onOpenDeleteConfirm('course', c.id, c.name)}
                        className="p-1.5 text-ink-muted hover:text-alarm rounded-lg hover:bg-black/5"
                        title="删除课程"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* 进度 */}
                  <div className="space-y-1 mb-3">
                    <div className="flex justify-between text-xs text-ink-muted">
                      <span>已听课时 {c.completedLessons} / {c.totalLessons} 讲</span>
                      <span className="font-mono font-bold text-sage">{pct}%</span>
                    </div>
                    <ProgressBar value={pct} />
                  </div>

                  {/* 底部信息与外链操作 */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="text-xs text-ink-muted">
                      累计听课: <span className="font-bold text-ink-main font-mono">{c.minutes}</span> 分钟
                    </div>
                    {hasUrl ? (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-sage font-medium bg-sage-light/70 px-2.5 py-1 rounded-md hover:bg-sage-light"
                      >
                        <ExternalLink size={12} />
                        打开课程网页
                      </a>
                    ) : (
                      <span className="text-[11px] text-ink-muted/70">未设置课程链接</span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. 事项库 */}
      {subTab === 'library' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-muted font-medium">
              全部事项 ({state.library.length})
            </span>
            <Button variant="primary" size="sm" onClick={onOpenCustomAdd}>
              <Plus size={14} />
              添加自定义事项
            </Button>
          </div>

          <div className="space-y-2.5">
            {state.library.map(item => (
              <Card key={item.id} className="p-3 bg-paper border-line flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Tag variant={item.type === 'book' ? 'potato' : item.type === 'course' ? 'course' : 'gray'}>
                      {item.type === 'book' ? '题本' : item.type === 'course' ? '网课' : '自定义'}
                    </Tag>
                    <Tag variant="gray">{item.subject}</Tag>
                  </div>
                  <h4 className="text-sm font-bold text-ink-main truncate">
                    {item.name}
                  </h4>
                  <div className="text-xs text-ink-muted mt-1 flex items-center gap-2">
                    <span>默认时长:</span>
                    <input
                      type="number"
                      min={1}
                      value={item.defaultMinutes}
                      onChange={e => updateLibraryMinutes(item.id, parseInt(e.target.value) || 1)}
                      className="w-14 px-1.5 py-0.5 bg-cream/70 border border-line rounded text-xs text-center font-mono"
                    />
                    <span>分钟</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="light"
                    size="sm"
                    onClick={() => {
                      quickAddPlan(item.id);
                      onToast(`已将“${item.name}”加入今日日程`);
                    }}
                  >
                    加入今天
                  </Button>
                  {item.type === 'custom' && (
                    <button
                      onClick={() => onOpenDeleteConfirm('custom', item.id, item.name)}
                      className="p-2 text-ink-muted hover:text-alarm rounded-lg"
                      title="删除自定义事项"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
