import { parseIntegerDraft } from '../../utils/numericDraft';
import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal, Button, Tag } from '../common/UIComponents';
import { SUBJECTS, Subject, Book, Course, WrongRecord, StudyRecord, MutationResult } from '../../types';
import { PotatoSprite } from '../common/PotatoSprite';
import { Smartphone, Download, CheckCircle2, AlertCircle, Camera, Image as ImageIcon, Loader2, Eye, EyeOff } from 'lucide-react';
import { compressImage, compressWrongPhoto, validateImageBatch, MAX_BATCH_COUNT } from '../../utils/imageCompressor';

function useSaveMutation(onClose: () => void, onToast: (message: string) => void) {
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const save = async (action: () => Promise<MutationResult<unknown>>, message: string) => {
    if (isSaving) return;
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
  const { state, addPlan } = useApp();
  const { save, isSaving, errorMsg, setErrorMsg } = useSaveMutation(onClose, onToast);
  const initial = state.library.find(l => l.id === initialLibraryId) ?? state.library[0];
  const [type, setType] = useState(initial?.type ?? 'book');
  const [subject, setSubject] = useState('all');
  const [selectedLibId, setSelectedLibId] = useState(initial?.id ?? '');
  const [minutes, setMinutes] = useState(String(initial?.defaultMinutes ?? 30));
  const [lessons, setLessons] = useState('1');
  const selectedItem = state.library.find(l => l.id === selectedLibId);
  const course = state.courses.find(c => selectedItem?.type === 'course' && c.id === selectedItem.sourceId);
  const remaining = course ? course.totalLessons - course.completedLessons : 0;
  const items = state.library.filter(l => l.type === type && (subject === 'all' || subject === l.subject));
  const validMinutes = /^\d+$/.test(minutes) && Number.isSafeInteger(Number(minutes)) && Number(minutes) > 0;
  const validLessons = type !== 'course' || Boolean(course && /^\d+$/.test(lessons) && Number.isSafeInteger(Number(lessons)) && Number(lessons) > 0 && Number(lessons) <= remaining);
  const select = (id: string) => { setSelectedLibId(id); setMinutes(String(state.library.find(l => l.id === id)?.defaultMinutes ?? 30)); setLessons('1'); setErrorMsg(''); };
  useEffect(() => {
    if (!isOpen) return;
    const item = state.library.find(l => l.id === initialLibraryId) ?? state.library[0];
    setType(item?.type ?? 'book'); setSubject('all'); select(item?.id ?? '');
  }, [isOpen, initialLibraryId]);
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || selectedItem.type !== type || !validMinutes || !validLessons) { setErrorMsg('请选择事项，填写大于0的分钟和不超过剩余数量的节数。'); return; }
    void save(() => addPlan(selectedLibId, Number(minutes), type === 'course' ? Number(lessons) : undefined), '已成功添加到今日日程！');
  };
  return <Modal isOpen={isOpen} onClose={onClose} title="添加今日日程">
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormError message={errorMsg} />
      <div role="group" aria-label="日程类型" className="grid grid-cols-3 rounded-xl bg-cream p-1 gap-1">
        {([['book','题本'],['course','网课'],['custom','自定义']] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={type === value} onClick={() => {setType(value);setSubject('all');select(state.library.find(l => l.type === value)?.id ?? '');}} className={`rounded-lg py-2 text-xs ${type === value ? 'bg-paper text-sage font-bold shadow-sm' : 'text-ink-muted'}`}>{label}</button>)}
      </div>
      <label className="block text-xs text-ink-muted">所属科目<select aria-label="筛选日程科目" value={subject} onChange={e => { const next=e.target.value; setSubject(next);select(state.library.find(l => l.type === type && (next === 'all' || next === l.subject))?.id ?? '');}} className="mt-1 w-full rounded-xl border border-line p-2.5 bg-cream/70"><option value="all">全部科目</option>{SUBJECTS.map(s => <option key={s}>{s}</option>)}</select></label>
      <label className="block text-xs text-ink-muted">选择事项<select aria-label="选择事项" value={selectedLibId} onChange={e => select(e.target.value)} className="mt-1 w-full px-3 py-2.5 bg-cream/70 border border-line rounded-xl text-sm">
        {!items.length && <option value="">该分类暂无内容，请先到学习库添加</option>}{items.map(l => <option key={l.id} value={l.id}>{l.name} · {l.subject}</option>)}
      </select></label>
      <label className="block text-xs text-ink-muted">今日计划用时（分钟）<input aria-label="今日计划用时" type="number" min="1" step="1" required value={minutes} onChange={e => setMinutes(e.target.value)} className="mt-1 w-full px-3 py-2.5 border border-line rounded-xl bg-cream/70 font-mono text-sm" /></label>
      {type === 'course' && <div><p className="text-xs text-ink-muted mb-2">剩余 {Math.max(0,remaining)} 节</p><label className="text-xs text-ink-muted">本次计划节数<input aria-label="本次计划节数" type="number" min="1" max={remaining} step="1" required value={lessons} onChange={e => setLessons(e.target.value)} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-line bg-cream/70 text-sm" /></label>{!validLessons && <p className="text-xs text-alarm mt-1">节数须大于0，且不能超过剩余 {Math.max(0,remaining)} 节。</p>}<p className="text-xs text-ink-muted mt-2">完成后确认实际节数，真实用时自动记录。</p></div>}
      {!validMinutes && <p className="text-xs text-alarm">时长须大于0，空白不能加入。</p>}
      {onOpenCustomAdd && <button type="button" className="text-xs text-sage" onClick={() => {onClose();onOpenCustomAdd();}}>添加自定义学习事项</button>}
      <Button type="submit" variant="primary" fullWidth disabled={isSaving || !selectedItem || selectedItem.type !== type || !validMinutes || !validLessons}>确认加入今日日程</Button>
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
  const { addBook, editBook } = useApp();

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
          <label className="block text-xs text-ink-muted font-medium mb-1">所属科目</label>
          <select
            value={subject}
            onChange={e => setSubject(e.target.value as Subject)}
            className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-sm focus:outline-none focus:border-sage"
          >
            {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
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
      <div><label className="block text-xs text-ink-muted mb-1" htmlFor="course-subject">所属科目</label><select id="course-subject" value={subject} onChange={e => setSubject(e.target.value as Subject)} className="w-full px-3 py-2.5 bg-cream/70 border border-line rounded-xl text-sm">{SUBJECTS.map(item => <option key={item} value={item}>{item}</option>)}</select></div>
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
  const { addCustomItem } = useApp();
  const { save, isSaving, errorMsg, setErrorMsg } = useSaveMutation(onClose, onToast);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState<Subject>('申论');
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
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例如：每日晨读人民日报时评"
            className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-sm focus:outline-none focus:border-sage"
          />
        </div>

        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1">归属科目</label>
          <select
            value={subject}
            onChange={e => setSubject(e.target.value as Subject)}
            className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-sm focus:outline-none focus:border-sage"
          >
            {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
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
  cdIndex: number;
  onClose: () => void;
  onToast: (msg: string) => void;
}> = ({ isOpen, cdIndex, onClose, onToast }) => {
  const { state, updateCountdown } = useApp();
  const { save, isSaving, errorMsg } = useSaveMutation(onClose, onToast);
  const cd = state.countdowns[cdIndex];
  const [date, setDate] = useState('');

  useEffect(() => {
    if (cd) setDate(cd.date);
  }, [cd, isOpen]);

  if (!cd) return null;

  const handleSave = () => {
    void save(() => updateCountdown(cd.id, date), `已更新${cd.name}考试日期！`);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`设置${cd.name}考试日期`}>
      <div className="space-y-4">
        <FormError message={errorMsg} />
        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1">考试日期</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full px-3 py-2.5 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
          />
        </div>
        <p className="text-xs text-ink-muted leading-relaxed">
          考试类型固定为「国考、省考、事业编」三大考程，修改后首页即时展示剩余备考天数。
        </p>
        <Button variant="primary" size="md" fullWidth onClick={handleSave} disabled={isSaving}>
          保存考试日期
        </Button>
      </div>
    </Modal>
  );
};

/* =========================================================================
   6. Photo Import Modal (photo-import: 13:158)
   ========================================================================= */
export const PhotoImportModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
  initialTarget?: { bookId: string; date: string };
}> = ({ isOpen, onClose, onToast, initialTarget }) => {
  const { state, addWrongRecords } = useApp();
  const [bookId, setBookId] = useState(initialTarget?.bookId || state.books[0]?.id || '');
  const [note, setNote] = useState('');
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);

  // 关键修复 (Defect F07)：弹窗打开或题本数据加载完成时，自动校正有效 bookId，优先使用 initialTarget 预选
  useEffect(() => {
    if (isOpen) {
      if (initialTarget?.bookId && state.books.some(b => b.id === initialTarget.bookId)) {
        setBookId(initialTarget.bookId);
      } else if (!bookId || !state.books.some(b => b.id === bookId)) {
        if (state.books.length > 0) {
          setBookId(state.books[0].id);
        }
      }
    }
  }, [isOpen, initialTarget, state.books]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (previewImages.length + files.length > MAX_BATCH_COUNT) {
      alert(`单次最多上传 ${MAX_BATCH_COUNT} 张图片（已有 ${previewImages.length} 张，本次选了 ${files.length} 张）`);
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
        setPreviewImages(prev => [...prev, ...compressedList]);
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
    // Generate a raster PNG sample (SVG data URLs are not accepted by the server media
    // pipeline, so a canvas PNG keeps the demo photo syncable across devices).
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
      setPreviewImages(prev => [...prev, pngData]);
    } catch {
      // Canvas unavailable: do not inject an unsyncable SVG placeholder.
    }
  };

  const handleSubmit = async () => {
    if (!bookId) {
      alert('请先创建题本');
      return;
    }
    if (previewImages.length === 0) {
      alert('请选择至少一张错题照片');
      return;
    }

    // Attempt persistent write with safety check (Fixes A01)
    const result = await addWrongRecords(bookId, note, previewImages, initialTarget?.date);
    if (!result.ok) {
      alert(result.message || '照片保存失败：本地存储空间不足。请删除部分过期照片或导出备份后再试。');
      // Keep user's input intact without closing modal
      return;
    }

    onToast(`成功归档 ${previewImages.length} 张错题照片！`);
    setPreviewImages([]);
    setNote('');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="从相册上传错题照片">
      <div className="space-y-4">
        {initialTarget?.date && (
          <div className="text-[11px] text-ink-muted bg-cream/70 px-3 py-2 rounded-xl border border-line flex items-center justify-between">
            <span>关联做题日期</span>
            <span className="font-mono text-ink-main font-semibold">{initialTarget.date}</span>
          </div>
        )}

        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1">所属题本</label>
          <select
            value={bookId}
            onChange={e => setBookId(e.target.value)}
            className="w-full px-3 py-2.5 bg-cream/70 border border-line rounded-xl text-sm focus:outline-none focus:border-sage"
          >
            {state.books.map(b => (
              <option key={b.id} value={b.id}>{b.name} ({b.subject})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1.5">选择错题照片 (支持多选)</label>
          <div className="flex gap-2">
            <label className="flex-1 border-2 border-dashed border-line hover:border-sage rounded-2xl p-4 flex flex-col items-center justify-center cursor-pointer bg-cream/40">
              <Camera size={24} className="text-sage mb-1" />
              <span className="text-xs text-ink-muted">点击选择系统相册图片</span>
              <input type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
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

        {/* 缩略图预览网格 */}
        {previewImages.length > 0 && (
          <div>
            <div className="text-xs text-ink-muted mb-1.5">已选 {previewImages.length} 张照片</div>
            <div className="grid grid-cols-3 gap-2 max-h-36 overflow-y-auto p-1 bg-cream/40 rounded-xl">
              {previewImages.map((img, idx) => (
                <div key={idx} className="relative aspect-[4/3] rounded-lg overflow-hidden border border-line">
                  <img src={img} alt="预览" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setPreviewImages(prev => prev.filter((_, i) => i !== idx))}
                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1">复盘原因与思路笔记 (选填)</label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="例如：公式记混、截位直除保留位数不够，以及正确的解题突破口..."
            className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-xs h-20 resize-none focus:outline-none focus:border-sage"
          />
        </div>

        <Button variant="primary" size="md" fullWidth onClick={handleSubmit}>
          保存并归档到题本
        </Button>
      </div>
    </Modal>
  );
};

/* =========================================================================
   7. Wrong Detail Modal (wrong-detail: 13:340)
   ========================================================================= */
export const WrongDetailModal: React.FC<{
  record: WrongRecord | null;
  isOpen: boolean;
  onClose: () => void;
}> = ({ record, isOpen, onClose }) => {
  const { state } = useApp();
  if (!isOpen || !record) return null;

  const book = state.books.find(b => b.id === record.bookId);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="错题复盘大图详情">
      <div className="space-y-4">
        {/* 大图显示 */}
        <div className="w-full bg-[#EAE8DD] rounded-2xl overflow-hidden border border-line flex items-center justify-center max-h-[50vh]">
          {record.image ? (
            <img src={record.image} alt="错题大图" className="w-full h-full object-contain" />
          ) : (
            <div className="py-16 text-center text-ink-muted text-xs">
              <ImageIcon size={36} className="mx-auto text-sage/40 mb-2" />
              <span>标准手稿演示图片</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Tag variant="potato">{book?.name || '原题本已删除'}</Tag>
            <Tag variant="gray">{book?.subject || '科目'}</Tag>
          </div>
          <span className="text-ink-muted font-mono">{record.date}</span>
        </div>

        <div className="bg-cream/60 p-3.5 rounded-2xl border border-line/80 space-y-1">
          <div className="text-xs font-bold text-ink-main">复盘原因与解题突破口</div>
          <p className="text-xs text-ink-muted leading-relaxed whitespace-pre-wrap">
            {record.note || '未填写复盘笔记'}
          </p>
        </div>

        <Button variant="secondary" size="md" fullWidth onClick={onClose}>
          关闭
        </Button>
      </div>
    </Modal>
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
    <Modal isOpen={isOpen} onClose={onClose} title="八科投入时间与图例详情">
      <div className="space-y-3">
        <div className="text-xs text-ink-muted">
          {rangeLabel}已登记投入：<span className="font-bold text-ink-main font-mono">{totalMin}</span> 分钟
        </div>

        <div className="space-y-2 pt-1">
          {SUBJECTS.map(subj => {
            const mins = displayedRecords.filter(r => r.subject === subj).reduce((sum, r) => sum + r.minutes, 0);
            const pct = totalMin > 0 ? ((mins / totalMin) * 100).toFixed(1) : '0.0';
            return (
              <div key={subj} className="flex items-center justify-between p-2.5 bg-cream/40 rounded-xl border border-line/60 text-xs">
                <span className="font-medium text-ink-main">{subj}</span>
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
