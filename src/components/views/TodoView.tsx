import React, { useState, useEffect } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Button, Card } from '../common/UIComponents';

export const TodoView: React.FC = () => {
  const { state, activeDate, addTodo, toggleTodo, deleteTodo } = useApp();
  const [text, setText] = useState('');
  const [date, setDate] = useState(activeDate);
  useEffect(() => setDate(activeDate), [activeDate]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState('');
  const todos = state.todos ?? [];
  const dates = [...new Set(todos.map(t => t.date))].sort().reverse();
  const run = async (action: () => Promise<{ ok: boolean; message?: string }>, onSuccess?: () => void) => {
    if (busy) return;
    setBusy(true); setError('');
    try { const result = await action(); if (!result.ok) setError(result.message ?? '保存失败'); else onSuccess?.(); }
    catch { setError('保存失败，请重试。'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4">
    <p className="text-xs text-ink-muted">按日期记录生活与学习待办，勾选完成。待办不计入学习时长。</p>
    <form className="space-y-2" onSubmit={e => { e.preventDefault(); void run(() => addTodo(text, date), () => setText('')); }}>
      <label className="block text-xs text-ink-muted" htmlFor="todo-text">添加待办</label>
      <input id="todo-text" value={text} onChange={e => setText(e.target.value)} maxLength={200} placeholder="接下来要做什么？" className="w-full px-3 py-3 rounded-xl border border-line bg-paper text-sm" />
      <div className="flex items-center gap-2">
        <input aria-label="待办日期" type="date" value={date} onChange={e => setDate(e.target.value)} className="min-w-0 flex-1 px-3 py-2 rounded-xl border border-line bg-paper text-sm" />
        <Button type="submit" disabled={busy || !text.trim() || !date} size="sm"><Plus size={14} />添加</Button>
      </div>
    </form>
    {error && <p role="alert" className="text-xs text-alarm">{error}</p>}
    {!todos.length && <Card className="text-sm text-ink-muted text-center py-8">还没有待办，写下今天的第一件事吧</Card>}
    {dates.map(day => <section key={day} className="space-y-2">
      <h3 className="flex justify-between text-sm font-bold text-ink-main"><span>{day}{day === activeDate ? ' · 今天' : ''}</span><span className="font-normal text-ink-muted">{todos.filter(t => t.date === day && t.done).length}/{todos.filter(t => t.date === day).length}</span></h3>
      <Card className="divide-y divide-line p-0 overflow-hidden">
        {todos.filter(t => t.date === day).sort((a, b) => a.createdAt - b.createdAt).map(todo => <div key={todo.id} className="px-3 py-3">
          <div className="flex items-center gap-3">
            <button aria-label={`${todo.done ? '取消完成' : '完成'}：${todo.text}`} aria-pressed={todo.done} disabled={busy} onClick={() => void run(() => toggleTodo(todo.id))} className={`w-6 h-6 shrink-0 rounded-full border-2 flex items-center justify-center ${todo.done ? 'bg-sage border-sage text-white' : 'border-sage text-transparent'}`}><Check size={16} /></button>
            <span className={`flex-1 text-sm break-words min-w-0 ${todo.done ? 'line-through text-ink-muted' : 'text-ink-main'}`}>{todo.text}</span>
            <button aria-label={`删除待办：${todo.text}`} disabled={busy} onClick={() => setDeleting(todo.id)} className="p-2 text-ink-muted"><Trash2 size={15} /></button>
          </div>
          {deleting === todo.id && <div className="flex items-center justify-end gap-3 mt-2 text-xs"><span>删除这条待办？</span><button onClick={() => setDeleting('')}>取消</button><button disabled={busy} className="text-alarm" onClick={() => void run(() => deleteTodo(todo.id), () => setDeleting(''))}>确认删除</button></div>}
        </div>)}
      </Card>
    </section>)}
  </div>;
};
