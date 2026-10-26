import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal, Button, Tag } from '../common/UIComponents';
import { SUBJECTS, Subject, Book, Course, WrongRecord } from '../../types';
import { PotatoSprite } from '../common/PotatoSprite';
import { Smartphone, Download, CheckCircle2, AlertCircle, Camera, Image as ImageIcon, Loader2 } from 'lucide-react';
import { compressImage } from '../../utils/imageCompressor';

/* =========================================================================
   1. Add Plan Modal (add-plan: 12:1867)
   ========================================================================= */
export const AddPlanModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
}> = ({ isOpen, onClose, onToast }) => {
  const { state, addPlan } = useApp();
  const [selectedLibId, setSelectedLibId] = useState<string>(state.library[0]?.id || '');
  const [minutes, setMinutes] = useState<number>(30);

  useEffect(() => {
    if (state.library.length > 0 && !selectedLibId) {
      setSelectedLibId(state.library[0].id);
      setMinutes(state.library[0].defaultMinutes);
    }
  }, [state.library, selectedLibId]);

  const handleSelect = (id: string) => {
    setSelectedLibId(id);
    const item = state.library.find(l => l.id === id);
    if (item) setMinutes(item.defaultMinutes);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLibId) return;
    addPlan(selectedLibId, minutes);
    onToast('已成功添加到今日日程！');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="从事项库挑选加入今天">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1.5">选择事项</label>
          <select
            value={selectedLibId}
            onChange={e => handleSelect(e.target.value)}
            className="w-full px-3 py-2.5 bg-cream/70 border border-line rounded-xl text-sm text-ink-main focus:outline-none focus:border-sage"
          >
            {state.library.map(l => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.type === 'book' ? '题本' : l.type === 'course' ? '网课' : '自定义'} · {l.subject})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1.5">今日计划用时 (分钟)</label>
          <input
            type="number"
            min="1"
            value={minutes}
            onChange={e => setMinutes(parseInt(e.target.value) || 1)}
            className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
          />
        </div>

        <Button variant="primary" size="md" fullWidth type="submit">
          确认加入今日日程
        </Button>
      </form>
    </Modal>
  );
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
  const [total, setTotal] = useState(500);
  const [pages, setPages] = useState(240);
  const [done, setDone] = useState(0);
  const [errors, setErrors] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (book) {
      setName(book.name);
      setSubject(book.subject);
      setTotal(book.total);
      setPages(book.pages);
      setDone(book.done);
      setErrors(book.errors);
      setMinutes(book.minutes);
    } else {
      setName('');
      setSubject('资料分析');
      setTotal(500);
      setPages(240);
      setDone(0);
      setErrors(0);
      setMinutes(0);
    }
    setErrorMsg('');
  }, [book, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('请填写题本名称');
      return;
    }
    if (errors > done) {
      setErrorMsg('错题数不能大于已做题数');
      return;
    }

    if (book) {
      editBook(book.id, { name: name.trim(), subject, total, pages, done, errors, minutes });
      onToast('题本数据已更新！');
    } else {
      addBook({ name: name.trim(), subject, total, pages, done, errors, minutes });
      onToast('题本已创建，并自动生成同名事项！');
    }
    onClose();
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
              min="0"
              value={total}
              onChange={e => setTotal(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted font-medium mb-1">全书页数</label>
            <input
              type="number"
              min="0"
              value={pages}
              onChange={e => setPages(parseInt(e.target.value) || 0)}
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
              value={done}
              onChange={e => setDone(parseInt(e.target.value) || 0)}
              className="w-full px-2.5 py-2 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted font-medium mb-1">错题数</label>
            <input
              type="number"
              min="0"
              value={errors}
              onChange={e => setErrors(parseInt(e.target.value) || 0)}
              className="w-full px-2.5 py-2 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage text-alarm font-bold"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted font-medium mb-1">累计用时(分)</label>
            <input
              type="number"
              min="0"
              value={minutes}
              onChange={e => setMinutes(parseInt(e.target.value) || 0)}
              className="w-full px-2.5 py-2 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
            />
          </div>
        </div>

        <p className="text-[11px] text-ink-muted/80 leading-relaxed pt-1">
          提示：直接修改累计题数与用时不会自动伪造每日学情记录，学情分析仅采纳实际完成登记。
        </p>

        <div className="pt-2">
          <Button variant="primary" size="md" fullWidth type="submit">
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
  const { addCourse, editCourse } = useApp();

  const [name, setName] = useState('');
  const [subject, setSubject] = useState<Subject>('判断推理');
  const [totalLessons, setTotalLessons] = useState(30);
  const [completedLessons, setCompletedLessons] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [url, setUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (course) {
      setName(course.name);
      setSubject(course.subject);
      setTotalLessons(course.totalLessons);
      setCompletedLessons(course.completedLessons);
      setMinutes(course.minutes);
      setUrl(course.url);
    } else {
      setName('');
      setSubject('判断推理');
      setTotalLessons(30);
      setCompletedLessons(0);
      setMinutes(0);
      setUrl('');
    }
    setErrorMsg('');
  }, [course, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('请填写网课名称');
      return;
    }
    if (completedLessons > totalLessons) {
      setErrorMsg('已完成课时不能大于总课时');
      return;
    }

    if (course) {
      editCourse(course.id, { name: name.trim(), subject, totalLessons, completedLessons, minutes, url: url.trim() });
      onToast('网课数据已更新！');
    } else {
      addCourse({ name: name.trim(), subject, totalLessons, completedLessons, minutes, url: url.trim() });
      onToast('网课已添加，并自动生成同名事项！');
    }
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={course ? '修改网课信息' : '添加新网课'}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {errorMsg && (
          <div className="p-2.5 bg-alarm-light text-alarm rounded-xl text-xs flex items-center gap-1.5 border border-red-200">
            <AlertCircle size={14} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1">课程名称</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例如：判断推理图形专项技巧精讲"
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

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs text-ink-muted font-medium mb-1">总课时</label>
            <input
              type="number"
              min="0"
              value={totalLessons}
              onChange={e => setTotalLessons(parseInt(e.target.value) || 0)}
              className="w-full px-2.5 py-2 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted font-medium mb-1">已完成课时</label>
            <input
              type="number"
              min="0"
              value={completedLessons}
              onChange={e => setCompletedLessons(parseInt(e.target.value) || 0)}
              className="w-full px-2.5 py-2 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted font-medium mb-1">累计用时(分)</label>
            <input
              type="number"
              min="0"
              value={minutes}
              onChange={e => setMinutes(parseInt(e.target.value) || 0)}
              className="w-full px-2.5 py-2 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1">课程链接 (选填，仅限http/https)</label>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://..."
            className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
          />
        </div>

        <div className="pt-2">
          <Button variant="primary" size="md" fullWidth type="submit">
            保存网课数据
          </Button>
        </div>
      </form>
    </Modal>
  );
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
  const [name, setName] = useState('');
  const [subject, setSubject] = useState<Subject>('申论');
  const [defaultMinutes, setDefaultMinutes] = useState(30);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    addCustomItem(name.trim(), subject, defaultMinutes);
    onToast('已添加自定义学习事项！');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="添加自定义备考事项">
      <form onSubmit={handleSubmit} className="space-y-3">
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
            onChange={e => setDefaultMinutes(parseInt(e.target.value) || 1)}
            className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
          />
        </div>

        <div className="pt-2">
          <Button variant="primary" size="md" fullWidth type="submit">
            添加到事项库
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
  const cd = state.countdowns[cdIndex];
  const [date, setDate] = useState('');

  useEffect(() => {
    if (cd) setDate(cd.date);
  }, [cd, isOpen]);

  if (!cd) return null;

  const handleSave = () => {
    updateCountdown(cd.id, date);
    onToast(`已更新${cd.name}考试日期！`);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`设置${cd.name}考试日期`}>
      <div className="space-y-4">
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
        <Button variant="primary" size="md" fullWidth onClick={handleSave}>
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
}> = ({ isOpen, onClose, onToast }) => {
  const { state, addWrongRecords } = useApp();
  const [bookId, setBookId] = useState(state.books[0]?.id || '');
  const [note, setNote] = useState('');
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setIsCompressing(true);
    try {
      // Real Canvas compression: limit to max 1200px, quality 0.75, keeping text sharp while shrinking from 5-10MB to ~80-120KB (Fixes A01)
      const compressedList = await Promise.all(
        files.map(file => compressImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.75 }))
      );
      setPreviewImages(prev => [...prev, ...compressedList]);
    } catch (err: any) {
      console.error('Image compression failed:', err);
      alert(`照片压缩处理失败: ${err?.message || '未知错误'}`);
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  const handleAddSample = () => {
    // Generate a clean mock canvas SVG to avoid empty states
    const svgData = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'%3E%3Crect width='100%25' height='100%25' fill='%23F4F3EB'/%3E%3Crect x='20' y='20' width='360' height='260' rx='12' fill='%23FFFDF8' stroke='%23E4E6D9'/%3E%3Ctext x='40' y='60' font-family='sans-serif' font-size='16' font-weight='bold' fill='%23343C2F'%3E错题手稿复盘模拟%3C/text%3E%3Ctext x='40' y='100' font-family='sans-serif' font-size='13' fill='%23C95D53'%3E✘ 错误选项：C（计算时忽略分母首位估算）%3C/text%3E%3Ctext x='40' y='130' font-family='sans-serif' font-size='13' fill='%2361794F'%3E✔ 正确思路：截位直除，先看差距判断保留位%3C/text%3E%3C/svg%3E";
    setPreviewImages(prev => [...prev, svgData]);
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
    const result = await addWrongRecords(bookId, note, previewImages);
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
  const { updateProfile } = useApp();
  const [username, setUsername] = useState('potato_01');
  const [password, setPassword] = useState('1234');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const cleanUser = username.trim().toLowerCase();

    if (cleanUser.length < 2) {
      setErrorMsg('用户名至少需要 2 个字符');
      return;
    }
    if (password.length < 4) {
      setErrorMsg('密码至少需要 4 个字符');
      return;
    }

    // Update profile in isolated state
    updateProfile('土豆备考空间', undefined);
    onToast(mode === 'login' ? `欢迎回来，${cleanUser}！已连接云端状态。` : `注册成功，欢迎开启备考，${cleanUser}！`);
    onClose();
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

        <div>
          <label className="block text-xs text-ink-muted font-medium mb-1">密码 (至少4位)</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-3 py-2 bg-cream/70 border border-line rounded-xl text-sm focus:outline-none focus:border-sage"
          />
        </div>

        <p className="text-[11px] text-ink-muted leading-relaxed">
          适配独立 Node 服务端的用户名与密码鉴权接口规范（/api/auth/*）。
        </p>

        <Button variant="primary" size="md" fullWidth type="submit">
          {mode === 'login' ? '立即登录' : '创建账号'}
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
}> = ({ isOpen, onClose }) => {
  const { state } = useApp();
  const totalMin = state.records.reduce((sum, r) => sum + r.minutes, 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="八科投入时间与图例详情">
      <div className="space-y-3">
        <div className="text-xs text-ink-muted">
          已登记全部累计投入：<span className="font-bold text-ink-main font-mono">{totalMin}</span> 分钟
        </div>

        <div className="space-y-2 pt-1">
          {SUBJECTS.map(subj => {
            const mins = state.records.filter(r => r.subject === subj).reduce((sum, r) => sum + r.minutes, 0);
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
