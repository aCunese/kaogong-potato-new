import { OrientedImage } from '../common/OrientedImage';
import { readScheduleSelection, rememberScheduleSelection, resolveScheduleSelection } from '../../utils/scheduleSelection';
import { parseIntegerDraft } from '../../utils/numericDraft';
import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal, Button, Tag, SubjectCapsuleGrid, CustomSelect, useModalBack } from '../common/UIComponents';
import { SUBJECTS, STUDY_SUBJECTS, StudySubject, isStudySubjectForType, Subject, Book, Course, WrongRecord, StudyRecord, MutationResult, getSubjectLabel, getSubjectOptions } from '../../types';
import { CountdownReminderItem } from '../../utils/workflowPresentation';
import { SUBJECT_COLORS } from './TimeDistribution';
import { PotatoSprite } from '../common/PotatoSprite';
import { Smartphone, Download, CheckCircle2, AlertCircle, Camera, Image as ImageIcon, Loader2, Eye, EyeOff, Calendar, ChevronLeft, ChevronRight, ZoomIn, X, ArrowRightLeft, Edit2, Sparkles, Plus } from 'lucide-react';
import { FloatingDatePicker } from '../common/FloatingDatePicker';
import { compressImage, compressWrongPhoto, validateImageBatch, MAX_BATCH_COUNT } from '../../utils/imageCompressor';
import {
  resolveWrongRecordSubject,
  getWrongRecordImages,
  formatWrongRecordTime,
  readPersistedWrongSubject,
  writePersistedWrongSubject,
} from '../../utils/workflowMutators';

function useSaveMutation(onClose: () => void, onToast: (message: string) => void) {
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [errorMsg, setErrorMsg] = useState('');
  const save = async (action: () => Promise<MutationResult<unknown>>, message: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    setErrorMsg('');
    try {
      const result = await action();
      if (!result.ok) { setErrorMsg(result.message); return; }
      onToast(message);
      onClose();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };
  return { save, isSaving, errorMsg, setErrorMsg };
}

const FormError: React.FC<{ message: string }> = ({ message }) => message ? (
  <div role="alert" className="p-2.5 bg-alarm-light text-alarm rounded-xl text-xs">{message}</div>
) : null;

/* =========================================================================
   1. Add Plan Modal (add-plan: 12:1867)
   ========================================================================= */
export const AddPlanModal: React.FC<{
  isOpen: boolean; onClose: () => void; onToast: (msg: string) => void;
  onOpenCustomAdd?: () => void; initialLibraryId?: string;
}> = ({ isOpen, onClose, onToast, onOpenCustomAdd, initialLibraryId }) => {
  const { state, addPlan, addCustomPlan, currentUser } = useApp();
  const { save, isSaving, errorMsg, setErrorMsg } = useSaveMutation(onClose, onToast);
  const initial = initialLibraryId ? state.library.find(l => l.id === initialLibraryId) : undefined;
  const resolvedInitial = resolveScheduleSelection(state.library, currentUser?.id, initialLibraryId);
  const [type, setType] = useState(resolvedInitial.type);
  const [subject, setSubject] = useState(resolvedInitial.subject);
  const [customName, setCustomName] = useState(initial?.type === 'custom' ? initial.name : '');
  const [customSubject, setCustomSubject] = useState<StudySubject>(
    resolvedInitial.type === 'custom'
      ? (resolvedInitial.subject as StudySubject)
      : (readScheduleSelection(currentUser?.id).custom.subject)
  );
  const [selectedLibId, setSelectedLibId] = useState(resolvedInitial.item?.id ?? '');
  const [minutes, setMinutes] = useState(String(resolvedInitial.item?.defaultMinutes ?? 30));
  const [lessons, setLessons] = useState('1');
  const selectedItem = state.library.find(l => l.id === selectedLibId);
  const course = state.courses.find(c => selectedItem?.type === 'course' && c.id === selectedItem.sourceId);
  const remaining = course ? course.totalLessons - course.completedLessons : 0;
  const items = state.library.filter(l => l.type === type && (subject === 'all' || subject === l.subject));
  const validMinutes = /^\d+$/.test(minutes) && Number.isSafeInteger(Number(minutes)) && Number(minutes) > 0;
  const validLessons = type !== 'course' || Boolean(course && /^\d+$/.test(lessons) && Number.isSafeInteger(Number(lessons)) && Number(lessons) > 0 && Number(lessons) <= remaining);
  const validItem = type === 'custom'
    ? customName.trim().length > 0 && customName.trim().length <= 200 && isStudySubjectForType(customSubject, 'custom')
    : Boolean(selectedItem && selectedItem.type === type);
  const select = (id: string) => { setSelectedLibId(id); setMinutes(String(state.library.find(l => l.id === id)?.defaultMinutes ?? 30)); setLessons('1'); setErrorMsg(''); };
  const restoreSelection = (requestedType?: 'book' | 'course' | 'custom', explicitId?: string) => {
    if (requestedType === 'custom') {
      const stored = readScheduleSelection(currentUser?.id);
      const customSub = stored.custom?.subject ?? '其他';
      setType('custom');
      setSubject(customSub);
      setCustomSubject(customSub);
      setCustomName('');
      setSelectedLibId('');
      setMinutes('30');
      setErrorMsg('');
      rememberScheduleSelection(currentUser?.id, 'custom', customSub, '');
      return;
    }
    const restored = resolveScheduleSelection(state.library, currentUser?.id, explicitId, requestedType);
    setType(restored.type);
    setSubject(restored.subject);
    select(restored.item?.id ?? '');
    rememberScheduleSelection(currentUser?.id, restored.type, restored.subject, restored.item?.id ?? '');
    if (restored.type === 'custom') {
      setCustomName(restored.item?.name ?? '');
      setCustomSubject((restored.item?.subject as StudySubject) ?? (restored.subject as StudySubject) ?? '其他');
      if (!restored.item) {
        setMinutes('30');
      }
    }
  };
  useEffect(() => {
    if (isOpen) restoreSelection(undefined, initialLibraryId);
  }, [isOpen, initialLibraryId, currentUser?.id]);
  useEffect(() => {
    if (!isOpen || type === 'custom' || items.some(item => item.id === selectedLibId)) return;
    const id = items[0]?.id ?? '';
    if (id !== selectedLibId) {
      select(id);
      rememberScheduleSelection(currentUser?.id, type, subject, id);
    }
  }, [state.library, isOpen, type, subject, selectedLibId, currentUser?.id]);
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validItem || !validMinutes || !validLessons) { setErrorMsg('请填写有效事项、大于0的整数分钟；网课节数不能超过剩余数量。'); return; }
    if (type === 'custom') {
      rememberScheduleSelection(currentUser?.id, 'custom', customSubject, '');
    }
    void save(() => type === 'custom'
      ? addCustomPlan(customName.trim(), customSubject, Number(minutes))
      : addPlan(selectedLibId, Number(minutes), type === 'course' ? Number(lessons) : undefined), '已成功添加到今日日程！');
  };
  return <Modal isOpen={isOpen} onClose={onClose} title="添加今日日程">
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormError message={errorMsg} />
      <div role="group" aria-label="日程类型" className="grid grid-cols-3 rounded-xl bg-cream p-1 gap-1">
        {([['book','题本'],['course','网课'],['custom','自定义']] as const).map(([value,label]) => <button key={value} type="button" disabled={isSaving} aria-pressed={type === value} onClick={() => {
          if (type === value) return;
          restoreSelection(value);
        }} className={`rounded-lg py-2 text-xs ${type === value ? 'bg-paper text-sage font-bold shadow-sm' : 'text-ink-muted'}`}>{label}</button>)}
      </div>
      {type === 'custom' ? <>
        <div>
          <span className="block text-xs text-ink-muted mb-1.5">所属科目</span>
          <SubjectCapsuleGrid
            ariaLabel="自定义事项所属科目"
            disabled={isSaving}
            options={getSubjectOptions(state.subjectLabels, true)}
            value={customSubject}
            onChange={val => {
              const nextSub = val as StudySubject;
              setCustomSubject(nextSub);
              rememberScheduleSelection(currentUser?.id, 'custom', nextSub, '');
            }}
          />
        </div>
        <label className="block text-xs text-ink-muted">事项名称<input aria-label="事项名称" type="text" required maxLength={200} disabled={isSaving} value={customName} onChange={e => setCustomName(e.target.value)} placeholder="例如：晨读时政、整理错题" className="mt-1 w-full px-3 py-2.5 bg-cream/70 border border-line rounded-xl text-sm" /></label>
      </> : <>
        <div>
          <span className="block text-xs text-ink-muted mb-1.5">筛选科目</span>
          <SubjectCapsuleGrid
            ariaLabel="筛选日程科目"
            columns={3}
            options={[{ label: '全部科目', value: 'all' }, ...getSubjectOptions(state.subjectLabels, false)]}
            value={subject}
            onChange={next => {
              setSubject(next);
              const id = state.library.find(l => l.type === type && (next === 'all' || next === l.subject))?.id ?? '';
              select(id);
              rememberScheduleSelection(currentUser?.id, type, next, id);
            }}
          />
        </div>
        <div>
          <span className="block text-xs text-ink-muted mb-1">选择事项</span>
          <CustomSelect
            ariaLabel="选择事项"
            value={selectedLibId}
            emptyText="该分类暂无内容，请先到学习库添加"
            options={items.map(l => ({
              value: l.id,
              label: l.name,
            }))}
            onChange={val => { select(val); rememberScheduleSelection(currentUser?.id, type, subject, val); }}
          />
        </div>
      </>}
      <label className="block text-xs text-ink-muted">今日计划用时（分钟）<input aria-label="今日计划用时" type="number" min="1" step="1" required disabled={isSaving} value={minutes} onChange={e => setMinutes(e.target.value)} className="mt-1 w-full px-3 py-2.5 border border-line rounded-xl bg-cream/70 font-mono text-sm" /></label>
      {type === 'course' && <div><p className="text-xs text-ink-muted mb-2">剩余 {Math.max(0,remaining)} 节</p><label className="text-xs text-ink-muted">本次计划节数<input aria-label="本次计划节数" type="number" min="1" max={remaining} step="1" required value={lessons} onChange={e => setLessons(e.target.value)} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-line bg-cream/70 text-sm" /></label>{!validLessons && <p className="text-xs text-alarm mt-1">节数须大于0，且不能超过剩余 {Math.max(0,remaining)} 节。</p>}<p className="text-xs text-ink-muted mt-2">完成后确认实际节数，真实用时自动记录。</p></div>}
      {!validMinutes && <p className="text-xs text-alarm">时长须大于0，空白不能加入。</p>}
      {type !== 'custom' && onOpenCustomAdd && <button type="button" className="text-xs text-sage" onClick={() => {onClose();onOpenCustomAdd();}}>添加自定义学习事项</button>}
      <Button type="submit" variant="primary" fullWidth disabled={isSaving || !validItem || !validMinutes || !validLessons}>确认加入今日日程</Button>
    </form>
  </Modal>;
};

