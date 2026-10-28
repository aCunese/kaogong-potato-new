import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mail, Plus, RefreshCw, X, Clock3, Check, ChevronRight, ChevronDown, WifiOff } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Button, ConfirmModal, Modal } from '../common/UIComponents';
import type { AccountEmailStatus, EmailReminder, EmailReminderStatus } from '../../types/email';

interface EmailRemindersModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast?: (message: string) => void;
}
const labels: Record<EmailReminderStatus, string> = {
  pending: '待发送', retry: '等待重试', sending: '发送中', sent: '已提交邮件服务器', failed: '发送失败',
  unknown: '发送结果未知', cancelled: '已取消', missed: '已错过', needs_review: '恢复后待确认',
};
const inputClass = 'w-full min-w-0 rounded-xl border border-line bg-paper px-3 py-3 text-base text-ink-main placeholder:text-ink-muted/60 focus:border-sage focus:outline-none focus:ring-2 focus:ring-sage/10 disabled:opacity-50';
const historicalStates: EmailReminderStatus[] = ['sent', 'cancelled'];
const actionableStates: EmailReminderStatus[] = ['unknown', 'needs_review', 'failed', 'missed'];
const HISTORY_PAGE_SIZE = 20;
type FieldName = 'email' | 'code' | 'title' | 'body' | 'sendAt';
type HistoryFilter = 'all' | 'sent' | 'cancelled';

function timezoneLabel(zone: string, instant = new Date()): string {
  const cities: Record<string, string> = {
    'Asia/Tokyo': '日本时间', 'Asia/Shanghai': '北京时间', 'Asia/Chongqing': '北京时间',
    'Asia/Hong_Kong': '香港时间', 'Asia/Taipei': '台北时间', 'Asia/Singapore': '新加坡时间',
    'Asia/Seoul': '首尔时间', 'Europe/London': '伦敦时间', 'Europe/Paris': '巴黎时间',
    'Europe/Berlin': '柏林时间', 'America/New_York': '纽约时间', 'America/Los_Angeles': '洛杉矶时间',
    'America/Chicago': '芝加哥时间', 'Australia/Sydney': '悉尼时间', 'Pacific/Auckland': '奥克兰时间',
    UTC: '协调世界时', 'Etc/UTC': '协调世界时',
  };
  try {
    const offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(instant).find(part => part.type === 'timeZoneName')?.value ?? 'GMT';
    const displayOffset = offset === 'GMT' ? 'UTC+00:00' : offset.replace('GMT', 'UTC');
    const city = cities[zone] ?? `${zone.split('/').at(-1)?.replace(/_/g, ' ') || zone}时间`;
    return `${city} · ${displayOffset}`;
  } catch { return '当前设备时间'; }
}
function reminderTime(iso: string, zone: string): { day: string; time: string; full: string } {
  const instant = new Date(iso);
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  const currentYear = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, year: 'numeric' }).formatToParts(new Date()).find(item => item.type === 'year')?.value;
  const day = `${part('year') === currentYear ? '' : `${part('year')}年`}${part('month')}月${part('day')}日`;
  return { day, time: `${part('hour')}:${part('minute')}`, full: `${day}${Number(part('hour'))}点${part('minute')}分` };
}
/** Calendar day of a reminder in its own timezone, used for history grouping. */
function reminderDateKey(iso: string, zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch { return iso.slice(0, 10); }
}
function localDateInput(instant: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}T${pad(instant.getHours())}:${pad(instant.getMinutes())}`;
}
function freshDate(): string { return localDateInput(new Date(Date.now() + 3_600_000)); }

/** Compact reminder row: two lines plus one-line body preview; tap to expand the full content. */
const ReminderItem: React.FC<{
  reminder: EmailReminder;
  busy: boolean;
  online: boolean;
  available: boolean;
  activeCount: number;
  onEdit: () => void;
  onCancel: () => void;
  onResend: () => void;
}> = ({ reminder, busy, online, available, activeCount, onEdit, onCancel, onResend }) => {
  const [expanded, setExpanded] = useState(false);
  const planned = reminderTime(reminder.sendAt, reminder.timezone);
  const attention = actionableStates.includes(reminder.status);
  const editable = ['pending', 'retry'].includes(reminder.status);
  const toggle = () => setExpanded(value => !value);
  return <article className={`rounded-2xl border ${attention ? 'border-potato/40 bg-potato-light/20' : 'border-line bg-paper'}`}>
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={toggle}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } }}
      className="cursor-pointer px-3.5 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <time dateTime={reminder.sendAt} className="flex items-baseline gap-1.5">
          <span className="text-xs font-medium text-ink-main">{planned.day}</span>
          <span className="text-base font-semibold tabular-nums text-ink-main">{planned.time}</span>
        </time>
        <span className="flex shrink-0 items-center gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[10px] leading-tight ${attention ? 'bg-potato-light text-potato-dark' : reminder.status === 'sent' ? 'bg-sage-light text-sage-dark' : 'bg-cream text-ink-muted'}`}>{labels[reminder.status]}</span>
          <ChevronDown size={13} className={`text-ink-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <h5 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-main">{reminder.title}</h5>
        <div className="flex shrink-0 items-center gap-0.5" onClick={event => event.stopPropagation()}>
          {editable && <>
            <button type="button" aria-label="编辑提醒" disabled={busy || !online || !available} onClick={onEdit} className="inline-flex min-h-8 items-center rounded-lg px-2 text-[11px] text-sage-dark active:bg-black/5 disabled:opacity-50">编辑</button>
            <button type="button" aria-label="取消提醒" disabled={busy || !online} onClick={onCancel} className="inline-flex min-h-8 items-center rounded-lg px-2 text-[11px] text-ink-muted active:bg-black/5 disabled:opacity-50">取消</button>
          </>}
          {attention && <button type="button" aria-label="重新安排" disabled={busy || !online || !available || activeCount >= 50} onClick={onResend} className="inline-flex min-h-8 items-center rounded-lg px-2 text-[11px] text-sage-dark active:bg-black/5 disabled:opacity-50">重新安排</button>}
        </div>
      </div>
      {reminder.body && <p className={`mt-0.5 text-[11px] leading-relaxed text-ink-muted ${expanded ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>{reminder.body}</p>}
      {expanded && <div className="mt-2 space-y-2 border-t border-line/60 pt-2 text-xs text-ink-muted" onClick={event => event.stopPropagation()}>
        <p>{timezoneLabel(reminder.timezone, new Date(reminder.sendAt))}{reminder.delayed && reminder.status === 'sent' ? ' · 延后发送' : ''}</p>
        {reminder.status === 'retry' && <p>暂未发出，稍后会自动重试。</p>}
        {attention && <div className="rounded-xl bg-paper/70 px-3 py-2 leading-relaxed text-ink-main">
          <p>{reminder.status === 'unknown' ? '邮件可能已收到，请先检查收件箱。' : reminder.status === 'needs_review' ? '这条提醒需要你确认新的发送时间。' : reminder.status === 'failed' ? '这次提醒未能发出，可以重新安排。' : '已错过发送时间，可以重新安排。'}</p>
          <details className="mt-1 text-ink-muted"><summary className="min-h-8 cursor-pointer py-1.5">{reminder.status === 'unknown' ? '为什么没有自动重发？' : '查看说明'}</summary><p>{reminder.status === 'unknown' ? '发送结果暂时无法确认。为避免重复提醒，系统不会自动重发；重新安排前，请确认是否已经收到邮件。' : reminder.status === 'needs_review' ? '数据恢复后，原来的提醒不会自动发送。核对内容并重新选择时间后，才能再次提醒。' : reminder.status === 'failed' ? '请确认收件邮箱可以正常收信，再选择新的提醒时间。' : '为避免收到过期提醒，超过计划时间 24 小时的任务不会补发。'}</p></details>
        </div>}
        {reminder.status === 'sent' && <details className="text-ink-muted"><summary className="min-h-8 cursor-pointer py-1.5">还没有收到邮件？</summary><p className="leading-relaxed">邮件已提交邮件服务器，实际到达取决于邮箱服务；请稍后查看，也可以检查垃圾邮件。</p></details>}
        <p className="text-[10px]">点卡片可收起</p>
      </div>}
    </div>
  </article>;
};

