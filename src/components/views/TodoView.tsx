import React, { useState, useMemo } from 'react';
import { Check, Plus, Trash2, Calendar, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, AlertCircle, ArrowRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { TodoItem } from '../../types';
import { Button, Card } from '../common/UIComponents';

export const TodoView: React.FC = () => {
  const { state, activeDate, addTodo, toggleTodo, deleteTodo, moveTodosToDate } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState('');
  const [ignoredOverdue, setIgnoredOverdue] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  // 默认月历定位到 activeDate 所在的年月
  const initialYear = Number(activeDate?.slice(0, 4)) || new Date().getFullYear();
  const initialMonth = Number(activeDate?.slice(5, 7)) || (new Date().getMonth() + 1);
  const [viewYear, setViewYear] = useState(initialYear);
  const [viewMonth, setViewMonth] = useState(initialMonth);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const todos = state.todos ?? [];

  const run = async (action: () => Promise<{ ok: boolean; message?: string }>, onSuccess?: () => void) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await action();
      if (!result.ok) setError(result.message ?? '保存失败');
      else onSuccess?.();
    } catch {
      setError('保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  // 今日待办
  const todayTodos = todos.filter(t => t.date === activeDate).sort((a, b) => a.createdAt - b.createdAt);
  const todayDoneCount = todayTodos.filter(t => t.done).length;
  const todayTotalCount = todayTodos.length;

  // 逾期未完成待办（早于今天的未完成项）
  const overdueTodos = todos.filter(t => t.date < activeDate && !t.done).sort((a, b) => a.date.localeCompare(b.date));
  const latestOverdueDate = overdueTodos.length > 0 ? overdueTodos[overdueTodos.length - 1].date : '';

  // 统计有待办的日期集合
  const datesWithTodos = useMemo(() => new Set(todos.map(t => t.date)), [todos]);
  const recordedDaysCount = datesWithTodos.size;

  // 月历网格计算
  const firstDayIndex = new Date(viewYear, viewMonth - 1, 1).getDay();
  const totalDaysInMonth = new Date(viewYear, viewMonth, 0).getDate();

  const handleMonthPrev = () => {
    if (viewMonth === 1) {
      setViewYear(viewYear - 1);
      setViewMonth(12);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const handleMonthNext = () => {
    if (viewMonth === 12) {
      setViewYear(viewYear + 1);
      setViewMonth(1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const renderTodoItem = (todo: TodoItem) => (
    <div key={todo.id} className="px-3 py-3">
      <div className="flex items-center gap-3">
        <button
          aria-label={`${todo.done ? '取消完成' : '完成'}：${todo.text}`}
          aria-pressed={todo.done}
          disabled={busy}
          onClick={() => void run(() => toggleTodo(todo.id))}
          className={`w-6 h-6 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
            todo.done ? 'bg-sage border-sage text-white' : 'border-sage text-transparent hover:bg-sage/10'
          }`}
        >
          <Check size={16} />
        </button>
        <span className={`flex-1 text-sm break-words min-w-0 ${todo.done ? 'line-through text-ink-muted' : 'text-ink-main'}`}>
          {todo.text}
        </span>
        <button
          aria-label={`删除待办：${todo.text}`}
          disabled={busy}
          onClick={() => setDeleting(todo.id)}
          className="p-2 text-ink-muted hover:text-alarm transition-colors"
        >
          <Trash2 size={15} />
        </button>
      </div>
      {deleting === todo.id && (
        <div className="flex items-center justify-end gap-3 mt-2 text-xs">
          <span className="text-ink-muted">删除这条待办？</span>
          <button type="button" onClick={() => setDeleting('')} className="text-ink-muted hover:text-ink-main">
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            className="text-alarm font-medium hover:underline"
            onClick={() => void run(() => deleteTodo(todo.id), () => setDeleting(''))}
          >
            确认删除
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">按日期记录生活与学习待办，勾选完成。待办不计入学习时长。</p>

      {/* 随手记添加待办 */}
      <form
        className="space-y-2"
        onSubmit={e => {
          e.preventDefault();
          void run(() => addTodo(text), () => setText(''));
        }}
      >
        <label className="block text-xs text-ink-muted" htmlFor="todo-text">
          添加待办
        </label>
        <input
          id="todo-text"
          value={text}
          onChange={e => setText(e.target.value)}
          maxLength={200}
          placeholder="接下来要做什么？"
          className="w-full px-3 py-3 rounded-xl border border-line bg-paper text-sm"
        />
        <div className="flex items-center gap-2">
          <input
            aria-label="待办日期"
            type="date"
            readOnly
            value={activeDate}
            className="min-w-0 flex-1 px-3 py-2 rounded-xl border border-line bg-paper text-sm"
          />
          <Button type="submit" disabled={busy || !text.trim()} size="sm">
            <Plus size={14} />
            添加
          </Button>
        </div>
      </form>

      {error && (
        <p role="alert" className="text-xs text-alarm">
          {error}
        </p>
      )}

      {/* 逾期未完成待办智能提示条 */}
      {overdueTodos.length > 0 && !ignoredOverdue && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-900 animate-fadeIn">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle size={15} className="shrink-0 text-amber-600" />
            <span className="truncate">
              昨日（{latestOverdueDate}）有 {overdueTodos.length} 项未完成待办：
              <span className="font-semibold ml-1">{overdueTodos[0].text}</span>
              {overdueTodos.length > 1 && ` 等`}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => moveTodosToDate(overdueTodos.map(t => t.id), activeDate))}
              className="px-2 py-1 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 active:scale-95 transition flex items-center gap-1"
            >
              <span>移到今天</span>
              <ArrowRight size={12} />
            </button>
            <button
              type="button"
              onClick={() => setIgnoredOverdue(true)}
              className="px-2 py-1 rounded-lg text-ink-muted hover:text-ink-main hover:bg-black/5"
            >
              忽略
            </button>
          </div>
        </div>
      )}

      {/* 今日聚焦卡片 */}
      <section className="space-y-2">
        <h3 className="flex justify-between text-sm font-bold text-ink-main">
          <span>{activeDate} · 今天</span>
          <span className="font-normal text-ink-muted">
            {todayDoneCount}/{todayTotalCount}
          </span>
        </h3>
        {todayTodos.length === 0 ? (
          <Card className="text-sm text-ink-muted text-center py-6">
            还没有待办，写下今天的第一件事吧
          </Card>
        ) : (
          <Card className="divide-y divide-line p-0 overflow-hidden">
            {todayTodos.map(todo => renderTodoItem(todo))}
          </Card>
        )}
      </section>

      {/* 微信风格：打卡月历与历史待办（折叠面板） */}
      <section className="space-y-2 pt-1">
        <button
          type="button"
          onClick={() => setShowCalendar(prev => !prev)}
          className="w-full flex items-center justify-between p-3 rounded-xl bg-paper border border-line text-xs text-ink-main hover:bg-black/5 transition"
        >
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-sage" />
            <span className="font-medium">打卡月历与历史待办</span>
            <span className="text-ink-muted">（已记录 {recordedDaysCount} 天）</span>
          </div>
          <div className="text-ink-muted flex items-center gap-1">
            <span>{showCalendar ? '收起' : '查看'}</span>
            {showCalendar ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
        </button>

        {showCalendar && (
          <Card className="p-3 space-y-3">
            {/* 年月切换条 */}
            <div className="flex items-center justify-between px-1">
              <button
                type="button"
                onClick={handleMonthPrev}
                className="p-1 rounded-lg hover:bg-black/5 text-ink-muted"
                aria-label="上个月"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-ink-main">
                  {viewYear}年 {viewMonth}月
                </span>
                {(viewYear !== initialYear || viewMonth !== initialMonth) && (
                  <button
                    type="button"
                    onClick={() => {
                      setViewYear(initialYear);
                      setViewMonth(initialMonth);
                    }}
                    className="text-[11px] text-sage hover:underline"
                  >
                    回到本月
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={handleMonthNext}
                className="p-1 rounded-lg hover:bg-black/5 text-ink-muted"
                aria-label="下个月"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* 星期表头 */}
            <div className="grid grid-cols-7 text-center text-[11px] text-ink-muted font-medium">
              <span>日</span>
              <span>一</span>
              <span>二</span>
              <span>三</span>
              <span>四</span>
              <span>五</span>
              <span>六</span>
            </div>

            {/* 日历网格（复刻微信“按日期查找”：有记录清晰亮起，无记录浅灰暗显，今天专属绿色徽标） */}
            <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
              {Array.from({ length: firstDayIndex }).map((_, i) => (
                <div key={`pad-${i}`} className="h-8 w-8 mx-auto" />
              ))}

              {Array.from({ length: totalDaysInMonth }).map((_, i) => {
                const dayNum = i + 1;
                const dayString = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                const hasData = datesWithTodos.has(dayString);
                const isToday = dayString === activeDate;
                const isSelected = dayString === selectedDate;

                if (!hasData && !isToday) {
                  return (
                    <div
                      key={dayString}
                      className="h-8 w-8 mx-auto flex items-center justify-center text-ink-muted/30 select-none"
                    >
                      {dayNum}
                    </div>
                  );
                }

                return (
                  <button
                    key={dayString}
                    type="button"
                    onClick={() => setSelectedDate(prev => (prev === dayString ? null : dayString))}
                    className={`h-8 w-8 mx-auto rounded-full flex items-center justify-center transition-all ${
                      isToday
                        ? 'bg-sage text-white font-bold shadow-sm'
                        : isSelected
                        ? 'bg-sage/15 text-sage font-bold ring-2 ring-sage'
                        : 'text-ink-main font-semibold hover:bg-black/5 cursor-pointer'
                    }`}
                    title={`${dayString}${isToday ? ' (今天)' : ''}${hasData ? ' (有待办记录)' : ''}`}
                  >
                    {dayNum}
                  </button>
                );
              })}
            </div>

            {/* 选中某一天的待办清单 */}
            {selectedDate && (
              <div className="pt-3 border-t border-line space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-ink-main">
                  <span>
                    {selectedDate} · {selectedDate === activeDate ? '今天' : '历史待办'}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-ink-muted font-normal">
                      {todos.filter(t => t.date === selectedDate && t.done).length}/
                      {todos.filter(t => t.date === selectedDate).length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedDate(null)}
                      className="text-ink-muted hover:text-ink-main text-[11px]"
                    >
                      关闭
                    </button>
                  </div>
                </div>
                {todos.filter(t => t.date === selectedDate).length === 0 ? (
                  <p className="text-xs text-ink-muted py-2 text-center">该日无待办记录</p>
                ) : (
                  <div className="divide-y divide-line rounded-xl border border-line bg-white/40 overflow-hidden">
                    {todos
                      .filter(t => t.date === selectedDate)
                      .sort((a, b) => a.createdAt - b.createdAt)
                      .map(todo => renderTodoItem(todo))}
                  </div>
                )}
              </div>
            )}
          </Card>
        )}
      </section>
    </div>
  );
};
