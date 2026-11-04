import { SubjectGroups } from '../common/SubjectGroups';
import type { Subject } from '../../types';
import { TodoView } from './TodoView';
import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { PotatoSprite } from '../common/PotatoSprite';
import { Card, Button, Tag, Segment, ProgressBar, Modal, SubjectCapsuleGrid } from '../common/UIComponents';
import { Plus, Edit2, Trash2, ExternalLink, ArrowRightLeft, RotateCcw } from 'lucide-react';
import { Book, Course, LearningSubTab, SUBJECT_LABEL_MAX, getSubjectLabel, getSubjectOptions } from '../../types';

interface LearningViewProps {
  initialSubTab?: LearningSubTab;
  onOpenBookEdit: (book?: Book) => void;
  onOpenCourseEdit: (course?: Course) => void;
  onOpenCustomAdd: () => void;
  onOpenDeleteConfirm: (type: 'book' | 'course' | 'custom', id: string, name: string) => void;
  onToast: (msg: string) => void;
  onAddCourseToToday?: (libraryId: string) => void;
}

export const LearningView: React.FC<LearningViewProps> = ({
  initialSubTab = 'books',
  onOpenBookEdit,
  onOpenCourseEdit,
  onOpenCustomAdd,
  onOpenDeleteConfirm,
  onToast,
  onAddCourseToToday,
}) => {
  const { state, editBook, editCourse, updateSubjectLabel } = useApp();
  const [errorMsg, setErrorMsg] = useState('');
  const [bookGroups, setBookGroups] = useState<Partial<Record<Subject, boolean>>>({});
  const [courseGroups, setCourseGroups] = useState<Partial<Record<Subject, boolean>>>({});
  const [movingTarget, setMovingTarget] = useState<
    | { type: 'book'; item: Book }
    | { type: 'course'; item: Course }
    | null
  >(null);
  const [targetSubject, setTargetSubject] = useState<Subject>('资料分析');
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [subjectLabelDraft, setSubjectLabelDraft] = useState('');
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  const openMoveModal = (target: { type: 'book'; item: Book } | { type: 'course'; item: Course }) => {
    setMovingTarget(target);
    setTargetSubject(target.item.subject);
    setModalError('');
  };

  const handleConfirmMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!movingTarget || modalBusy) return;
    if (targetSubject === movingTarget.item.subject) {
      setMovingTarget(null);
      return;
    }
    setModalBusy(true);
    setModalError('');
    try {
      const res =
        movingTarget.type === 'book'
          ? await editBook(movingTarget.item.id, { subject: targetSubject })
          : await editCourse(movingTarget.item.id, { subject: targetSubject });
      if (!res.ok) {
        setModalError(res.message);
        return;
      }
      const newLabel = getSubjectLabel(targetSubject, state.subjectLabels);
      if (movingTarget.type === 'book') {
        setBookGroups(prev => ({ ...prev, [targetSubject]: true }));
        onToast(`已将题本「${movingTarget.item.name}」转移至【${newLabel}】`);
      } else {
        setCourseGroups(prev => ({ ...prev, [targetSubject]: true }));
        onToast(`已将网课「${movingTarget.item.name}」转移至【${newLabel}】`);
      }
      setMovingTarget(null);
    } finally {
      setModalBusy(false);
    }
  };

  const openSubjectRename = (subj: Subject) => {
    setEditingSubject(subj);
    setSubjectLabelDraft(getSubjectLabel(subj, state.subjectLabels));
    setModalError('');
  };

  const handleSaveSubjectLabel = async (e: React.FormEvent, resetToDefault = false) => {
    e.preventDefault();
    if (!editingSubject || modalBusy) return;
    const nextLabel = resetToDefault ? '' : subjectLabelDraft.trim();
    if (nextLabel.length > SUBJECT_LABEL_MAX) {
      setModalError(`分类名称需为 1 至 ${SUBJECT_LABEL_MAX} 个字符`);
      return;
    }
    setModalBusy(true);
    setModalError('');
    try {
      const res = await updateSubjectLabel(editingSubject, nextLabel);
      if (!res.ok) {
        setModalError(res.message);
        return;
      }
      onToast(!nextLabel ? `已恢复默认分类名「${editingSubject}」` : `已将分类重命名为「${nextLabel}」`);
      setEditingSubject(null);
    } finally {
      setModalBusy(false);
    }
  };
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
    { label: '待办', value: 'library' },
  ];

  return (
    <div className="space-y-4 pb-24">
      {errorMsg && <div role="alert" className="p-3 text-xs text-alarm bg-alarm-light rounded-xl">{errorMsg}</div>}
      {/* 头部与吉祥物 */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <h1 className="text-2xl font-bold text-ink-main">备考学习库</h1>
          <p className="text-xs text-ink-muted mt-1">
            管理题本与网课进度，记录每天的待办
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

          <SubjectGroups items={state.books} unit="本题本" subjectLabels={state.subjectLabels} onEditSubject={openSubjectRename} expanded={bookGroups} onToggle={subject => setBookGroups(prev => ({ ...prev, [subject]: !prev[subject] }))} progress={items => ({ done: items.reduce((n,b) => n+b.done,0), total: items.reduce((n,b) => n+b.total,0), unit: '题' })} renderItem={b => {
              const pct = b.total > 0 ? Math.min(100, Math.round((b.done / b.total) * 100)) : 0;
              const accuracy = b.done > 0 ? Math.max(0, Math.round(((b.done - b.errors) / b.done) * 100)) : 0;


              return (
                <Card key={b.id} className="p-4 bg-paper border-line">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Tag variant="potato">{getSubjectLabel(b.subject, state.subjectLabels)}</Tag>
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
                        type="button"
                        onClick={() => openMoveModal({ type: 'book', item: b })}
                        className="px-2 py-1 text-[11px] font-medium text-sage bg-sage-light/70 hover:bg-sage-light rounded-lg inline-flex items-center gap-1 transition"
                        title="转移到其他分类"
                        aria-label={`转移题本分类：${b.name}`}
                      >
                        <ArrowRightLeft size={12} />
                        <span>转移分类</span>
                      </button>
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
                    <div><div className="text-[10px] text-ink-muted">正确题数</div><div className="font-bold text-sage font-mono mt-0.5">{Math.max(0, b.done - b.errors)} 题</div></div>
                    <div><div className="text-[10px] text-ink-muted">正确率</div><div className="font-bold text-ink-main font-mono mt-0.5">{b.done > 0 ? `${accuracy}%` : '暂无'}</div></div>
                  </div>
                </Card>
              );
            }} />
        </div>
      )}

      {/* 2. 网课进度 */}
      {subTab === 'courses' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-muted font-medium">
              共 {state.courses.length} 门网课
            </span>
            <Button variant="primary" size="sm" onClick={() => onOpenCourseEdit()}>
              <Plus size={14} />
              添加网课
            </Button>
          </div>

          <SubjectGroups items={state.courses} unit="门网课" subjectLabels={state.subjectLabels} onEditSubject={openSubjectRename} expanded={courseGroups} onToggle={subject => setCourseGroups(prev => ({ ...prev, [subject]: !prev[subject] }))} progress={items => ({ done: items.reduce((n,c) => n+c.completedLessons,0), total: items.reduce((n,c) => n+c.totalLessons,0), unit: '节' })} renderItem={c => {
              const pct = c.totalLessons > 0 ? Math.min(100, Math.round((c.completedLessons / c.totalLessons) * 100)) : 0;
              const hasUrl = Boolean(c.url && /^https?:\/\//i.test(c.url));

              return (
                <Card key={c.id} className="p-4 bg-paper border-line">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Tag variant="course">{getSubjectLabel(c.subject, state.subjectLabels)}</Tag>
                      </div>
                      <h3 className="text-sm font-bold text-ink-main truncate">
                        {c.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openMoveModal({ type: 'course', item: c })}
                        className="px-2 py-1 text-[11px] font-medium text-sage bg-sage-light/70 hover:bg-sage-light rounded-lg inline-flex items-center gap-1 transition"
                        title="转移到其他分类"
                        aria-label={`转移网课分类：${c.name}`}
                      >
                        <ArrowRightLeft size={12} />
                        <span>转移分类</span>
                      </button>
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
                      <span>已完成 {c.completedLessons} / {c.totalLessons} 节</span>
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
                      <span className="text-[11px] text-ink-muted/70">待添加课程链接</span>
                    )}
                  </div>
                  {onAddCourseToToday && <Button variant="light" size="sm" fullWidth className="mt-3" disabled={c.completedLessons >= c.totalLessons} onClick={() => onAddCourseToToday(`lib-course-${c.id}`)}>加入今日</Button>}
                </Card>
              );
            }} />
        </div>
      )}

      {subTab === 'library' && <TodoView />}

      {/* 转移题本/网课所属分类弹窗 */}
      <Modal
        isOpen={Boolean(movingTarget)}
        onClose={() => setMovingTarget(null)}
        title="转移所属分类"
        closeDisabled={modalBusy}
      >
        {movingTarget && (
          <form onSubmit={handleConfirmMove} className="space-y-4">
            {modalError && (
              <p role="alert" className="text-xs text-alarm bg-alarm-light p-2.5 rounded-xl">
                {modalError}
              </p>
            )}
            <div className="rounded-xl bg-cream/70 p-3 text-xs space-y-1 border border-line/60">
              <div className="font-bold text-sm text-ink-main">{movingTarget.item.name}</div>
              <div className="text-ink-muted">
                当前分类：<span className="font-semibold text-ink-main">{getSubjectLabel(movingTarget.item.subject, state.subjectLabels)}</span>
              </div>
            </div>
            <div>
              <span className="block text-xs text-ink-muted font-medium mb-1.5">选择目标分类</span>
              <SubjectCapsuleGrid
                ariaLabel="选择目标分类"
                columns={4}
                disabled={modalBusy}
                options={getSubjectOptions(state.subjectLabels, false)}
                value={targetSubject}
                onChange={val => setTargetSubject(val as Subject)}
              />
            </div>
            <p className="text-[11px] text-ink-muted leading-relaxed">
              转移后，该{movingTarget.type === 'book' ? '题本' : '网课'}关联的事项库、日程、学习登记与错题分类会自动同步更新。
            </p>
            <Button type="submit" variant="primary" fullWidth disabled={modalBusy}>
              {modalBusy ? '正在转移…' : '确认转移分类'}
            </Button>
          </form>
        )}
      </Modal>

      {/* 编辑八大类名称弹窗 */}
      <Modal
        isOpen={Boolean(editingSubject)}
        onClose={() => setEditingSubject(null)}
        title="编辑分类名称"
        closeDisabled={modalBusy}
      >
        {editingSubject && (
          <form onSubmit={e => void handleSaveSubjectLabel(e, false)} className="space-y-4">
            {modalError && (
              <p role="alert" className="text-xs text-alarm bg-alarm-light p-2.5 rounded-xl">
                {modalError}
              </p>
            )}
            <div className="rounded-xl bg-cream/70 p-3 text-xs text-ink-muted border border-line/60">
              标准分类槽位：<span className="font-bold text-ink-main">{editingSubject}</span>
            </div>
            <div>
              <label className="block text-xs text-ink-muted font-medium mb-1" htmlFor="subject-rename-input">
                自定义分类名称（最多 {SUBJECT_LABEL_MAX} 字）
              </label>
              <input
                id="subject-rename-input"
                aria-label="自定义分类名称"
                type="text"
                maxLength={SUBJECT_LABEL_MAX}
                disabled={modalBusy}
                value={subjectLabelDraft}
                onChange={e => setSubjectLabelDraft(e.target.value)}
                placeholder={`默认：${editingSubject}`}
                className="w-full px-3 py-2.5 bg-cream/70 border border-line rounded-xl text-sm focus:outline-none focus:border-sage"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              {state.subjectLabels?.[editingSubject] && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={modalBusy}
                  onClick={e => void handleSaveSubjectLabel(e, true)}
                >
                  <RotateCcw size={14} />
                  恢复默认
                </Button>
              )}
              <Button type="submit" variant="primary" fullWidth disabled={modalBusy}>
                {modalBusy ? '正在保存…' : '保存分类名称'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
