import React, { useState, useMemo } from 'react';
import {
  Check,
  Plus,
  Trash2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { TodoItem } from '../../types';
import { Button, Card } from '../common/UIComponents';

type TodoNavView = 'main' | 'calendar' | 'detail';

export const TodoView: React.FC = () => {
  const { state, activeDate, addTodo, toggleTodo, deleteTodo, moveTodosToDate } = useApp();
  const [navView, setNavView] = useState<TodoNavView>('main');
  const [detailDate, setDetailDate] = useState<string>('');

  const [text, setText] = useState('');
  const [detailText, setDetailText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState('');
  const [ignoredOverdue, setIgnoredOverdue] = useState(false);

  // 月历定位（默认 activeDate 年月）
  const initialYear = Number(activeDate?.slice(0, 4)) || new Date().getFullYear();
  const initialMonth = Number(activeDate?.slice(5, 7)) || (new Date().getMonth() + 1);
  const [viewYear, setViewYear] = useState(initialYear);
  const [viewMonth, setViewMonth] = useState(initialMonth);

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

  // 选中的历史日期待办
  const detailTodos = todos.filter(t => t.date === detailDate).sort((a, b) => a.createdAt - b.createdAt);
  const detailDoneCount = detailTodos.filter(t => t.done).length;
  const detailTotalCount = detailTodos.length;

  // 有待办的日期集合
  const datesWithTodos = useMemo(() => new Set(todos.map(t => t.date)), [todos]);

  // 月历计算
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

  // --------------------------------------------------------------------------
  // 视图 2：独立按日期查找月历页
  // --------------------------------------------------------------------------
  if (navView === 'calendar') {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center justify-between pb-2 border-b border-line">
          <button
            type="button"
            onClick={() => setNavView('main')}
            className="inline-flex items-center gap-1 text-xs text-sage hover:underline font-medium"
          >
            <ChevronLeft size={16} />
            <span>返回今日待办</span>
          </button>
          <h2 className="text-sm font-bold text-ink-main">按日期查找</h2>
          <div className="w-16" />
        </div>

        <Card className="p-3 space-y-3">
          {/* 年月切换 */}
          <div className="flex items-center justify-between px-1">
            <button
              type="button"
              onClick={handleMonthPrev}
              className="p-1 rounded-lg hover:bg-black/5 text-ink-muted"
              aria-label="上个月"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-ink-main">
                {viewYear}年 {viewMonth}月
              </span>
              {(viewYear !== initialYear || viewMonth !== initialMonth) && (
                <button
                  type="button"
                  onClick={() => {
                    setViewYear(initialYear);
                    setViewMonth(initialMonth);
                  }}
                  className="text-xs text-sage hover:underline"
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
              <ChevronRight size={18} />
            </button>
          </div>

          {/* 星期表头 */}
          <div className="grid grid-cols-7 text-center text-xs text-ink-muted py-1 font-medium">
            <span>日</span>
            <span>一</span>
            <span>二</span>
            <span>三</span>
            <span>四</span>
            <span>五</span>
            <span>六</span>
          </div>

          {/* 微信风格日期网格 */}
          <div className="grid grid-cols-7 gap-y-1.5 text-center text-xs">
            {Array.from({ length: firstDayIndex }).map((_, i) => (
              <div key={`pad-${i}`} className="h-9 w-9 mx-auto" />
            ))}

            {Array.from({ length: totalDaysInMonth }).map((_, i) => {
              const dayNum = i + 1;
              const dayString = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const hasData = datesWithTodos.has(dayString);
              const isToday = dayString === activeDate;

              if (!hasData && !isToday) {
                return (
                  <div
                    key={dayString}
                    className="h-9 w-9 mx-auto flex items-center justify-center text-ink-muted/30 select-none"
                  >
                    {dayNum}
                  </div>
                );
              }

              return (
                <button
                  key={dayString}
                  type="button"
                  onClick={() => {
                    setDetailDate(dayString);
                    setNavView('detail');
                  }}
                  className={`h-9 w-9 mx-auto rounded-full flex items-center justify-center transition-all ${
                    isToday
                      ? 'bg-sage text-white font-bold shadow-sm'
                      : 'text-ink-main font-semibold hover:bg-black/5 cursor-pointer'
                  }`}
                  title={`${dayString}${isToday ? ' (今天)' : ''}${hasData ? ' (点击查看待办)' : ''}`}
                >
                  {dayNum}
                </button>
              );
            })}
          </div>
        </Card>

        <p className="text-xs text-ink-muted text-center py-2">
          💡 点击亮起有记录的日期，进入独立界面查看或补记当天待办
        </p>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // 视图 3：独立单日待办详情与补记页
  // --------------------------------------------------------------------------
  if (navView === 'detail') {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center justify-between pb-2 border-b border-line">
          <button
            type="button"
            onClick={() => setNavView('calendar')}
            className="inline-flex items-center gap-1 text-xs text-sage hover:underline font-medium"
          >
            <ChevronLeft size={16} />
            <span>返回月历</span>
          </button>
          <h2 className="text-sm font-bold text-ink-main">
            {detailDate} · 待办记录 ({detailDoneCount}/{detailTotalCount})
          </h2>
          <div className="w-16" />
        </div>

        {/* 为该历史日期补记待办表单 */}
        <form
          className="flex items-center gap-2"
          onSubmit={e => {
            e.preventDefault();
            void run(() => addTodo(detailText, detailDate), () => setDetailText(''));
          }}
        >
          <input
            value={detailText}
            onChange={e => setDetailText(e.target.value)}
            maxLength={200}
            placeholder={`为 ${detailDate} 补记一条待办...`}
            className="min-w-0 flex-1 px-3 py-2 rounded-xl border border-line bg-paper text-xs"
          />
          <Button type="submit" disabled={busy || !detailText.trim()} size="sm">
            <Plus size={14} />
            补记
          </Button>
        </form>

        {error && (
          <p role="alert" className="text-xs text-alarm">
            {error}
          </p>
        )}

        {/* 当天待办清单 */}
        <section className="space-y-2">
          {detailTodos.length === 0 ? (
            <Card className="text-xs text-ink-muted text-center py-8">
              该日暂无待办记录，可在上方补记
            </Card>
          ) : (
            <Card className="divide-y divide-line p-0 overflow-hidden">
              {detailTodos.map(todo => renderTodoItem(todo))}
            </Card>
          )}
        </section>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // 视图 1：主页面（今日聚焦）
  // --------------------------------------------------------------------------
  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">按日期记录生活与学习待办，勾选完成。待办不计入学习时长。</p>

      {/* 随手记添加待办 */}
      <form
        className="space-y-2"
        onSubmit={e => {
          e.preventDefault();
          void run(() => addTodo(text, activeDate), () => setText(''));
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

      {/* 今日聚焦卡片（标题右侧放历史月历胶囊入口） */}
      <section className="space-y-2">
        <div className="flex items-center justify-between pt-1">
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink-main">
            <span>{activeDate} · 今天</span>
            <span className="font-normal text-xs text-ink-muted">
              {todayDoneCount}/{todayTotalCount}
            </span>
          </h3>
          <button
            type="button"
            onClick={() => setNavView('calendar')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-paper border border-line text-xs font-medium text-ink-main hover:bg-black/5 active:scale-95 transition shadow-sm"
          >
            <Calendar size={13} className="text-sage" />
            <span>历史月历</span>
            <ChevronRight size={13} className="text-ink-muted" />
          </button>
        </div>

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

      {/* 逾期未完成待办智能提示条（移到今天卡片下方） */}
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
    </div>
  );
};