export const EmailRemindersModal: React.FC<EmailRemindersModalProps> = ({ isOpen, onClose, onToast }) => {
  const { currentUser, csrfToken } = useApp();
  const userId = currentUser?.id ?? '';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [status, setStatus] = useState<AccountEmailStatus | null>(null);
  const [reminders, setReminders] = useState<EmailReminder[]>([]);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [expiresAt, setExpiresAt] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sendAt, setSendAt] = useState(freshDate);
  const [editing, setEditing] = useState<EmailReminder | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [editorOpen, setEditorOpen] = useState(false);
  const [emailManagerOpen, setEmailManagerOpen] = useState(false);
  const [emailEditOpen, setEmailEditOpen] = useState(false);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [historyPage, setHistoryPage] = useState(1);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const emailInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const editorSection = useRef<HTMLDivElement>(null);
  const composerDismissed = useRef(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<{ type: 'unbind' } | { type: 'resend'; reminder: EmailReminder } | null>(null);
  const pending = useRef(false);
  const dataVersion = useRef(0);
  const mounted = useRef(false);
  const requests = useRef(new Set<AbortController>());
  const scope = useRef({ key: '', epoch: 0 });
  const scopeKey = `${userId}:${csrfToken ?? ''}:${isOpen}`;
  if (scope.current.key !== scopeKey) scope.current = { key: scopeKey, epoch: scope.current.epoch + 1 };
  const epoch = scope.current.epoch;
  const current = useCallback((operationEpoch: number) => mounted.current && scope.current.epoch === operationEpoch, []);

  const api = useCallback(async <T,>(path: string, method = 'GET', payload?: unknown): Promise<T> => {
    const operationEpoch = epoch;
    if (!userId || !isOpen || (method !== 'GET' && !csrfToken)) throw new Error('请重新登录后使用学习提醒');
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      const response = await fetch(path, {
        method, credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-workspace-user': userId, ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      const result = await response.json();
      if (!current(operationEpoch)) throw new DOMException('Account changed', 'AbortError');
      if (!response.ok || !result.ok) throw new Error(typeof result.message === 'string' ? result.message : '操作失败，请稍后重试');
      return result as T;
    } finally { requests.current.delete(controller); }
  }, [userId, csrfToken, isOpen, epoch, current]);

  const refresh = useCallback(async () => {
    const operationEpoch = epoch;
    const version = dataVersion.current;
    const [binding, list] = await Promise.all([
      api<AccountEmailStatus>('/api/account/email'),
      api<{ reminders: EmailReminder[] }>('/api/reminders'),
    ]);
    if (!current(operationEpoch) || version !== dataVersion.current) return;
    setStatus(binding); setReminders(list.reminders);
  }, [api, epoch, current]);

  useEffect(() => {
    mounted.current = true;
    const operationEpoch = epoch;
    setStatus(null); setReminders([]); setEmail(''); setCode(''); setChallengeId(''); setConfirm(null);
    setExpiresAt(0); setResendAt(0); setEditorOpen(false); setEditing(null); setError(''); setNotice('');
    setTitle(''); setBody(''); setSendAt(freshDate()); setRequestId(crypto.randomUUID());
    setEmailManagerOpen(false); setEmailEditOpen(false); setTab('pending');
    setHistoryFilter('all'); setHistoryPage(1); setFieldErrors({});
    composerDismissed.current = false; pending.current = false; setBusy(false);
    if (isOpen && userId) {
      setLoading(true);
      void refresh().catch(err => {
        if (current(operationEpoch) && err?.name !== 'AbortError') setError('暂时无法读取学习提醒，请检查网络后重试');
      }).finally(() => { if (current(operationEpoch)) setLoading(false); });
    } else setLoading(false);
    const poll = isOpen && userId ? window.setInterval(() => {
      if (!pending.current) void refresh().catch(() => {});
    }, 30_000) : undefined;
    const clock = isOpen ? window.setInterval(() => { setTick(Date.now()); }, 1000) : undefined;
    return () => {
      mounted.current = false;
      requests.current.forEach(controller => controller.abort()); requests.current.clear();
      if (poll) window.clearInterval(poll);
      if (clock) window.clearInterval(clock);
    };
  }, [isOpen, userId, csrfToken, epoch, refresh, current]);

  useEffect(() => {
    const updateConnection = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => { window.removeEventListener('online', updateConnection); window.removeEventListener('offline', updateConnection); };
  }, []);

  useEffect(() => {
    if (!isOpen || !editorOpen) return;
    editorSection.current?.scrollIntoView({ block: 'nearest' });
    titleInput.current?.focus({ preventScroll: true });
  }, [isOpen, editorOpen]);

  // Bound mailbox with nothing scheduled: open the composer right away.
  useEffect(() => {
    if (!isOpen || loading || !status?.bound || emailManagerOpen) return;
    if (!editorOpen && !composerDismissed.current && reminders.length === 0) setEditorOpen(true);
  }, [isOpen, loading, status?.bound, emailManagerOpen, editorOpen, reminders.length]);

  useEffect(() => { setHistoryPage(1); }, [historyFilter, tab]);

  const clearFieldError = (field: FieldName) => setFieldErrors(items => ({ ...items, [field]: undefined }));
  const operate = async (action: () => Promise<void>) => {
    if (pending.current) return;
    const operationEpoch = epoch;
    dataVersion.current += 1;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); return { ok: true }; }
    catch (err) {
      const message = err instanceof TypeError ? '网络暂时不可用，输入内容已保留，请联网后重试。' : err instanceof Error ? err.message : '操作失败，请稍后重试';
      if (current(operationEpoch) && (err as Error)?.name !== 'AbortError') setError(message);
      return { ok: false, message };
    } finally { if (current(operationEpoch)) { pending.current = false; setBusy(false); } }
  };
  const announce = (message: string) => { setNotice(message); onToast?.(message); };
  const resetEditor = () => {
    setTitle(''); setBody(''); setSendAt(freshDate()); setEditing(null); setRequestId(crypto.randomUUID()); setEditorOpen(false); setFieldErrors({});
  };
  const dismissEditor = () => { composerDismissed.current = true; resetEditor(); };
  const requestCode = () => operate(async () => {
    if (!email.trim() || email.trim().length > 254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email.trim())) {
      setFieldErrors(items => ({ ...items, email: '请输入完整的邮箱地址，例如 name@example.com。' }));
      emailInput.current?.focus(); return;
    }
    clearFieldError('email');
    const result = await api<{ challengeId: string; expiresAt: string; resendAfter: number }>('/api/account/email/code', 'POST', { email });
    setChallengeId(result.challengeId); setCode(''); setExpiresAt(Date.parse(result.expiresAt)); setResendAt(Date.now() + result.resendAfter * 1000);
    announce('验证码已发送，请到邮箱查看。');
  });
  const verifyCode = () => operate(async () => {
    if (!/^\d{6}$/.test(code)) { setFieldErrors(items => ({ ...items, code: '请输入邮件中的 6 位数字验证码。' })); return; }
    clearFieldError('code');
    const wasUnbound = !status?.bound;
    const result = await api<AccountEmailStatus>('/api/account/email/verify', 'POST', { challengeId, code });
    setStatus(result); setEmail(''); setCode(''); setChallengeId(''); setExpiresAt(0);
    setEmailManagerOpen(false); setEmailEditOpen(false);
    composerDismissed.current = false;
    resetEditor(); setTab('pending'); setEditorOpen(true);
    announce(wasUnbound ? '邮箱已验证，写下第一条学习提醒吧。' : '邮箱已更换，后续提醒会发往新邮箱。');
  });
  const saveReminder = () => operate(async () => {
    const local = new Date(sendAt);
    const errors: Partial<Record<FieldName, string>> = {};
    if (!title.trim()) errors.title = '给这条提醒起个标题。';
    else if (title.trim().length > 100) errors.title = '标题请控制在 100 字以内。';
    if (body.length > 1000) errors.body = '正文请控制在 1000 字以内。';
    if (!sendAt) errors.sendAt = '请选择提醒的日期和时间。';
    else if (!Number.isFinite(local.getTime()) || localDateInput(local) !== sendAt) errors.sendAt = '这个时间无效，请重新选择；夏令时切换时请核对时间。';
    else if (local.getTime() <= Date.now()) errors.sendAt = '这个时间已经过去，请选择未来的时间。';
    setFieldErrors(errors);
    if (Object.keys(errors).length) { if (errors.title) titleInput.current?.focus(); return; }
    const payload = { title, body, sendAt: local.toISOString(), timezone, ...(editing ? { revision: editing.revision } : { requestId }) };
    const result = await api<{ reminder: EmailReminder }>(editing ? `/api/reminders/${encodeURIComponent(editing.id)}` : '/api/reminders', editing ? 'PATCH' : 'POST', payload);
    setReminders(items => [result.reminder, ...items.filter(item => item.id !== result.reminder.id)]);
    const savedTime = reminderTime(result.reminder.sendAt, timezone);
    resetEditor(); setTab(historicalStates.includes(result.reminder.status) ? 'history' : 'pending');
    announce(`将在${savedTime.full}提醒你（${timezoneLabel(timezone, new Date(result.reminder.sendAt))}）。`);
  });
  const cancelReminder = (reminder: EmailReminder) => operate(async () => {
    const result = await api<{ reminder: EmailReminder }>(`/api/reminders/${encodeURIComponent(reminder.id)}/cancel`, 'POST', { revision: reminder.revision });
    setReminders(items => items.map(item => item.id === result.reminder.id ? result.reminder : item));
    if (editing?.id === reminder.id) dismissEditor();
    setTab('history'); announce('提醒已取消，可在历史记录中查看。');
  });
  const editReminder = (reminder: EmailReminder) => {
    setEditing(reminder); setTitle(reminder.title); setBody(reminder.body);
    setSendAt(localDateInput(new Date(reminder.sendAt))); setEditorOpen(true); setError(''); setFieldErrors({});
  };
  const confirmAction = () => operate(async () => {
    if (confirm?.type === 'unbind') {
      const result = await api<AccountEmailStatus>('/api/account/email', 'DELETE');
      setStatus(result); setChallengeId(''); setCode(''); setEmail(''); resetEditor(); setConfirm(null);
      setEmailManagerOpen(false); setEmailEditOpen(false);
      setReminders(items => items.map(item => ['pending', 'retry'].includes(item.status) ? { ...item, status: 'cancelled' as const, revision: item.revision + 1 } : item));
      announce('已解绑邮箱，待发送提醒已取消');
      void refresh().catch(() => {});
    } else if (confirm?.type === 'resend') {
      const reminder = confirm.reminder;
      setEditing(null); setTitle(reminder.title); setBody(reminder.body); setSendAt(freshDate());
      setRequestId(crypto.randomUUID()); setEditorOpen(true); setConfirm(null); setTab('pending'); setFieldErrors({});
      announce('请核对新的发送时间后保存，原提醒保持原状态');
    }
  });
  const remaining = Math.max(0, Math.ceil((resendAt - tick) / 1000));
  const activeCount = reminders.filter(item => ['pending', 'retry', 'sending'].includes(item.status)).length;
  const waiting = reminders.filter(item => !historicalStates.includes(item.status)).sort((a, b) => Date.parse(a.sendAt) - Date.parse(b.sendAt));
  const history = reminders.filter(item => historicalStates.includes(item.status)).sort((a, b) => Date.parse(b.sendAt) - Date.parse(a.sendAt) || b.id.localeCompare(a.id));
  const historyCounts = { all: history.length, sent: history.filter(item => item.status === 'sent').length, cancelled: history.filter(item => item.status === 'cancelled').length };
  const historyFiltered = historyFilter === 'all' ? history : history.filter(item => item.status === historyFilter);
  const visibleHistory = historyFiltered.slice(0, historyPage * HISTORY_PAGE_SIZE);
  const historyGroups: [string, EmailReminder[]][] = [];
  const historyGroupIndex = new Map<string, number>();
  visibleHistory.forEach(reminder => {
    const key = reminderDateKey(reminder.sendAt, reminder.timezone);
    const index = historyGroupIndex.get(key);
    if (index === undefined) { historyGroupIndex.set(key, historyGroups.length); historyGroups.push([key, [reminder]]); }
    else historyGroups[index][1].push(reminder);
  });
  const needsAttention = waiting.filter(item => actionableStates.includes(item.status)).length;
  const deviceTimeLabel = timezoneLabel(timezone, Number.isFinite(Date.parse(sendAt)) ? new Date(sendAt) : new Date());

  const startNewReminder = () => {
    if (!online) { setError('当前离线，联网后就能创建新的学习提醒。'); return; }
    if (!status?.available) { setError('邮件提醒暂未启用，请联系管理员后再试。'); return; }
    if (!status.bound) { setError('请先验证收件邮箱。'); return; }
    if (activeCount >= 50) { setError('待发送提醒已满 50 条，取消部分提醒后即可继续新建。'); return; }
    composerDismissed.current = false;
    resetEditor(); setEditorOpen(true); setTab('pending'); setError(''); setNotice('');
  };
  const openEmailManager = () => {
    setEmailManagerOpen(true); setEmailEditOpen(false);
    setEmail(''); setCode(''); setChallengeId('');
    setFieldErrors(items => ({ ...items, email: undefined, code: undefined }));
  };
  const closeEmailManager = () => {
    setEmailManagerOpen(false); setEmailEditOpen(false);
    setEmail(''); setCode(''); setChallengeId('');
    setFieldErrors(items => ({ ...items, email: undefined, code: undefined }));
  };
  const openEmailEdit = () => { setEmailEditOpen(true); setEmail(''); setCode(''); setChallengeId(''); };
  const closeEmailEdit = () => {
    setEmailEditOpen(false); setEmail(''); setCode(''); setChallengeId('');
    setFieldErrors(items => ({ ...items, email: undefined, code: undefined }));
  };

  const bindForm = (changing: boolean) => <div className="space-y-3">
    {changing && <p className="text-xs leading-relaxed text-ink-muted">新邮箱验证成功后，后续提醒会发往新地址。</p>}
    <label className="block space-y-1.5"><span className="text-xs font-medium text-ink-main">{changing ? '新邮箱地址' : '邮箱地址'}</span>
      <input ref={emailInput} aria-label={changing ? '新邮箱地址' : '邮箱地址'} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'learning-email-error' : undefined} type="email" autoComplete="email" maxLength={254} className={inputClass} value={email} disabled={busy} placeholder="输入你常用的邮箱" onChange={event => { setEmail(event.target.value); setChallengeId(''); setCode(''); clearFieldError('email'); clearFieldError('code'); }} />
    </label>
    {fieldErrors.email && <p id="learning-email-error" role="alert" className="text-xs text-alarm">{fieldErrors.email}</p>}
    <Button fullWidth variant={challengeId ? 'secondary' : 'light'} disabled={busy || !online || remaining > 0} onClick={requestCode}>{remaining > 0 ? `${remaining} 秒后重新发送` : challengeId ? '重新发送验证码' : '发送验证码'}</Button>
    {challengeId && <div className="space-y-3 border-t border-line pt-3">
      <label className="block space-y-1.5"><span className="text-xs font-medium text-ink-main">6 位验证码</span>
        <input aria-label="6 位验证码" aria-invalid={Boolean(fieldErrors.code)} aria-describedby="learning-code-help" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={`${inputClass} tracking-[0.3em]`} value={code} disabled={busy} placeholder="输入邮件中的验证码" onChange={event => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); clearFieldError('code'); }} />
      </label>
      <p id="learning-code-help" className={`text-xs ${fieldErrors.code || expiresAt <= tick ? 'text-alarm' : 'text-ink-muted'}`}>{fieldErrors.code || (expiresAt > tick ? '请到邮箱查看，验证码 10 分钟内有效。' : '验证码已过期，请重新发送。')}</p>
      <Button variant="primary" fullWidth disabled={busy || !online || expiresAt <= tick} onClick={verifyCode}>{busy ? '验证中…' : '验证并绑定'}</Button>
    </div>}
    {changing && <Button variant="ghost" fullWidth disabled={busy} onClick={closeEmailEdit}>取消更换</Button>}
  </div>;

  // Quick "when" choices so a reminder is two taps + confirm.
  const nowMs = Date.now();
  const oneHourLater = new Date(nowMs + 3_600_000); oneHourLater.setSeconds(0, 0);
  const tonight = new Date(); tonight.setHours(20, 0, 0, 0);
  const tomorrowMorning = new Date(); tomorrowMorning.setDate(tomorrowMorning.getDate() + 1); tomorrowMorning.setHours(8, 0, 0, 0);
  const timePresets = [
    { label: '1 小时后', value: localDateInput(oneHourLater) },
    ...(tonight.getTime() > nowMs ? [{ label: '今晚 20:00', value: localDateInput(tonight) }] : []),
    { label: '明早 08:00', value: localDateInput(tomorrowMorning) },
  ];

  const reminderCard = (reminder: EmailReminder) => <ReminderItem
    key={reminder.id}
    reminder={reminder}
    busy={busy}
    online={online}
    available={Boolean(status?.available)}
    activeCount={activeCount}
    onEdit={() => editReminder(reminder)}
    onCancel={() => cancelReminder(reminder)}
    onResend={() => setConfirm({ type: 'resend', reminder })}
  />;

  return <>
    <Modal isOpen={isOpen} onClose={onClose} title="学习提醒" closeDisabled={busy}>
      <div className="space-y-4 text-sm">
        {!userId ? <div className="rounded-2xl bg-cream p-5 text-center text-ink-muted"><Mail className="mx-auto mb-3 text-sage" size={26} /><p>登录后，即可把学习计划设为邮件提醒。</p></div> : <>
          {loading && <p className="py-3 text-center text-ink-muted" role="status">正在读取学习提醒…</p>}
          {!online && <div className="flex gap-2 rounded-xl bg-potato-light/60 p-3 text-xs leading-relaxed text-ink-main"><WifiOff size={16} className="mt-0.5 shrink-0" /><p>当前离线，已保存的提醒不受本机离线影响。联网后可继续操作。</p></div>}
          {error && <div role="alert" className="rounded-xl border border-alarm/20 bg-alarm-light p-3 text-xs leading-relaxed text-alarm"><p>{error}</p><Button variant="ghost" size="sm" disabled={busy || !online} onClick={() => operate(refresh)} className="mt-1 !px-0"><RefreshCw size={13} />重新读取</Button></div>}
          {notice && <div role="status" className="flex gap-2 rounded-xl bg-sage-light/60 p-3 text-xs leading-relaxed text-sage-dark"><Check size={16} className="mt-0.5 shrink-0" /><p>{notice}</p></div>}
          {status && !status.available && <div className="rounded-xl border border-line bg-cream p-3 text-xs leading-relaxed text-ink-muted">邮件服务尚未启用，请联系管理员。启用后就能验证邮箱并创建提醒。</div>}

          {status && !status.bound && <section className="space-y-3 rounded-2xl border border-line bg-cream/50 p-4" aria-label="绑定收件邮箱">
            <div className="flex items-start gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sage-light text-sage-dark"><Mail size={18} /></span>
              <div className="min-w-0 flex-1">
                <h4 className="font-semibold text-ink-main">先绑定收件邮箱</h4>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">验证一次即可，之后每条提醒都会发到这个邮箱。</p>
              </div>
            </div>
            {status.available ? bindForm(false) : <p className="text-xs leading-relaxed text-ink-muted">邮件服务未启用，暂时无法绑定邮箱。</p>}
          </section>}

          {status?.bound && <>
            {/* 邮箱 chip 直接点开「邮箱管理」；新建提醒与 chip 同一行，省掉一整行大按钮 */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="邮箱管理"
                aria-expanded={emailManagerOpen}
                onClick={openEmailManager}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-line bg-cream/70 px-3 py-1.5 text-left active:bg-cream"
              >
                <Mail size={13} className="shrink-0 text-sage-dark" />
                <span className="truncate text-xs font-medium text-ink-main">{status.maskedEmail}</span>
                <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-sage-dark"><Check size={11} />已验证</span>
                <ChevronRight size={13} className="ml-auto shrink-0 text-ink-muted" />
              </button>
              {!editorOpen && <Button variant="primary" size="sm" disabled={busy || loading || !status.available} onClick={startNewReminder} className="shrink-0"><Plus size={14} />新建提醒</Button>}
            </div>

            {editorOpen ? (
              <div ref={editorSection} className="space-y-4 rounded-2xl border border-sage/30 bg-cream/50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold text-ink-main">{editing ? '编辑提醒' : '写一条学习提醒'}</h4>
                  <Button variant="ghost" size="sm" disabled={busy} aria-label="收起提醒表单" onClick={dismissEditor} className="!px-2"><X size={16} /></Button>
                </div>
                <label className="block space-y-1.5"><span className="text-xs font-medium text-ink-main">提醒标题</span><input ref={titleInput} aria-label="提醒标题" aria-invalid={Boolean(fieldErrors.title)} aria-describedby={fieldErrors.title ? 'learning-title-error' : undefined} value={title} maxLength={100} disabled={busy} onChange={event => { setTitle(event.target.value); clearFieldError('title'); if (!editing) setRequestId(crypto.randomUUID()); }} className={inputClass} placeholder="例如：完成今天的申论练习" />{fieldErrors.title && <span id="learning-title-error" role="alert" className="block text-xs text-alarm">{fieldErrors.title}</span>}</label>
                <label className="block space-y-1.5"><span className="flex justify-between gap-2 text-xs"><span className="font-medium text-ink-main">补充内容 <span className="font-normal text-ink-muted">选填</span></span><span className="text-ink-muted">{body.length}/1000</span></span><textarea aria-label="提醒正文" aria-invalid={Boolean(fieldErrors.body)} value={body} maxLength={1000} rows={3} disabled={busy} onChange={event => { setBody(event.target.value); clearFieldError('body'); if (!editing) setRequestId(crypto.randomUUID()); }} className={`${inputClass} resize-y`} placeholder="写下要做的事，收到邮件时更容易开始。" />{fieldErrors.body && <span role="alert" className="block text-xs text-alarm">{fieldErrors.body}</span>}</label>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-ink-main">什么时候提醒你</span>
                  <div className="flex flex-wrap gap-1.5 pb-1">
                    {timePresets.map(preset => <button
                      key={preset.label}
                      type="button"
                      aria-label={`提醒时间设为${preset.label}`}
                      aria-pressed={sendAt === preset.value}
                      disabled={busy}
                      onClick={() => { setSendAt(preset.value); clearFieldError('sendAt'); if (!editing) setRequestId(crypto.randomUUID()); }}
                      className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${sendAt === preset.value ? 'border-sage bg-sage-light text-sage-dark' : 'border-line bg-paper text-ink-muted'}`}
                    >{preset.label}</button>)}
                  </div>
                  <input aria-label="提醒发送时间" aria-invalid={Boolean(fieldErrors.sendAt)} aria-describedby="learning-time-help" type="datetime-local" value={sendAt} min={localDateInput(new Date())} disabled={busy} onChange={event => { setSendAt(event.target.value); clearFieldError('sendAt'); if (!editing) setRequestId(crypto.randomUUID()); }} className={`${inputClass} max-w-full`} />
                  <p id="learning-time-help" className={`text-xs leading-relaxed ${fieldErrors.sendAt ? 'text-alarm' : 'text-ink-muted'}`}>{fieldErrors.sendAt || `按${deviceTimeLabel}设置，到点发送到 ${status.maskedEmail}。`}</p>
                </div>
                <Button variant="primary" fullWidth disabled={busy || !online || !status.available} onClick={saveReminder} className="!h-12 !rounded-xl">{busy ? '保存中…' : editing ? '保存修改' : '保存提醒'}</Button>
                <p className="text-center text-[11px] leading-relaxed text-ink-muted">每条提醒只发一次，关闭 App 也会照常发送。</p>
              </div>
            ) : <>
              <section className="space-y-3" aria-label="提醒列表">
                <div role="tablist" aria-label="学习提醒记录" className="flex rounded-xl bg-cream p-1">
                  <button id="learning-reminders-pending-tab" type="button" role="tab" aria-selected={tab === 'pending'} aria-controls="learning-reminders-list" onClick={() => setTab('pending')} className={`flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium transition-colors ${tab === 'pending' ? 'bg-paper text-sage-dark shadow-sm' : 'text-ink-muted'}`}>待发送<span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tab === 'pending' ? 'bg-sage-light' : 'bg-paper/60'}`}>{waiting.length}</span></button>
                  <button id="learning-reminders-history-tab" type="button" role="tab" aria-selected={tab === 'history'} aria-controls="learning-reminders-list" onClick={() => setTab('history')} className={`flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium transition-colors ${tab === 'history' ? 'bg-paper text-sage-dark shadow-sm' : 'text-ink-muted'}`}>历史记录<span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tab === 'history' ? 'bg-sage-light' : 'bg-paper/60'}`}>{history.length}</span></button>
                </div>

                {tab === 'pending' ? <div id="learning-reminders-list" role="tabpanel" aria-labelledby="learning-reminders-pending-tab" className="space-y-3">
                  {needsAttention > 0 && <p className="text-xs text-alarm">有 {needsAttention} 条提醒需要你确认或重新安排。</p>}
                  {!waiting.length && <div className="rounded-2xl border border-dashed border-line bg-cream/35 px-4 py-7 text-center">
                    <Clock3 size={26} className="mx-auto mb-3 text-sage" />
                    <p className="font-medium text-ink-main">没有待发送的提醒</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{history.length ? '已发出和已取消的提醒都在历史记录里。' : '把想做的事记下来，到点让邮件提醒你。'}</p>
                    {history.length > 0 && <Button size="sm" variant="ghost" onClick={() => setTab('history')} className="mt-2 text-sage-dark">查看历史记录<ChevronRight size={13} /></Button>}
                  </div>}
                  {waiting.map(reminderCard)}
                </div> : <div id="learning-reminders-list" role="tabpanel" aria-labelledby="learning-reminders-history-tab" className="space-y-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {([['all', `全部 ${historyCounts.all}`], ['sent', `已发送 ${historyCounts.sent}`], ['cancelled', `已取消 ${historyCounts.cancelled}`]] as const).map(([value, label]) => <button
                      key={value}
                      type="button"
                      aria-pressed={historyFilter === value}
                      onClick={() => setHistoryFilter(value)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${historyFilter === value ? 'border-sage bg-sage-light font-medium text-sage-dark' : 'border-line bg-paper text-ink-muted'}`}
                    >{label}</button>)}
                  </div>
                  {!historyFiltered.length && <div className="rounded-2xl border border-dashed border-line bg-cream/35 px-4 py-7 text-center">
                    <Clock3 size={26} className="mx-auto mb-3 text-sage" />
                    <p className="font-medium text-ink-main">{historyFilter === 'all' ? '还没有历史记录' : historyFilter === 'sent' ? '还没有已发送的记录' : '还没有已取消的记录'}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{historyFilter === 'all' ? '发出或取消的提醒，会保存在这里。' : '切换筛选可以查看其他历史提醒。'}</p>
                  </div>}
                  {historyGroups.map(([dateKey, items]) => <div key={dateKey} className="space-y-2">
                    <div className="flex items-baseline justify-between gap-2 px-1">
                      <h4 className="text-xs font-bold text-ink-main">{reminderTime(items[0].sendAt, items[0].timezone).day}</h4>
                      <span className="text-[10px] text-ink-muted">{items.length} 条</span>
                    </div>
                    <div className="space-y-2">{items.map(reminderCard)}</div>
                  </div>)}
                  {historyFiltered.length > visibleHistory.length && <Button variant="light" fullWidth onClick={() => setHistoryPage(page => page + 1)}>加载更多历史（还有 {historyFiltered.length - visibleHistory.length} 条）</Button>}
                  {historyFiltered.length > 0 && historyFiltered.length <= visibleHistory.length && <p className="text-center text-[10px] text-ink-muted">已显示全部 {historyFiltered.length} 条</p>}
                </div>}

                <details className="border-t border-line pt-1 text-xs text-ink-muted"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2">如果提醒延后了怎么办？<ChevronDown size={13} /></summary><p className="pb-2 leading-relaxed">服务恢复后，24 小时内的提醒会补发一次；超过 24 小时则标记为已错过，你可以重新安排时间。</p></details>
              </section>
            </>}
          </>}
        </>}
      </div>
    </Modal>

    {/* 邮箱管理移到二级弹窗，主界面只保留邮箱展示 + 新建 + 列表 */}
    <Modal isOpen={emailManagerOpen} onClose={closeEmailManager} title="邮箱管理" closeDisabled={busy}>
      <div className="space-y-4 text-sm">
        <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-cream/50 p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sage-light text-sage-dark"><Mail size={17} /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink-main">{status?.maskedEmail ?? ''}</p>
            <p className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] text-sage-dark"><Check size={11} />已验证，提醒会发到这里</p>
          </div>
        </div>
        {!emailEditOpen ? <div className="space-y-2.5">
          <Button variant="secondary" fullWidth disabled={busy || !online || !status?.available} onClick={openEmailEdit}>更换邮箱</Button>
          <Button variant="ghost" fullWidth disabled={busy} onClick={() => setConfirm({ type: 'unbind' })} className="text-alarm">解绑邮箱</Button>
          <p className="text-[11px] leading-relaxed text-ink-muted">解绑会取消所有待发送提醒；正在发送的邮件可能仍会送达。</p>
        </div> : <div className="space-y-3">
          <h4 className="font-semibold text-ink-main">更换收件邮箱</h4>
          {status?.available ? bindForm(true) : <p className="text-xs leading-relaxed text-ink-muted">邮件服务未启用，暂时无法更换邮箱。</p>}
        </div>}
      </div>
    </Modal>

    <ConfirmModal isOpen={Boolean(confirm)} title={confirm?.type === 'unbind' ? '解绑收件邮箱' : '重新安排提醒'}
      message={confirm?.type === 'unbind' ? '解绑后，所有待发送和等待重试的提醒都会取消。正在发送的邮件可能仍会送达。' : confirm?.type === 'resend' && confirm.reminder.status === 'unknown' ? '这封邮件可能已经送达。重新安排会创建一条新提醒，可能造成重复收件。确认继续？' : '将创建一条新提醒，请重新核对发送时间。'}
      confirmText={confirm?.type === 'unbind' ? '确认解绑' : '继续安排'} danger={confirm?.type === 'unbind'} onConfirm={confirmAction} onCancel={() => { if (!busy) setConfirm(null); }} />
  </>;
};