/* =========================================================================
   2. Book Edit / Add Modal (book-edit: 12:2365 / book-add: 13:1656)
   ========================================================================= */
export const BookEditModal: React.FC<{
  isOpen: boolean;
  book?: Book;
  onClose: () => void;
  onToast: (msg: string) => void;
}> = ({ isOpen, book, onClose, onToast }) => {
  const { state, addBook, editBook } = useApp();

  const [name, setName] = useState('');
  const [subject, setSubject] = useState<Subject>('资料分析');
  const [total, setTotal] = useState('500');
  const [pages, setPages] = useState('240');
  const [done, setDone] = useState('0');
  const [errors, setErrors] = useState('0');
  const [minutes, setMinutes] = useState(0);
  const { save, isSaving, errorMsg, setErrorMsg } = useSaveMutation(onClose, onToast);

  useEffect(() => {
    if (book) {
      setName(book.name);
      setSubject(book.subject);
      setTotal(String(book.total));
      setPages(book.pages ? String(book.pages) : '');
      setDone(String(book.done));
      setErrors(String(book.errors));
      setMinutes(book.minutes);
    } else {
      setName('');
      setSubject('资料分析');
      setTotal('500');
      setPages('240');
      setDone('0');
      setErrors('0');
      setMinutes(0);
    }
    setErrorMsg('');
  }, [book, isOpen]);

  const parsed = { total: parseIntegerDraft(total), pages: parseIntegerDraft(pages, 'optional'), done: parseIntegerDraft(done, 'nonnegative'), errors: parseIntegerDraft(errors, 'nonnegative') };
  const validCounts = Object.values(parsed).every(value => value !== null) && Number(parsed.errors) <= Number(parsed.done);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('请填写题本名称');
      return;
    }
    if (!validCounts) {
      setErrorMsg('请补全整数题量：总题数须大于0，页数选填且须大于0，错题数不能超过已做题数。');
      return;
    }

    if (book) {
      void save(() => editBook(book.id, { name: name.trim(), subject, total: parsed.total!, pages: parsed.pages!, done: parsed.done!, errors: parsed.errors! }), '题本数据已更新！');
    } else {
      void save(() => addBook({ name: name.trim(), subject, total: parsed.total!, pages: parsed.pages!, done: parsed.done!, errors: parsed.errors!, minutes }), '题本已创建，并自动生成同名事项！');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={book ? '修改题本数据' : '添加新题本'}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {errorMsg && (
          <div className="p-2.5 bg-alarm-light text-alarm rounded-xl text-xs flex items-center gap-1.5 border border-red-200">
            <AlertCircle size={14} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1">题本名称</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例如：行测高分必刷1000题"
            className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-sm focus:outline-none focus:border-sage"
          />
        </div>

        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1.5">所属科目</label>
          <SubjectCapsuleGrid
            ariaLabel="题本所属科目"
            columns={4}
            options={getSubjectOptions(state?.subjectLabels, false)}
            value={subject}
            onChange={val => setSubject(val as Subject)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-ink-muted font-medium mb-1">总题数</label>
            <input
              type="number"
              min="1"
              aria-label="总题数" step="1" required value={total}
              onChange={e => setTotal(e.target.value)}
              className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted font-medium mb-1">全书页数</label>
            <input
              type="number"
              min="1"
              aria-label="全书页数" step="1" value={pages}
              onChange={e => setPages(e.target.value)}
              className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs text-ink-muted font-medium mb-1">已做题数</label>
            <input
              type="number"
              min="0"
              aria-label="已做题数" step="1" required value={done}
              onChange={e => setDone(e.target.value)}
              className="w-full px-2.5 py-2 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted font-medium mb-1">错题数</label>
            <input
              type="number"
              min="0"
              aria-label="错题数" step="1" required value={errors}
              onChange={e => setErrors(e.target.value)}
              className="w-full px-2.5 py-2 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage text-alarm font-bold"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted font-medium mb-1">累计用时(分)</label>
            <input
              type="number"
              min="0"
              value={minutes}
              readOnly
              aria-label="题本累计用时（自动累计）"
              className="w-full px-2.5 py-2 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
            />
          </div>
        </div>

        <p className="text-[11px] text-ink-muted/80 leading-relaxed pt-1">
          累计用时由计时登记自动累计，不能手动修改；调整题数不会新增每日学习记录。
        </p>

        <div className="pt-2">
          <Button variant="primary" size="md" fullWidth type="submit" disabled={isSaving || !validCounts}>
            保存题本数据
          </Button>
        </div>
      </form>
    </Modal>
  );
};

/* =========================================================================
   3. Course Edit / Add Modal (course-edit: 12:2496 / course-add: 13:1791)
   ========================================================================= */
export const CourseEditModal: React.FC<{
  isOpen: boolean;
  course?: Course;
  onClose: () => void;
  onToast: (msg: string) => void;
}> = ({ isOpen, course, onClose, onToast }) => {
  const { state, addCourse, editCourse } = useApp();
  const [name, setName] = useState(course?.name ?? '');
  const [subject, setSubject] = useState<Subject>(course?.subject ?? '判断推理');
  const [totalLessons, setTotalLessons] = useState(String(course?.totalLessons ?? 30));
  const [completedLessons, setCompletedLessons] = useState(String(course?.completedLessons ?? 0));
  const [url, setUrl] = useState(course?.url ?? '');
  const { save, isSaving, errorMsg, setErrorMsg } = useSaveMutation(onClose, onToast);
  const liveCourse = state.courses.find(c => c.id === course?.id) ?? course;
  const total = Number(totalLessons);
  const completed = Number(completedLessons);
  const valid = /^\d+$/.test(totalLessons) && Number.isSafeInteger(total) && total > 0 &&
    /^\d+$/.test(completedLessons) && Number.isSafeInteger(completed) && completed >= 0 && completed <= total;
  useEffect(() => {
    setName(course?.name ?? ''); setSubject(course?.subject ?? '判断推理');
    setTotalLessons(String(course?.totalLessons ?? 30)); setCompletedLessons(String(course?.completedLessons ?? 0));
    setUrl(course?.url ?? ''); setErrorMsg('');
  }, [course, isOpen]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErrorMsg('请填写网课名称'); return; }
    if (!valid) { setErrorMsg('总节数必须大于0；已完成节数须为不超过总节数的非负整数，不能为空。'); return; }
    const details = { name: name.trim(), subject, totalLessons: total, completedLessons: completed, url: url.trim() };
    if (course) void save(() => editCourse(course.id, details), '网课数据已更新！');
    else void save(() => addCourse({ ...details, minutes: 0 }), '网课已添加！');
  };
  return <Modal isOpen={isOpen} onClose={onClose} title={course ? '修改网课信息' : '添加新网课'}>
    <form onSubmit={submit} className="space-y-4">
      <FormError message={errorMsg} />
      <div><label className="block text-xs text-ink-muted mb-1" htmlFor="course-name">课程名称</label><input id="course-name" value={name} onChange={e => setName(e.target.value)} placeholder="例如：判断推理图形专项技巧精讲" className="w-full px-3 py-2.5 bg-cream/70 border border-line rounded-xl text-sm" /></div>
      <div><label className="block text-xs text-ink-muted mb-1.5" htmlFor="course-subject">所属科目</label><SubjectCapsuleGrid ariaLabel="网课所属科目" columns={4} options={getSubjectOptions(state?.subjectLabels, false)} value={subject} onChange={val => setSubject(val as Subject)} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="block text-xs text-ink-muted mb-1" htmlFor="course-total">总节数</label><input id="course-total" aria-label="总节数" type="number" min="1" step="1" required value={totalLessons} onChange={e => setTotalLessons(e.target.value)} className="w-full px-3 py-2.5 bg-cream/70 border border-line rounded-xl text-sm font-mono" /></div>
        <div><label className="block text-xs text-ink-muted mb-1" htmlFor="course-completed">已完成节数</label><input id="course-completed" aria-label="已完成节数" type="number" min="0" step="1" required value={completedLessons} onChange={e => setCompletedLessons(e.target.value)} className="w-full px-3 py-2.5 bg-cream/70 border border-line rounded-xl text-sm font-mono" /></div>
      </div>
      {!valid && <p className="text-xs text-alarm">请填写有效节数：总节数大于0，已完成节数不能超过总节数。</p>}
      <div className="rounded-xl bg-sage-light/50 p-3 text-sm"><span className="text-xs text-ink-muted">累计用时 · 自动累计</span><output aria-label="累计用时（自动累计）" className="block font-bold font-mono mt-1">{liveCourse?.minutes ?? 0} 分钟</output><p className="text-xs text-ink-muted mt-1">由日程计时与完成登记自动记录，不能手动修改。</p></div>
      <div><label className="block text-xs text-ink-muted mb-1" htmlFor="course-url">课程链接（选填，仅限http/https）</label><input id="course-url" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." className="w-full px-3 py-2.5 bg-cream/70 border border-line rounded-xl text-sm" /></div>
      <Button type="submit" fullWidth disabled={isSaving || !valid || !name.trim()}>保存网课数据</Button>
    </form>
  </Modal>;
};

/* =========================================================================
   4. Custom Add Modal (custom-add: 12:2624)
   ========================================================================= */
export const CustomAddModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
}> = ({ isOpen, onClose, onToast }) => {
  const { state, addCustomItem } = useApp();
  const { save, isSaving, errorMsg, setErrorMsg } = useSaveMutation(onClose, onToast);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState<StudySubject>('其他');
  const [defaultMinutes, setDefaultMinutes] = useState('30');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErrorMsg('请填写事项名称'); return; }
    void save(() => addCustomItem(name.trim(), subject, Number(defaultMinutes)), '已添加自定义学习事项！');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="添加自定义备考事项">
      <form onSubmit={handleSubmit} className="space-y-3">
        <FormError message={errorMsg} />
        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1">事项名称</label>
          <input
            type="text"
            maxLength={120}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例如：每日晨读人民日报时评"
            className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-sm focus:outline-none focus:border-sage"
          />
        </div>

        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1.5">归属科目</label>
          <SubjectCapsuleGrid
            ariaLabel="自定义备考事项归属科目"
            columns={3}
            options={getSubjectOptions(state?.subjectLabels, true)}
            value={subject}
            onChange={val => setSubject(val as StudySubject)}
          />
        </div>

        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1">默认学习时长 (分钟)</label>
          <input
            type="number"
            min="1"
            value={defaultMinutes}
            onChange={e => setDefaultMinutes(e.target.value)}
            required
            className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
          />
        </div>

        <div className="pt-2">
          <Button variant="primary" size="md" fullWidth type="submit" disabled={isSaving || !defaultMinutes.trim() || !Number.isSafeInteger(Number(defaultMinutes)) || Number(defaultMinutes) <= 0}>
            保存学习事项
          </Button>
        </div>
      </form>
    </Modal>
  );
};

