import React, { useMemo, useState } from 'react';
import { Camera, Eye, Trash2, BookOpen, ChevronDown, ChevronRight, Search, Image as ImageIcon } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { PotatoSprite } from '../common/PotatoSprite';
import { Button, Card, Tag } from '../common/UIComponents';
import { WrongRecord } from '../../types';
interface WrongViewProps {
  onOpenImportModal: () => void;
  onOpenDetailModal: (record: WrongRecord) => void;
  onOpenDeleteConfirm: (recordId: string, bookName: string) => void;
}
const PAGE_SIZE = 12;
export const WrongView: React.FC<WrongViewProps> = ({ onOpenImportModal, onOpenDetailModal, onOpenDeleteConfirm }) => {
  const { state } = useApp();
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pages, setPages] = useState<Record<string, number>>({});
  const invalidRange = Boolean(from && to && from > to);
  const filtered = useMemo(() => state.wrong.filter(w => !invalidRange &&
    (!query.trim() || w.note.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) &&
    (!from || w.date >= from) && (!to || w.date <= to)).sort((a, b) => b.date.localeCompare(a.date)), [state.wrong, query, from, to, invalidRange]);
  const validBooks = new Set(state.books.map(b => b.id));
  const groups = [
    ...state.books.map(book => ({ id: book.id, name: book.name, subject: book.subject as string, records: filtered.filter(w => w.bookId === book.id) })),
    { id: '__unlinked', name: '原题本已删除归属', subject: '已解绑', records: filtered.filter(w => !validBooks.has(w.bookId)) },
  ].filter(g => g.records.length);
  const filter = (change: () => void) => { change(); setPages({}); setExpanded({}); };
  return <div className="space-y-4 pb-24">
    <div className="flex items-center justify-between pt-1"><div><h1 className="text-2xl font-bold text-ink-main">错题照片复盘</h1><p className="text-xs text-ink-muted mt-1">按题本收纳，检索复盘原因与思路</p></div><PotatoSprite pose={3} size={64} /></div>
    <div className="flex items-center justify-between gap-2"><span className="text-xs text-ink-muted">已归档照片 ({state.wrong.length} 张)</span><Button size="sm" onClick={onOpenImportModal}><Camera size={14} />从相册上传错题</Button></div>
    <Card className="p-3 space-y-3">
      <label className="flex items-center gap-2"><Search size={16} className="shrink-0 text-sage" /><input aria-label="搜索复盘原因和思路" type="search" value={query} onChange={e => filter(() => setQuery(e.target.value))} placeholder="搜索复盘原因和思路" className="w-full min-w-0 bg-transparent text-sm py-1 outline-none" /></label>
      <div className="grid grid-cols-2 gap-2"><label className="text-xs text-ink-muted min-w-0">开始日期<input aria-label="错题开始日期" type="date" value={from} onChange={e => filter(() => setFrom(e.target.value))} className="mt-1 w-full min-w-0 border border-line rounded-lg p-1.5 bg-paper" /></label><label className="text-xs text-ink-muted min-w-0">结束日期<input aria-label="错题结束日期" type="date" value={to} onChange={e => filter(() => setTo(e.target.value))} className="mt-1 w-full min-w-0 border border-line rounded-lg p-1.5 bg-paper" /></label></div>
      {invalidRange && <p role="alert" className="text-xs text-alarm">开始日期不能晚于结束日期。</p>}
      <div className="text-xs text-ink-muted flex justify-between"><span>匹配 {filtered.length} 条记录</span>{(query || from || to) && <button className="text-sage" onClick={() => filter(() => { setQuery(''); setFrom(''); setTo(''); })}>清除筛选</button>}</div>
    </Card>
    {!groups.length && <Card className="text-center py-10 text-sm text-ink-muted">{state.wrong.length ? '没有匹配的复盘笔记，请调整关键词或日期。' : '暂无错题照片，上传后按题本收纳。'}</Card>}
    {groups.map(group => {
      const open = expanded[group.id] ?? Boolean(query.trim());
      const visible = (pages[group.id] ?? 1) * PAGE_SIZE;
      return <section key={group.id} className="space-y-3">
        <button aria-expanded={open} onClick={() => setExpanded(prev => ({ ...prev, [group.id]: !open }))} className="w-full flex items-center gap-2 text-left border-b border-line py-2">
          <BookOpen size={16} className="text-sage shrink-0" /><span className="flex-1 min-w-0 text-sm font-bold break-words">{group.name}</span><span className="text-xs text-ink-muted shrink-0">{group.records.length}条</span>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {open && <><Tag variant="gray">{group.subject}</Tag><div className="grid grid-cols-2 gap-3">
          {group.records.slice(0, visible).map(record => <Card key={record.id} className="p-2.5 min-w-0 overflow-hidden">
            <button aria-label="查看错题大图" onClick={() => onOpenDetailModal(record)} className="w-full aspect-[4/3] rounded-xl bg-cream/70 overflow-hidden flex items-center justify-center">{record.image ? <img loading="lazy" decoding="async" src={record.image} alt="错题缩略图" className="w-full h-full object-cover" /> : <ImageIcon size={28} className="text-sage/40" />}</button>
            <p className="text-[11px] text-ink-muted mt-2">{record.date}</p><p className="text-xs line-clamp-2 min-h-9 mt-1 break-words">{record.note || '未填写复盘笔记'}</p>
            <div className="flex justify-between items-center border-t border-line mt-2 pt-2"><button className="text-xs text-sage inline-flex items-center gap-1" onClick={() => onOpenDetailModal(record)}><Eye size={13} />查看详情</button><button title="删除错题照片" aria-label="删除错题照片" className="p-1 text-ink-muted" onClick={() => onOpenDeleteConfirm(record.id, group.name)}><Trash2 size={14} /></button></div>
          </Card>)}
        </div>{visible < group.records.length && <Button variant="light" fullWidth size="sm" onClick={() => setPages(prev => ({ ...prev, [group.id]: (prev[group.id] ?? 1) + 1 }))}>再显示 {Math.min(PAGE_SIZE, group.records.length - visible)} 条</Button>}</>}
      </section>;
    })}
  </div>;
};