/* =========================================================================
   5. Countdown Modal (countdown: 13:447)
   ========================================================================= */
export const CountdownModal: React.FC<{
  isOpen: boolean;
  mode?: 'create' | 'edit';
  countdownId?: string;
  onClose: () => void;
  onToast: (msg: string) => void;
}> = ({ isOpen, mode = 'edit', countdownId, onClose, onToast }) => {
  const { state, activeDate, addCountdown, updateCountdown, deleteCountdown } = useApp();
  const { save, isSaving, errorMsg, setErrorMsg } = useSaveMutation(onClose, onToast);
  const cd = countdownId ? state.countdowns.find(c => c.id === countdownId) : undefined;
  const isCreate = mode === 'create' || !cd;
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setName(cd?.name ?? '');
    setDate(cd?.date ?? '');
    setIsPickerOpen(false);
    setConfirmDelete(false);
    setLocalError('');
    setErrorMsg('');
  }, [isOpen, cd?.id]);

  if (isOpen && !isCreate && !cd) return null;

  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 20 && (date === '' || /^\d{4}-\d{2}-\d{2}$/.test(date));
  const handleSave = () => {
    if (!valid) { setLocalError('请填写 1 至 20 字的名称；日期可留空或选择有效日期。'); return; }
    setLocalError('');
    if (isCreate) void save(() => addCountdown(trimmed, date), '已添加倒数日！');
    else if (cd) void save(() => updateCountdown(cd.id, date, trimmed), '已更新倒数日！');
  };
  const handleDelete = () => {
    if (!cd) return;
    void save(() => deleteCountdown(cd.id), '已删除倒数日');
  };

  return <Modal isOpen={isOpen} onClose={onClose} title={isCreate ? '添加倒数日' : '编辑倒数日'}>
    <div className="space-y-4">
      <FormError message={localError || errorMsg} />
      <div>
        <label className="block text-xs text-ink-muted font-medium mb-1">名称</label>
        <input
          aria-label="倒数日名称"
          type="text"
          maxLength={20}
          value={name}
          onChange={e => { setName(e.target.value); setLocalError(''); }}
          placeholder="例如：国考、省考、考研面试"
          className="w-full px-3 py-2.5 bg-cream/70 border border-line rounded-xl text-sm focus:outline-none focus:border-sage"
        />
      </div>
      <div>
        <label className="block text-xs text-ink-muted font-medium mb-1">目标日期</label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsPickerOpen(true)}
            aria-label="选择倒数日目标日期"
            className="flex-1 flex items-center justify-between px-3 py-2.5 bg-cream/70 border border-line rounded-xl text-sm hover:border-sage transition-colors text-left"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Calendar size={16} className="text-sage shrink-0" />
              <span className={`truncate ${date ? 'text-ink-main font-mono font-semibold' : 'text-ink-muted/70 font-sans'}`}>
                {date || '点击选择目标日期'}
              </span>
            </div>
            <span className="text-xs text-sage font-sans font-medium shrink-0">
              {date ? '更改' : '选择'}
            </span>
          </button>
          {date && (
            <button
              type="button"
              onClick={() => { setDate(''); setLocalError(''); }}
              className="px-2.5 py-2.5 text-xs text-alarm hover:bg-alarm-light/50 border border-alarm/20 rounded-xl transition-colors shrink-0 font-medium"
              title="清除目标日期"
              aria-label="清除目标日期"
            >
              清除
            </button>
          )}
        </div>
        <p className="text-[11px] text-ink-muted mt-1 leading-relaxed">
          日期可留空（首页显示“设置日期”）；过期后显示“已结束”。首页最多展示 6 个倒数日，可左右滑动查看。
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="primary" disabled={isSaving || !valid} onClick={handleSave}>{isSaving ? '保存中…' : isCreate ? '添加' : '保存'}</Button>
        <Button variant="secondary" disabled={isSaving} onClick={onClose}>取消</Button>
      </div>
      {!isCreate && (confirmDelete ? (
        <div className="space-y-2 rounded-xl border border-alarm/30 bg-alarm-light/50 p-3">
          <p className="text-xs text-alarm">删除后首页不再显示这个倒数日，确定删除「{cd?.name}」？</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="danger" size="sm" disabled={isSaving} onClick={handleDelete}>{isSaving ? '删除中…' : '确认删除'}</Button>
            <Button variant="secondary" size="sm" disabled={isSaving} onClick={() => setConfirmDelete(false)}>取消</Button>
          </div>
        </div>
      ) : (
        <Button variant="danger" size="sm" fullWidth disabled={isSaving} onClick={() => setConfirmDelete(true)}>删除倒数日</Button>
      ))}
    </div>
    <FloatingDatePicker
      isOpen={isPickerOpen}
      onClose={() => setIsPickerOpen(false)}
      title="选择目标日期"
      value={date}
      onChange={newDate => {
        setDate(newDate);
        setLocalError('');
      }}
      onClear={() => {
        setDate('');
        setLocalError('');
      }}
      activeDate={activeDate}
    />
  </Modal>;
};

/* =========================================================================
   6. Photo Import Modal (photo-import: 13:158)
   ========================================================================= */
const MAX_SINGLE_WRONG_IMAGES = 9;

export interface PhotoImportTarget {
  bookId?: string;
  subject?: StudySubject;
  date?: string;
  lockSubject?: boolean;
}

export const PhotoImportModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
  initialTarget?: PhotoImportTarget;
}> = ({ isOpen, onClose, onToast, initialTarget }) => {
  const { state, activeDate, addWrongRecords } = useApp();

  const resolveInitialSubject = (): StudySubject => {
    if (initialTarget?.subject && (STUDY_SUBJECTS as readonly string[]).includes(initialTarget.subject)) {
      return initialTarget.subject;
    }
    if (initialTarget?.bookId) {
      if ((STUDY_SUBJECTS as readonly string[]).includes(initialTarget.bookId)) {
        return initialTarget.bookId as StudySubject;
      }
      const matched = state.books.find(b => b.id === initialTarget.bookId);
      if (matched) return matched.subject;
    }
    const persisted = readPersistedWrongSubject();
    if (persisted !== 'all') {
      return persisted;
    }
    return state.books[0]?.subject || '资料分析';
  };

  const [subject, setSubject] = useState<StudySubject>(resolveInitialSubject);
  const [note, setNote] = useState('');
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const subjectLocked = Boolean(initialTarget?.lockSubject);

  // 弹窗打开时自动预选传入的分类或关联题本对应分类
  useEffect(() => {
    if (isOpen) {
      setSubject(resolveInitialSubject());
    }
  }, [isOpen, initialTarget, state.books]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const maxAllowed = Math.min(MAX_SINGLE_WRONG_IMAGES, MAX_BATCH_COUNT);
    if (previewImages.length + files.length > maxAllowed) {
      alert(`单道错题最多上传 ${maxAllowed} 张图片（已有 ${previewImages.length} 张，本次选了 ${files.length} 张）`);
      e.target.value = '';
      return;
    }

    const batchValidation = validateImageBatch(files);
    if (!batchValidation.valid) {
      alert(batchValidation.error || '图片批次校验未通过');
      e.target.value = '';
      return;
    }

    setIsCompressing(true);
    const compressedList: string[] = [];
    const failedItems: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = file.name || `第 ${i + 1} 张图片`;
        try {
          const dataUrl = await compressWrongPhoto(file);
          compressedList.push(dataUrl);
        } catch (err: any) {
          console.error(`Compressing ${fileName} failed:`, err);
          failedItems.push(`• ${fileName}: ${err?.message || '压缩失败'}`);
        }
      }

      if (compressedList.length > 0) {
        setPreviewImages(prev => [...prev, ...compressedList].slice(0, maxAllowed));
      }

      if (failedItems.length > 0) {
        alert(`部分照片处理失败，未能添加：\n${failedItems.join('\n')}`);
      }
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  const handleAddSample = () => {
    if (previewImages.length >= MAX_SINGLE_WRONG_IMAGES) {
      alert(`单道错题最多添加 ${MAX_SINGLE_WRONG_IMAGES} 张图片`);
      return;
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 300;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#F4F3EB';
      ctx.fillRect(0, 0, 400, 300);
      ctx.fillStyle = '#FFFDF8';
      ctx.fillRect(20, 20, 360, 260);
      ctx.strokeStyle = '#E4E6D9';
      ctx.strokeRect(20, 20, 360, 260);
      ctx.fillStyle = '#343C2F';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('错题手稿复盘模拟', 40, 60);
      ctx.fillStyle = '#C95D53';
      ctx.font = '13px sans-serif';
      ctx.fillText('✘ 错误选项：C（计算时忽略分母首位估算）', 40, 100);
      ctx.fillStyle = '#61794F';
      ctx.fillText('✔ 正确思路：截位直除，先看差距判断保留位', 40, 130);
      const pngData = canvas.toDataURL('image/png');
      setPreviewImages(prev => [...prev, pngData].slice(0, MAX_SINGLE_WRONG_IMAGES));
    } catch {
      // Canvas unavailable
    }
  };

  const handleSubmit = async () => {
    if (previewImages.length === 0) {
      alert('请选择至少一张错题照片');
      return;
    }

    const matchedInitialBook = initialTarget?.bookId
      ? state.books.find(b => b.id === initialTarget.bookId && b.subject === subject)
      : undefined;
    const targetKey = matchedInitialBook ? matchedInitialBook.id : subject;

    const result = await addWrongRecords(targetKey, note, previewImages, initialTarget?.date);
    if (!result.ok) {
      alert(result.message || '照片保存失败：本地存储空间不足。请删除部分过期照片或导出备份后再试。');
      return;
    }

    writePersistedWrongSubject(subject);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('kaogong-wrong-subject-change', { detail: subject }));
    }

    onToast(
      previewImages.length > 1
        ? `成功归档 1 道【${getSubjectLabel(subject, state.subjectLabels)}】错题（含 ${previewImages.length} 张照片）！`
        : `成功归档 1 道【${getSubjectLabel(subject, state.subjectLabels)}】错题照片！`
    );
    setPreviewImages([]);
    setNote('');
    onClose();
  };

  const previewTimeLabel = formatWrongRecordTime({
    date: initialTarget?.date || activeDate,
    createdAt: Date.now(),
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={subjectLocked ? `添加【${getSubjectLabel(subject, state.subjectLabels)}】错题照片` : '从相册上传错题照片'}>
      <div className="space-y-4">
        {initialTarget?.date && (
          <div className="text-[11px] text-ink-muted bg-cream/70 px-3 py-2 rounded-xl border border-line flex items-center justify-between">
            <span>关联做题日期</span>
            <span className="font-mono text-ink-main font-semibold">{initialTarget.date}</span>
          </div>
        )}

        {!subjectLocked && <div>
          <label className="block text-xs text-ink-muted font-medium mb-1.5">
            1. 所属分类（八大科目 + 其他）
          </label>
          <SubjectCapsuleGrid
            ariaLabel="错题所属分类"
            columns={3}
            options={getSubjectOptions(state?.subjectLabels, true)}
            value={subject}
            onChange={val => setSubject(val as StudySubject)}
          />
        </div>}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-ink-muted font-medium">
              {subjectLocked ? '1' : '2'}. 选择错题照片（一次选多张将合并归入同一道错题）
            </label>
            <span className="text-xs font-mono text-sage-dark">
              {previewImages.length}/{MAX_SINGLE_WRONG_IMAGES} 张
            </span>
          </div>
          <div className="flex gap-2">
            <label className="flex-1 border-2 border-dashed border-line hover:border-sage rounded-2xl p-4 flex flex-col items-center justify-center cursor-pointer bg-cream/40 transition-colors">
              <Camera size={24} className="text-sage mb-1" />
              <span className="text-xs text-ink-main font-medium">
                {previewImages.length > 0 ? '点击继续追加照片（题干/解析）' : '点击选择系统相册图片（支持多选）'}
              </span>
              <input type="file" accept="image/*,.heic,.heif,image/heic,image/heif" multiple onChange={handleFileChange} className="hidden" />
            </label>
            <Button variant="secondary" size="sm" onClick={handleAddSample} className="shrink-0" disabled={isCompressing}>
              加入示例错题
            </Button>
          </div>
          {isCompressing && (
            <div className="flex items-center gap-1.5 text-xs text-sage mt-2">
              <Loader2 size={13} className="animate-spin" />
              <span>正在智能压缩并缩放照片（保留字迹，节约内存）...</span>
            </div>
          )}
        </div>

        {/* 缩略图预览网格（多图合并归为同一道错题） */}
        {previewImages.length > 0 && (
          <div>
            <div className="text-xs text-ink-muted mb-1.5">
              已选 {previewImages.length} 张照片 · 将合并保存为 <strong className="text-ink-main">1 道错题</strong>
            </div>
            <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto p-1.5 bg-cream/40 rounded-xl border border-line/60">
              {previewImages.map((img, idx) => (
                <div
                  key={idx}
                  className={`relative aspect-[4/3] rounded-lg overflow-hidden border ${
                    idx === 0 ? 'border-2 border-sage' : 'border-line'
                  }`}
                >
                  <img src={img} alt={`预览图${idx + 1}`} className="w-full h-full object-cover" />
                  <span className="absolute bottom-1 left-1 px-1.5 py-0.2 rounded bg-ink-main/75 text-white text-[10px] font-bold">
                    {idx === 0 ? '图1·封面' : `图${idx + 1}`}
                  </span>
                  <button
                    type="button"
                    aria-label={`移除第${idx + 1}张图片`}
                    onClick={() => setPreviewImages(prev => prev.filter((_, i) => i !== idx))}
                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1">
            {subjectLocked ? '2' : '3'}. 复盘原因与思路笔记 (选填)
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="例如：公式记混、截位直除保留位数不够，以及正确的解题突破口..."
            className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-xs h-20 resize-none focus:outline-none focus:border-sage"
          />
        </div>

        <div className="pt-1 flex items-center justify-between text-xs text-ink-muted">
          <span className="font-mono">记录时间：{previewTimeLabel}</span>
          <span>归属分类：<strong className="text-sage-dark">{getSubjectLabel(subject, state.subjectLabels)}</strong></span>
        </div>

        <Button variant="primary" size="md" fullWidth onClick={handleSubmit} disabled={isCompressing}>
          {previewImages.length > 1
            ? `保存为 1 道【${getSubjectLabel(subject, state.subjectLabels)}】错题 (含 ${previewImages.length} 张图)`
            : `保存并归档到【${getSubjectLabel(subject, state.subjectLabels)}】`}
        </Button>
      </div>
    </Modal>
  );
};

export const WrongRecordMoveModal: React.FC<{
  record: WrongRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onToast?: (message: string) => void;
}> = ({ record, isOpen, onClose, onToast }) => {
  const { state, updateWrongRecord } = useApp();
  const liveRecord = state.wrong.find(item => item.id === record?.id) ?? record;
  const subject = liveRecord ? resolveWrongRecordSubject(liveRecord, state.books) : '资料分析';
  const [targetSubject, setTargetSubject] = useState<StudySubject>(subject);
  const { save, isSaving, errorMsg, setErrorMsg } = useSaveMutation(onClose, message => onToast?.(message));

  useEffect(() => {
    if (isOpen) {
      setTargetSubject(subject);
      setErrorMsg('');
    }
  }, [record?.id, isOpen]);

  return <Modal isOpen={isOpen && Boolean(liveRecord)} onClose={onClose} title="转移错题分类" closeDisabled={isSaving}>
    <form className="space-y-4" onSubmit={event => {
      event.preventDefault();
      if (!liveRecord || targetSubject === subject) return;
      void save(
        () => updateWrongRecord(liveRecord.id, { subject: targetSubject }),
        `错题已转移至【${getSubjectLabel(targetSubject, state.subjectLabels)}】`,
      );
    }}>
      <FormError message={errorMsg} />
      <div>
        <span className="mb-2 block text-xs font-medium text-ink-muted">选择目标分类</span>
        <SubjectCapsuleGrid
          ariaLabel="转移错题所属分类"
          columns={3}
          disabled={isSaving}
          options={getSubjectOptions(state.subjectLabels, true)}
          value={targetSubject}
          onChange={value => { setTargetSubject(value as StudySubject); setErrorMsg(''); }}
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" fullWidth onClick={onClose} disabled={isSaving}>取消</Button>
        <Button type="submit" variant="primary" fullWidth disabled={isSaving || targetSubject === subject}>{isSaving ? '正在转移…' : '确认转移'}</Button>
      </div>
    </form>
  </Modal>;
};

/* =========================================================================
   7. Wrong Detail Modal (wrong-detail: 13:340)
   ========================================================================= */
export const WrongDetailModal: React.FC<{
  record: WrongRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onToast?: (msg: string) => void;
}> = ({ record, isOpen, onClose, onToast }) => {
  const { state, updateWrongRecord, requestWrongImageOrientations, orientationActivity, orientationErrors } = useApp();
  const liveRecord = state.wrong.find(w => w.id === record?.id) ?? record;
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [editingMeta, setEditingMeta] = useState(false);
  const [movingRecord, setMovingRecord] = useState(false);
  const [editNote, setEditNote] = useState('');
  const [editImages, setEditImages] = useState<string[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isSavingMeta, setIsSavingMeta] = useState(false);
  const [metaError, setMetaError] = useState('');
  const gestureRef = useRef<{
    mode: 'none' | 'pan' | 'pinch' | 'edge';
    startX: number;
    startY: number;
    lastDx: number;
    lastDy: number;
    originX: number;
    originY: number;
    moved: number;
    startDist: number;
    startScale: number;
    pinchOccurred: boolean;
  }>({
    mode: 'none',
    startX: 0,
    startY: 0,
    lastDx: 0,
    lastDy: 0,
    originX: 0,
    originY: 0,
    moved: 0,
    startDist: 0,
    startScale: 1,
    pinchOccurred: false,
  });
  const cardSwipeRef = useRef<{ startX: number; startY: number; moved: number }>({
    startX: 0,
    startY: 0,
    moved: 0,
  });

  useModalBack(Boolean(isOpen && record && zoomOpen), () => setZoomOpen(false));

  useEffect(() => {
    setActiveIndex(0);
    setZoomOpen(false);
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    setEditingMeta(false);
    setMovingRecord(false);
    setMetaError('');
    setIsCompressing(false);
    if (liveRecord) {
      setEditNote(liveRecord.note || '');
      setEditImages(getWrongRecordImages(liveRecord));
    }
  }, [record?.id, isOpen]);

  useEffect(() => {
    if (isOpen && record?.id) void requestWrongImageOrientations?.(record.id);
  }, [isOpen, record?.id, requestWrongImageOrientations]);

  if (!isOpen || !liveRecord) return null;

  const images = getWrongRecordImages(liveRecord);
  const safeIndex = images.length > 0 ? Math.min(activeIndex, images.length - 1) : 0;
  const activeImage = images[safeIndex] || liveRecord.image;
  const subject = resolveWrongRecordSubject(liveRecord, state.books);
  const subjectLabel = getSubjectLabel(subject, state.subjectLabels);
  const book = state.books.find(b => b.id === liveRecord.bookId);
  const timeText = formatWrongRecordTime(liveRecord);

  const handleAppendImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const currentImages = getWrongRecordImages(liveRecord);
    const maxAllowed = MAX_SINGLE_WRONG_IMAGES;
    if (currentImages.length + files.length > maxAllowed) {
      alert(`单道错题最多保存 ${maxAllowed} 张图片（已有 ${currentImages.length} 张，本次选了 ${files.length} 张）`);
      e.target.value = '';
      return;
    }
    const batchValidation = validateImageBatch(files);
    if (!batchValidation.valid) {
      alert(batchValidation.error || '图片批次校验未通过');
      e.target.value = '';
      return;
    }
    setIsCompressing(true);
    const compressedList: string[] = [];
    const failedItems: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = file.name || `第 ${i + 1} 张图片`;
        try {
          const dataUrl = await compressWrongPhoto(file);
          compressedList.push(dataUrl);
        } catch (err: any) {
          failedItems.push(`• ${fileName}: ${err?.message || '压缩失败'}`);
        }
      }
      if (compressedList.length > 0) {
        const updatedImages = [...currentImages, ...compressedList].slice(0, maxAllowed);
        const res = await updateWrongRecord(liveRecord.id, { images: updatedImages });
        if (res.ok) {
          onToast?.(`已追加 ${compressedList.length} 张错题图片`);
          setActiveIndex(updatedImages.length - 1);
          setEditImages(updatedImages);
          void requestWrongImageOrientations?.(liveRecord.id);
        } else {
          alert(res.message || '追加图片保存失败');
        }
      }
      if (failedItems.length > 0) {
        alert(`部分照片处理失败，未能添加：\n${failedItems.join('\n')}`);
      }
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  const handleEditFilesAppend = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const maxAllowed = MAX_SINGLE_WRONG_IMAGES;
    if (editImages.length + files.length > maxAllowed) {
      alert(`单道错题最多保存 ${maxAllowed} 张图片（已有 ${editImages.length} 张，本次选了 ${files.length} 张）`);
      e.target.value = '';
      return;
    }
    const batchValidation = validateImageBatch(files);
    if (!batchValidation.valid) {
      alert(batchValidation.error || '图片批次校验未通过');
      e.target.value = '';
      return;
    }
    setIsCompressing(true);
    const compressedList: string[] = [];
    const failedItems: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = file.name || `第 ${i + 1} 张图片`;
        try {
          const dataUrl = await compressWrongPhoto(file);
          compressedList.push(dataUrl);
        } catch (err: any) {
          failedItems.push(`• ${fileName}: ${err?.message || '压缩失败'}`);
        }
      }
      if (compressedList.length > 0) {
        setEditImages(prev => [...prev, ...compressedList].slice(0, maxAllowed));
      }
      if (failedItems.length > 0) {
        alert(`部分照片处理失败，未能添加：\n${failedItems.join('\n')}`);
      }
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  const handleSaveMeta = async () => {
    if (isSavingMeta) return;
    setIsSavingMeta(true);
    setMetaError('');
    try {
      const originalImages = getWrongRecordImages(liveRecord);
      const imagesChanged =
        editImages.length !== originalImages.length ||
        editImages.some((img, idx) => img !== originalImages[idx]);

      const payload: { note: string; images?: string[] } = {
        note: editNote.trim(),
      };
      if (imagesChanged) {
        payload.images = editImages;
      }

      const res = await updateWrongRecord(liveRecord.id, payload);
      if (!res.ok) {
        setMetaError(res.message);
        return;
      }
      onToast?.('已保存错题修改');
      setEditingMeta(false);
      if (imagesChanged) {
        void requestWrongImageOrientations?.(liveRecord.id);
      }
    } catch (error) {
      setMetaError(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      setIsSavingMeta(false);
    }
  };

  const clampPan = (x: number, y: number, scale: number) => {
    if (scale <= 1.01) return { x: 0, y: 0 };
    const vw = typeof window !== 'undefined' ? window.innerWidth : 390;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 844;
    const maxX = Math.max(vw * 0.55 * (scale - 1), 220 * (scale - 1));
    const maxY = Math.max(vh * 0.45 * (scale - 1), 180 * (scale - 1));
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  };

  const openZoomViewer = () => {
    if (!activeImage) return;
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    setZoomOpen(true);
  };

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={editingMeta ? () => setEditingMeta(false) : onClose}
      title={editingMeta ? '编辑复盘笔记' : '错题复盘大图详情'}
      closeDisabled={isSavingMeta}
      layout={editingMeta ? 'editor' : 'default'}
      footer={editingMeta ? <div className="flex gap-3">
        <Button variant="secondary" fullWidth onClick={() => {
          setEditNote(liveRecord.note || '');
          setEditImages(getWrongRecordImages(liveRecord));
          setEditingMeta(false);
        }} disabled={isSavingMeta}>取消</Button>
        <Button variant="primary" fullWidth onClick={handleSaveMeta} disabled={isSavingMeta}>{isSavingMeta ? '保存中...' : '保存修改'}</Button>
      </div> : undefined}
    >
      {editingMeta ? <div className="h-full min-h-0 flex flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between gap-3 text-xs">
          <span className="min-w-0 truncate text-ink-muted">{subjectLabel} · {timeText}</span>
          <span className="text-ink-muted font-mono">{editImages.length} / {MAX_SINGLE_WRONG_IMAGES} 张图片</span>
        </div>

        {/* 错题配图管理与追加入口 */}
        <div className="space-y-1.5 shrink-0">
          <div className="flex items-center justify-between text-xs">
            <label className="font-bold text-ink-main">错题配图 / 题图</label>
            {editImages.length < MAX_SINGLE_WRONG_IMAGES && (
              <label className="inline-flex items-center gap-1 text-sage font-bold cursor-pointer hover:underline text-xs">
                <Plus size={13} />
                <span>追加图片</span>
                <input type="file" accept="image/*,.heic,.heif,image/heic,image/heif" multiple onChange={handleEditFilesAppend} className="hidden" disabled={isCompressing || isSavingMeta} />
              </label>
            )}
          </div>
          {editImages.length > 0 ? (
            <div className="grid grid-cols-4 gap-2 max-h-36 overflow-y-auto p-1.5 bg-cream/40 rounded-xl border border-line/60">
              {editImages.map((img, idx) => (
                <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-line group">
                  <img src={img} alt={`图${idx + 1}`} className="w-full h-full object-cover" />
                  <span className="absolute bottom-0.5 left-0.5 px-1 rounded bg-black/60 text-white text-[9px] font-bold">
                    {idx === 0 ? '封面' : `图${idx + 1}`}
                  </span>
                  <button
                    type="button"
                    title={editImages.length <= 1 ? '错题需至少保留一张图片' : '移除此图'}
                    aria-label={`移除第${idx + 1}张图片`}
                    disabled={isSavingMeta || editImages.length <= 1}
                    onClick={() => {
                      if (editImages.length <= 1) return;
                      setEditImages(prev => prev.filter((_, i) => i !== idx));
                    }}
                    className={`absolute top-0.5 right-0.5 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold shadow-sm ${
                      editImages.length <= 1
                        ? 'bg-ink-muted/40 text-white cursor-not-allowed opacity-50'
                        : 'bg-alarm text-white hover:bg-alarm-dark'
                    }`}
                  >
                    ×
                  </button>
                </div>
              ))}
              {editImages.length < MAX_SINGLE_WRONG_IMAGES && (
                <label
                  title="追加错题图片"
                  aria-label="追加错题图片"
                  className="aspect-square rounded-lg border-2 border-dashed border-sage/60 hover:border-sage flex flex-col items-center justify-center text-sage cursor-pointer bg-sage-light/20 hover:bg-sage-light/50 transition group"
                >
                  <Plus size={18} className="group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-bold mt-0.5">追加</span>
                  <input
                    type="file"
                    accept="image/*,.heic,.heif,image/heic,image/heif"
                    multiple
                    onChange={handleEditFilesAppend}
                    className="hidden"
                    disabled={isCompressing || isSavingMeta}
                  />
                </label>
              )}
            </div>
          ) : (
            <div className="p-3 bg-cream/40 rounded-xl border border-dashed border-line text-center text-xs text-ink-muted">
              <span>暂无图片。</span>
              <label className="ml-1 text-sage font-bold cursor-pointer hover:underline">
                点击追加照片
                <input type="file" accept="image/*,.heic,.heif,image/heic,image/heif" multiple onChange={handleEditFilesAppend} className="hidden" disabled={isCompressing || isSavingMeta} />
              </label>
            </div>
          )}
        </div>

        {isCompressing && (
          <div className="flex items-center gap-1.5 text-xs text-sage shrink-0">
            <Loader2 size={13} className="animate-spin" />
            <span>正在压缩图片...</span>
          </div>
        )}

        <label htmlFor="wrong-note-editor" className="shrink-0 text-sm font-bold text-ink-main">复盘原因与解题突破口</label>
        <FormError message={metaError} />
        <textarea
          id="wrong-note-editor"
          value={editNote}
          disabled={isSavingMeta}
          onChange={e => setEditNote(e.target.value)}
          maxLength={2000}
          placeholder="记下错因、判断线索和下次解题的突破口…"
          className="flex-1 min-h-[96px] w-full bg-card border border-line rounded-xl px-4 py-3 text-base leading-7 text-ink-main focus:outline-none focus:border-sage focus:ring-2 focus:ring-sage/15 resize-none select-text"
        />
        <p className="shrink-0 text-right text-xs text-ink-muted tabular-nums">{editNote.length} / 2000 字</p>
      </div> : (
      <div className="space-y-4">
        {/* 大图显示与多图直接左右滑动切换 */}
        <div
          className="w-full bg-[#EAE8DD] rounded-2xl overflow-hidden border border-line flex items-center justify-center max-h-[52vh] relative select-none"
          onTouchStart={e => {
            if (e.touches.length === 1) {
              cardSwipeRef.current = {
                startX: e.touches[0].clientX,
                startY: e.touches[0].clientY,
                moved: 0,
              };
            }
          }}
          onTouchMove={e => {
            if (e.touches.length === 1) {
              const dx = e.touches[0].clientX - cardSwipeRef.current.startX;
              const dy = e.touches[0].clientY - cardSwipeRef.current.startY;
              cardSwipeRef.current.moved = Math.max(cardSwipeRef.current.moved, Math.hypot(dx, dy));
            }
          }}
          onTouchEnd={e => {
            if (images.length > 1 && e.changedTouches.length === 1) {
              const dx = e.changedTouches[0].clientX - cardSwipeRef.current.startX;
              const dy = e.changedTouches[0].clientY - cardSwipeRef.current.startY;
              if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) {
                setActiveIndex(prev =>
                  dx < 0 ? (prev + 1) % images.length : (prev - 1 + images.length) % images.length
                );
              }
            }
          }}
        >
          {activeImage ? (
            <button
              type="button"
              aria-label="点击放大查看错题图片"
              onClick={() => {
                if (cardSwipeRef.current.moved < 12) {
                  openZoomViewer();
                }
              }}
              className="w-full h-full flex items-center justify-center relative group cursor-zoom-in focus:outline-none"
            >
              <OrientedImage src={activeImage} rotation={liveRecord.imageOrientations?.[safeIndex]?.rotation} alt="错题大图" className="w-full h-full max-h-[52vh] object-contain" />
              <span className="absolute bottom-2 left-2.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-ink-main/75 text-white text-[11px] font-medium backdrop-blur-sm shadow-sm">
                <ZoomIn size={12} />
                <span>点击放大</span>
              </span>
            </button>
          ) : (
            <div className="py-12 text-center text-ink-muted text-xs space-y-2">
              <ImageIcon size={36} className="mx-auto text-sage/40 mb-1" />
              <span>暂无错题配图，需要补充题图？</span>
              <div>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sage text-white font-bold cursor-pointer hover:bg-sage-dark transition shadow-sm">
                  <Camera size={13} />
                  <span>添加错题图片</span>
                  <input type="file" accept="image/*,.heic,.heif,image/heic,image/heif" multiple onChange={handleAppendImages} className="hidden" disabled={isCompressing} />
                </label>
              </div>
            </div>
          )}

          {images.length > 1 && (
            <span className="absolute bottom-2 right-2.5 px-2.5 py-0.5 rounded-full bg-ink-main/80 text-white text-xs font-mono font-bold">
              {safeIndex + 1} / {images.length}
            </span>
          )}
        </div>

        {/* 多图缩略图导航栏与追加入口 */}
        {images.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto py-1 px-0.5" role="toolbar" aria-label="错题图片缩略图导航与追加">
            {images.map((img, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setActiveIndex(idx)}
                className={`relative w-11 h-11 rounded-lg overflow-hidden shrink-0 border-2 transition ${
                  idx === safeIndex ? 'border-sage shadow-sm' : 'border-line/70 opacity-60 hover:opacity-100'
                }`}
              >
                <OrientedImage
                  src={img}
                  rotation={liveRecord.imageOrientations?.[idx]?.rotation}
                  alt={`缩略图${idx + 1}`}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-0 right-0 px-1 text-[9px] font-bold bg-black/60 text-white rounded-tl">
                  {idx + 1}
                </span>
              </button>
            ))}
            {images.length < MAX_SINGLE_WRONG_IMAGES && (
              <label
                title="追加错题图片"
                aria-label="追加错题图片"
                className="relative w-11 h-11 rounded-lg border-2 border-dashed border-sage/60 hover:border-sage flex items-center justify-center text-sage cursor-pointer shrink-0 bg-sage-light/30 hover:bg-sage-light/60 transition"
              >
                <Plus size={16} />
                <input
                  type="file"
                  accept="image/*,.heic,.heif,image/heic,image/heif"
                  multiple
                  onChange={handleAppendImages}
                  className="hidden"
                  disabled={isCompressing}
                />
              </label>
            )}
          </div>
        )}

        {images.length > 0 && <div className="flex items-center justify-between gap-2 text-[11px] text-ink-muted" aria-live="polite">
          <span>{orientationActivity?.recordId === liveRecord.id && orientationActivity.index === safeIndex
            ? '正在自动摆正…'
            : orientationErrors?.[`${liveRecord.id}:${safeIndex}`]
              ?? (liveRecord.imageOrientations?.[safeIndex]?.status === 'resolved' ? '已自动确认图片方向' : liveRecord.imageOrientations?.[safeIndex]?.status === 'unresolved' ? '未能确认方向，保留原图' : '联网后自动摆正图片')}</span>
          {liveRecord.imageOrientations?.[safeIndex]?.status === 'unresolved' || orientationErrors?.[`${liveRecord.id}:${safeIndex}`] ? <button type="button" className="shrink-0 text-sage font-bold px-2 py-1" onClick={() => { void requestWrongImageOrientations?.(liveRecord.id, true); }}>重新识别</button> : null}
        </div>}

        {isCompressing && (
          <div className="flex items-center gap-1.5 text-xs text-sage">
            <Loader2 size={13} className="animate-spin" />
            <span>正在压缩并追加图片...</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between text-xs gap-2">
          <div className="flex items-center gap-2">
          <button type="button" disabled={isSavingMeta} onClick={() => {
            setEditNote(liveRecord.note || '');
            setEditImages(getWrongRecordImages(liveRecord));
            setMetaError('');
            setEditingMeta(true);
          }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sage-light text-sage font-bold border border-sage/25">
            <Edit2 size={13} /><span>编辑</span>
          </button>
          <button type="button" disabled={isSavingMeta || editingMeta} onClick={() => setMovingRecord(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cream text-ink-muted font-bold border border-line disabled:opacity-50">
            <ArrowRightLeft size={13} /><span>转移</span>
          </button>
          {images.length < MAX_SINGLE_WRONG_IMAGES && (
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cream text-ink-main font-bold border border-line cursor-pointer hover:border-sage transition">
              <Camera size={13} className="text-sage" /><span>追加图片</span>
              <input type="file" accept="image/*,.heic,.heif,image/heic,image/heif" multiple onChange={handleAppendImages} className="hidden" disabled={isCompressing} />
            </label>
          )}
          </div>
          <span className="text-ink-muted font-mono font-semibold shrink-0">{timeText}</span>
        </div>
        <div className="flex gap-2 flex-wrap text-xs">
          <Tag variant="sage">{subjectLabel}</Tag>
          {book && <Tag variant="potato">{book.name}</Tag>}
          {images.length > 1 && <Tag variant="gray">共 {images.length} 张图 · 左右滑动切换</Tag>}
        </div>

          <div className="bg-cream/60 p-3.5 rounded-2xl border border-line/80 space-y-1">
            <div className="text-xs font-bold text-ink-main">复盘原因与解题突破口</div>
            <p className="text-xs text-ink-muted leading-relaxed whitespace-pre-wrap">
              {liveRecord.note || '未填写复盘笔记'}
            </p>
          </div>

        <Button variant="secondary" size="md" fullWidth onClick={onClose} disabled={isSavingMeta}>
          关闭
        </Button>
      </div>
      )}
    </Modal>
    <WrongRecordMoveModal record={liveRecord} isOpen={movingRecord} onClose={() => setMovingRecord(false)} onToast={onToast} />

      {/* 全屏默认1倍看图，支持直接左右滑动切换多图、双指自由放大与放大后单指拖动 */}
      {zoomOpen && activeImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="错题图片全屏放大预览"
          className="fixed inset-0 z-[80] bg-black/95 flex flex-col select-none touch-none"
        >
          {/* 顶部操作栏 */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 text-white z-10 bg-gradient-to-b from-black/80 to-transparent">
            <div className="min-w-0">
              <div className="text-xs font-bold truncate">
                {subjectLabel}
                {images.length > 1 ? ` · 图 ${safeIndex + 1}/${images.length}` : ''}
              </div>
              <div className="text-[11px] text-white/70">
                {images.length > 1
                  ? '左右滑动切换图片 · 双指捏合放大 · 轻点画面退出'
                  : '双指捏合放大 · 放大后单指拖动 · 轻点画面退出'}
              </div>
            </div>
            <button
              type="button"
              aria-label="退出全屏放大"
              onClick={() => setZoomOpen(false)}
              className="shrink-0 inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-sm hover:bg-white/25 active:scale-95"
            >
              <X size={15} />
              <span>退出放大</span>
            </button>
          </div>

          {/* 中央可左右滑切图、双指缩放与单指拖动图片画布 */}
          <div
            className="flex-1 relative overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing"
            onTouchStart={e => {
              if (e.touches.length >= 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                gestureRef.current = {
                  ...gestureRef.current,
                  mode: 'pinch',
                  moved: 99,
                  startDist: Math.hypot(dx, dy) || 1,
                  startScale: zoomScale,
                  pinchOccurred: true,
                };
                return;
              }
              if (e.touches.length === 1) {
                const t = e.touches[0];
                const vw = typeof window !== 'undefined' ? window.innerWidth : 390;
                // 预留屏幕左右边缘 24px 安全区，不阻挡安卓系统边缘侧滑返回手势
                if (t.clientX < 24 || t.clientX > vw - 24) {
                  gestureRef.current.mode = 'edge';
                  return;
                }
                gestureRef.current = {
                  mode: 'pan',
                  startX: t.clientX,
                  startY: t.clientY,
                  lastDx: 0,
                  lastDy: 0,
                  originX: panOffset.x,
                  originY: panOffset.y,
                  moved: 0,
                  startDist: 0,
                  startScale: zoomScale,
                  pinchOccurred: false,
                };
              }
            }}
            onTouchMove={e => {
              const g = gestureRef.current;
              if (g.mode === 'edge') return;
              if (e.touches.length >= 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.hypot(dx, dy) || 1;
                if (g.mode !== 'pinch') {
                  g.mode = 'pinch';
                  g.startDist = dist;
                  g.startScale = zoomScale;
                  g.pinchOccurred = true;
                  return;
                }
                const nextScale = Math.max(1, Math.min(5, g.startScale * (dist / g.startDist)));
                setZoomScale(Number(nextScale.toFixed(2)));
                setPanOffset(prev => clampPan(prev.x, prev.y, nextScale));
                return;
              }
              if (e.touches.length === 1 && g.mode === 'pan') {
                const t = e.touches[0];
                const dx = t.clientX - g.startX;
                const dy = t.clientY - g.startY;
                g.lastDx = dx;
                g.lastDy = dy;
                g.moved = Math.max(g.moved, Math.hypot(dx, dy));
                if (zoomScale > 1.01) {
                  setPanOffset(clampPan(g.originX + dx, g.originY + dy, zoomScale));
                } else if (images.length > 1 && Math.abs(dx) > Math.abs(dy)) {
                  setPanOffset({ x: Math.max(-120, Math.min(120, dx * 0.45)), y: 0 });
                }
              }
            }}
            onTouchEnd={e => {
              const g = gestureRef.current;
              // 双指缩放后若还剩一根手指在屏幕上，平滑接力为单指拖动而不误触发单击退出
              if (e.touches.length === 1) {
                const t = e.touches[0];
                g.mode = 'pan';
                g.startX = t.clientX;
                g.startY = t.clientY;
                g.lastDx = 0;
                g.lastDy = 0;
                g.originX = panOffset.x;
                g.originY = panOffset.y;
                g.moved = 99;
                return;
              }
              if (e.touches.length === 0) {
                if (!g.pinchOccurred && g.mode === 'pan') {
                  if (g.moved < 8) {
                    setZoomOpen(false);
                  } else if (
                    zoomScale <= 1.02 &&
                    images.length > 1 &&
                    Math.abs(g.lastDx) >= 40 &&
                    Math.abs(g.lastDx) > Math.abs(g.lastDy)
                  ) {
                    setActiveIndex(prev =>
                      g.lastDx < 0 ? (prev + 1) % images.length : (prev - 1 + images.length) % images.length
                    );
                    setZoomScale(1);
                    setPanOffset({ x: 0, y: 0 });
                  } else if (zoomScale <= 1.02) {
                    setZoomScale(1);
                    setPanOffset({ x: 0, y: 0 });
                  }
                } else if (zoomScale <= 1.02) {
                  setZoomScale(1);
                  setPanOffset({ x: 0, y: 0 });
                }
                g.mode = 'none';
                g.pinchOccurred = false;
              }
            }}
            onWheel={e => {
              e.preventDefault();
              const delta = e.deltaY < 0 ? 0.25 : -0.25;
              const nextScale = Math.max(1, Math.min(5, Number((zoomScale + delta).toFixed(2))));
              setZoomScale(nextScale);
              setPanOffset(prev => clampPan(prev.x, prev.y, nextScale));
            }}
            onMouseDown={e => {
              if (e.button !== 0) return;
              gestureRef.current = {
                mode: 'pan',
                startX: e.clientX,
                startY: e.clientY,
                lastDx: 0,
                lastDy: 0,
                originX: panOffset.x,
                originY: panOffset.y,
                moved: 0,
                startDist: 0,
                startScale: zoomScale,
                pinchOccurred: false,
              };
            }}
            onMouseMove={e => {
              const g = gestureRef.current;
              if (g.mode !== 'pan') return;
              const dx = e.clientX - g.startX;
              const dy = e.clientY - g.startY;
              g.lastDx = dx;
              g.lastDy = dy;
              g.moved = Math.max(g.moved, Math.hypot(dx, dy));
              if (zoomScale > 1.01) {
                setPanOffset(clampPan(g.originX + dx, g.originY + dy, zoomScale));
              } else if (images.length > 1 && Math.abs(dx) > Math.abs(dy)) {
                setPanOffset({ x: Math.max(-120, Math.min(120, dx * 0.45)), y: 0 });
              }
            }}
            onMouseUp={() => {
              const g = gestureRef.current;
              if (g.mode === 'pan') {
                if (g.moved < 8) {
                  setZoomOpen(false);
                } else if (
                  zoomScale <= 1.02 &&
                  images.length > 1 &&
                  Math.abs(g.lastDx) >= 40 &&
                  Math.abs(g.lastDx) > Math.abs(g.lastDy)
                ) {
                  setActiveIndex(prev =>
                    g.lastDx < 0 ? (prev + 1) % images.length : (prev - 1 + images.length) % images.length
                  );
                  setZoomScale(1);
                  setPanOffset({ x: 0, y: 0 });
                } else if (zoomScale <= 1.02) {
                  setPanOffset({ x: 0, y: 0 });
                }
              }
              gestureRef.current.mode = 'none';
            }}
          >
            <OrientedImage
              rotation={liveRecord.imageOrientations?.[safeIndex]?.rotation}
              src={activeImage}
              alt="错题全屏放大图"
              draggable={false}
              style={{
                transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${zoomScale})`,
                transformOrigin: 'center center',
              }}
              className="max-w-full max-h-full object-contain transition-transform duration-75 ease-out pointer-events-none"
            />
          </div>
        </div>
      )}
    </>
  );
};

/* =========================================================================
   8. Login & Register Modals (login: 13:779 / register: 13:879)
   ========================================================================= */
export const AuthModal: React.FC<{
  isOpen: boolean;
  mode: 'login' | 'register';
  onClose: () => void;
  onToast: (msg: string) => void;
}> = ({ isOpen, mode, onClose, onToast }) => {
  const { login, register } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const cleanUser = username.trim().toLowerCase();

    if (cleanUser.length < 2) {
      setErrorMsg('用户名至少需要 2 个字符');
      return;
    }
    if (password.length < 8) {
      setErrorMsg('密码至少需要 8 个字符');
      return;
    }
    if (mode === 'register' && !inviteCode.trim()) {
      setErrorMsg('本系统为邀请制，请输入有效的注册邀请码');
      return;
    }

    setIsSubmitting(true);
    if (mode === 'login') {
      const res = await login(cleanUser, password);
      setIsSubmitting(false);
      if (!res.ok) {
        setErrorMsg(res.message);
        return;
      }
      onToast('登录成功，已载入学员专属空间！');
      onClose();
    } else {
      const res = await register(cleanUser, password, nickname.trim() || cleanUser, inviteCode.trim());
      setIsSubmitting(false);
      if (!res.ok) {
        setErrorMsg(res.message);
        return;
      }
      onToast('注册成功，欢迎加入备考工作台！');
      onClose();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={mode === 'login' ? '登录学员专属空间' : '注册新备考账号'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="p-2.5 bg-alarm-light text-alarm rounded-xl text-xs flex items-center gap-1.5 border border-red-200">
            <AlertCircle size={14} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1">用户名 (转小写)</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-sm focus:outline-none focus:border-sage"
          />
        </div>

        {mode === 'register' && (
          <div>
            <label className="block text-xs text-ink-muted font-medium mb-1">学员昵称</label>
            <input
              type="text"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-sm focus:outline-none focus:border-sage"
            />
          </div>
        )}

        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1">密码 (至少8位)</label>
          <div className="relative flex items-center">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full pl-3 pr-10 py-2 bg-cream/70 border border-line rounded-xl text-sm focus:outline-none focus:border-sage"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2.5 p-1 text-ink-muted hover:text-ink-main focus:outline-none transition-colors"
              title={showPassword ? '隐藏明文密码' : '显示明文密码'}
              aria-label={showPassword ? '隐藏明文密码' : '显示明文密码'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {mode === 'register' && (
          <div>
            <label className="block text-xs text-ink-muted font-medium mb-1">邀请码 (一次性)</label>
            <input
              type="text"
              value={inviteCode}
              placeholder="请输入管理员生成的邀请码"
              onChange={e => setInviteCode(e.target.value)}
              className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-sm focus:outline-none focus:border-sage font-mono"
            />
          </div>
        )}

        <p className="text-[11px] text-ink-muted leading-relaxed">
          {mode === 'login'
            ? '登录后本地修改将自动与 Linux 云端服务双向同步。'
            : '本软件为朋友邀请制，注册成功后将分配独立云端工作空间。'}
        </p>

        <Button variant="primary" size="md" fullWidth type="submit" disabled={isSubmitting}>
          {isSubmitting ? '正在处理...' : mode === 'login' ? '立即登录' : '创建账号'}
        </Button>
      </form>
    </Modal>
  );
};

/* =========================================================================
   9. Download APK Modal (download-apk: 13:3730)
   ========================================================================= */
export { DownloadApkModal } from './DownloadApkModal';

/* =========================================================================
   10. Overall Legend Detail Modal (overall-legend: 13:3931)
   ========================================================================= */
export const OverallLegendModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  records?: StudyRecord[];
  rangeLabel?: string;
}> = ({ isOpen, onClose, records, rangeLabel = '全部记录' }) => {
  const { state } = useApp();
  const displayedRecords = records || state.records;
  const totalMin = displayedRecords.reduce((sum, r) => sum + r.minutes, 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="科目投入时间与图例详情">
      <div className="space-y-3">
        <div className="text-xs text-ink-muted">
          {rangeLabel}已登记投入：<span className="font-bold text-ink-main font-mono">{totalMin}</span> 分钟
        </div>

        <div className="space-y-2 pt-1">
          {STUDY_SUBJECTS.map(subj => {
            const mins = displayedRecords.filter(r => r.subject === subj).reduce((sum, r) => sum + r.minutes, 0);
            const pct = totalMin > 0 ? ((mins / totalMin) * 100).toFixed(1) : '0.0';
            return (
              <div key={subj} className="flex items-center justify-between p-2.5 bg-cream/40 rounded-xl border border-line/60 text-xs">
                <span className="flex items-center gap-1.5 font-medium text-ink-main">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: SUBJECT_COLORS[STUDY_SUBJECTS.indexOf(subj)] }} />
                  {getSubjectLabel(subj, state.subjectLabels)}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-ink-muted font-mono">{pct}%</span>
                  <span className="font-bold text-sage font-mono min-w-[50px] text-right">{mins} 分钟</span>
                </div>
              </div>
            );
          })}
        </div>

        <Button variant="secondary" size="md" fullWidth onClick={onClose}>
          关闭
        </Button>
      </div>
    </Modal>
  );
};

/* =========================================================================
   11. Daily Countdown Reminder Modal
   ========================================================================= */
export const DailyCountdownReminderModal: React.FC<{
  isOpen: boolean;
  items: CountdownReminderItem[];
  onClose: () => void;
}> = ({ isOpen, items, onClose }) => {
  if (!isOpen || items.length === 0) return null;
  const primary = items[0];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="今日备考倒数日提醒" blocksReminders={false}>
      <div className="space-y-4">
        <div className="bg-gradient-to-br from-potato-light/70 via-cream/80 to-sage-light/30 p-4 rounded-2xl border border-potato-border/70 flex items-center gap-3.5">
          <div className="shrink-0">
            <PotatoSprite pose={6} size={56} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-potato/20 text-[#9A6F18] text-[11px] font-bold">
              <Sparkles size={11} />
              <span>新的一天，继续稳步向前</span>
            </div>
            <div className="text-sm font-bold text-ink-main leading-snug">
              {primary.days === 0
                ? `「${primary.name}」就在今天，沉着应战！`
                : `距离「${primary.name}」还有 ${primary.days} 天`}
            </div>
            <div className="text-[11px] text-ink-muted">
              目标日期：{primary.date} · 每天一点积累，终会迎来收获
            </div>
          </div>
        </div>

        {items.length > 1 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-ink-muted">全部倒数日目标</div>
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5">
              {items.map(item => (
                <div
                  key={item.id}
                  className="flex items-center justify-between px-3 py-2 rounded-xl bg-cream/60 border border-line/70 text-xs"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="font-bold text-ink-main truncate">{item.name}</div>
                    <div className="text-[11px] text-ink-muted font-mono">{item.date}</div>
                  </div>
                  <span className="shrink-0 px-2.5 py-1 rounded-full bg-sage-light/60 text-sage font-mono font-bold">
                    {item.days === 0 ? '就在今天' : `剩 ${item.days} 天`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <Button variant="primary" size="md" fullWidth onClick={onClose}>
          知道了，开启今日备考！
        </Button>
      </div>
    </Modal>
  );
};
