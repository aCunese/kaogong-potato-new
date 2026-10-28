import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mail, Plus, RefreshCw, Pencil, X, Clock3 } from 'lucide-react';
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
const inputClass = 'w-full rounded-xl border border-line bg-cream px-3 py-2.5 text-sm text-ink-main focus:border-sage focus:outline-none disabled:opacity-50';
function localDateInput(instant: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}T${pad(instant.getHours())}:${pad(instant.getMinutes())}`;
}
function freshDate(): string { return localDateInput(new Date(Date.now() + 3_600_000)); }

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
    if (!userId || !isOpen || (method !== 'GET' && !csrfToken)) throw new Error('请重新登录后使用邮件提醒');
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
    pending.current = false; setBusy(false);
    if (isOpen && userId) {
      setLoading(true);
      void refresh().catch(err => {
        if (current(operationEpoch) && err?.name !== 'AbortError') setError('暂时无法读取邮件提醒，请检查网络后重试');
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

  const operate = async (action: () => Promise<void>) => {
    if (pending.current) return;
    const operationEpoch = epoch;
    dataVersion.current += 1;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); return { ok: true }; }
    catch (err) {
      const message = err instanceof Error ? err.message : '操作失败，请稍后重试';
      if (current(operationEpoch) && (err as Error)?.name !== 'AbortError') setError(message);
      return { ok: false, message };
    } finally { if (current(operationEpoch)) { pending.current = false; setBusy(false); } }
  };
  const announce = (message: string) => { setNotice(message); onToast?.(message); };
  const resetEditor = () => {
    setTitle(''); setBody(''); setSendAt(freshDate()); setEditing(null); setRequestId(crypto.randomUUID()); setEditorOpen(false);
  };
  const requestCode = () => operate(async () => {
    const result = await api<{ challengeId: string; expiresAt: string; resendAfter: number }>('/api/account/email/code', 'POST', { email });
    setChallengeId(result.challengeId); setCode(''); setExpiresAt(Date.parse(result.expiresAt)); setResendAt(Date.now() + result.resendAfter * 1000);
    announce('验证码已发送，请在 10 分钟内完成验证');
  });
  const verifyCode = () => operate(async () => {
    const result = await api<AccountEmailStatus>('/api/account/email/verify', 'POST', { challengeId, code });
    setStatus(result); setEmail(''); setCode(''); setChallengeId(''); setExpiresAt(0);
    announce('邮箱已验证，待发送提醒会使用当前绑定邮箱');
  });
  const saveReminder = () => operate(async () => {
    const local = new Date(sendAt);
    if (!sendAt || !Number.isFinite(local.getTime()) || localDateInput(local) !== sendAt || local.getTime() <= Date.now()) throw new Error('请选择有效的未来时间，夏令时切换时请核对时间');
    const payload = { title, body, sendAt: local.toISOString(), timezone, ...(editing ? { revision: editing.revision } : { requestId }) };
    const result = await api<{ reminder: EmailReminder }>(editing ? `/api/reminders/${encodeURIComponent(editing.id)}` : '/api/reminders', editing ? 'PATCH' : 'POST', payload);
    setReminders(items => [result.reminder, ...items.filter(item => item.id !== result.reminder.id)]);
    resetEditor(); announce(editing ? '提醒已更新' : '已创建一次性邮件提醒');
  });
  const cancelReminder = (reminder: EmailReminder) => operate(async () => {
    const result = await api<{ reminder: EmailReminder }>(`/api/reminders/${encodeURIComponent(reminder.id)}/cancel`, 'POST', { revision: reminder.revision });
    setReminders(items => items.map(item => item.id === result.reminder.id ? result.reminder : item));
    if (editing?.id === reminder.id) resetEditor();
    announce('提醒已取消');
  });
  const editReminder = (reminder: EmailReminder) => {
    setEditing(reminder); setTitle(reminder.title); setBody(reminder.body);
    setSendAt(localDateInput(new Date(reminder.sendAt))); setEditorOpen(true); setError('');
  };
  const confirmAction = () => operate(async () => {
    if (confirm?.type === 'unbind') {
      const result = await api<AccountEmailStatus>('/api/account/email', 'DELETE');
      setStatus(result); setChallengeId(''); setCode(''); setEmail(''); resetEditor(); setConfirm(null);
      setReminders(items => items.map(item => ['pending', 'retry'].includes(item.status) ? { ...item, status: 'cancelled' as const, revision: item.revision + 1 } : item));
      announce('已解绑邮箱，待发送提醒已取消');
      void refresh().catch(() => {});
    } else if (confirm?.type === 'resend') {
      const reminder = confirm.reminder;
      setEditing(null); setTitle(reminder.title); setBody(reminder.body); setSendAt(freshDate());
      setRequestId(crypto.randomUUID()); setEditorOpen(true); setConfirm(null);
      announce('请核对新的发送时间后保存，原提醒保持原状态');
    }
  });
  const remaining = Math.max(0, Math.ceil((resendAt - tick) / 1000));
  const activeCount = reminders.filter(item => ['pending', 'retry', 'sending'].includes(item.status)).length;

  return <>
    <Modal isOpen={isOpen} onClose={onClose} title="邮箱与定时提醒" closeDisabled={busy}>
      <div className="space-y-5 text-sm">
        {!userId ? <p className="text-ink-muted">请先登录账号，再绑定邮箱和设置提醒。</p> : <>
          {loading && <p className="text-ink-muted" role="status">正在读取邮件提醒…</p>}
          {error && <div role="alert" className="rounded-xl border border-alarm/20 bg-alarm-light p-3 text-alarm">{error}<Button variant="ghost" size="sm" disabled={busy} onClick={() => operate(refresh)}>刷新</Button></div>}
          {notice && <p role="status" className="text-sage-dark">{notice}</p>}
          {status && !status.available && <div className="rounded-xl border border-line bg-cream p-3 text-ink-muted">邮件服务尚未启用，请联系管理员。启用后即可验证邮箱并创建提醒。</div>}
          {status && <section className="space-y-3" aria-label="收件邮箱">
            <div className="flex items-center justify-between gap-2">
              <h4 className="flex items-center gap-2 font-semibold text-ink-main"><Mail size={17} />收件邮箱</h4>
              {status.bound && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm({ type: 'unbind' })}>解绑</Button>}
            </div>
            <p className="text-ink-muted">{status.bound ? `当前邮箱：${status.maskedEmail}` : '尚未绑定邮箱'}</p>
            {status.available && <>
              <p className="text-xs leading-relaxed text-ink-muted">{status.bound ? '更换邮箱需验证新地址。验证成功后，待发送提醒会发往新邮箱。' : '仅用于接收你创建的一次性提醒，验证后生效。'}</p>
              <label className="block space-y-1.5"><span className="text-xs text-ink-muted">{status.bound ? '新邮箱地址' : '邮箱地址'}</span>
                <input aria-label={status.bound ? '新邮箱地址' : '邮箱地址'} type="email" autoComplete="email" maxLength={254} className={inputClass} value={email} disabled={busy} placeholder="请输入收件邮箱" onChange={event => { setEmail(event.target.value); setChallengeId(''); setCode(''); }} />
              </label>
              <Button fullWidth size="sm" disabled={busy || !email.trim() || remaining > 0} onClick={requestCode}>{remaining > 0 ? `${remaining} 秒后可重新发送` : '发送验证码'}</Button>
              {challengeId && <div className="space-y-2">
                <label className="block space-y-1.5"><span className="text-xs text-ink-muted">6 位验证码</span>
                  <input aria-label="6 位验证码" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={inputClass} value={code} disabled={busy} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
                </label>
                <p className="text-xs text-ink-muted">{expiresAt > tick ? '验证码 10 分钟内有效，最多可尝试 5 次。' : '验证码已过期，请重新发送。'}</p>
                <Button variant="primary" fullWidth disabled={busy || code.length !== 6 || expiresAt <= tick} onClick={verifyCode}>验证并绑定</Button>
              </div>}
            </>}
          </section>}
          {status && <section className="space-y-3 border-t border-line pt-4" aria-label="一次性定时提醒">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-semibold text-ink-main">一次性定时提醒 <span className="font-normal text-xs text-ink-muted">{activeCount}/50 待发送</span></h4>
              <Button size="sm" variant="light" disabled={busy || !status.available || !status.bound || activeCount >= 50} onClick={() => { resetEditor(); setEditorOpen(true); }}><Plus size={15} />新建</Button>
            </div>
            <p className="text-xs leading-relaxed text-ink-muted">按设备时区 {timezone} 设置时间。每条提醒只发送一次；服务恢复后，24 小时内的提醒可能延后发送，超过 24 小时会标记为已错过。</p>
            {editorOpen && <div className="space-y-3 rounded-xl border border-sage/30 bg-cream p-3">
              <div className="flex items-center justify-between"><h5 className="font-medium">{editing ? '编辑提醒' : '创建提醒'}</h5><Button variant="ghost" size="sm" disabled={busy} onClick={resetEditor}><X size={15} />收起</Button></div>
              <label className="block space-y-1.5"><span className="text-xs text-ink-muted">标题（必填，最多 100 字）</span><input aria-label="提醒标题" value={title} maxLength={100} disabled={busy} onChange={event => { setTitle(event.target.value); if (!editing) setRequestId(crypto.randomUUID()); }} className={inputClass} placeholder="例如：完成今天的申论练习" /></label>
              <label className="block space-y-1.5"><span className="text-xs text-ink-muted">正文（可选，最多 1000 字）</span><textarea aria-label="提醒正文" value={body} maxLength={1000} rows={3} disabled={busy} onChange={event => { setBody(event.target.value); if (!editing) setRequestId(crypto.randomUUID()); }} className={`${inputClass} resize-y`} /></label>
              <label className="block space-y-1.5"><span className="text-xs text-ink-muted">发送时间 · {timezone}</span><input aria-label="提醒发送时间" type="datetime-local" value={sendAt} min={localDateInput(new Date())} disabled={busy} onChange={event => { setSendAt(event.target.value); if (!editing) setRequestId(crypto.randomUUID()); }} className={inputClass} /></label>
              <Button variant="primary" fullWidth disabled={busy || !title.trim() || !sendAt || !status.bound || !status.available} onClick={saveReminder}>{busy ? '保存中…' : editing ? '保存修改' : '保存一次性提醒'}</Button>
            </div>}
            {!reminders.length && <div className="rounded-xl bg-cream p-4 text-center text-ink-muted"><Clock3 size={22} className="mx-auto mb-2 text-sage" />还没有邮件提醒</div>}
            <div className="space-y-2">
              {reminders.map(reminder => <article key={reminder.id} className="rounded-xl border border-line p-3 space-y-2">
                <div className="flex items-start justify-between gap-3"><h5 className="min-w-0 break-words font-medium text-ink-main">{reminder.title}</h5><span className={`shrink-0 text-xs ${['unknown', 'failed', 'needs_review', 'missed'].includes(reminder.status) ? 'text-alarm' : 'text-ink-muted'}`}>{labels[reminder.status]}{reminder.delayed && reminder.status === 'sent' ? ' · 延后发送' : ''}</span></div>
                {reminder.body && <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-muted">{reminder.body}</p>}
                <p className="text-xs text-ink-muted">{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: reminder.timezone }).format(new Date(reminder.sendAt))} · {reminder.timezone}</p>
                {reminder.status === 'unknown' && <p className="text-xs leading-relaxed text-alarm">邮件可能已送达，系统不会自动重发。再次创建前请先查看收件箱，以免重复收到。</p>}
                {reminder.status === 'needs_review' && <p className="text-xs text-ink-muted">数据恢复前的提醒不会自动发送，请确认后重新安排。</p>}
                <div className="flex flex-wrap gap-2">
                  {['pending', 'retry'].includes(reminder.status) && <><Button variant="ghost" size="sm" disabled={busy || !status.available || !status.bound} onClick={() => editReminder(reminder)}><Pencil size={13} />编辑</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => cancelReminder(reminder)}>取消提醒</Button></>}
                  {['unknown', 'needs_review', 'failed', 'missed'].includes(reminder.status) && <Button variant="ghost" size="sm" disabled={busy || !status.available || !status.bound || activeCount >= 50} onClick={() => setConfirm({ type: 'resend', reminder })}><RefreshCw size={13} />确认后重新安排</Button>}
                </div>
              </article>)}
            </div>
          </section>}
        </>}
      </div>
    </Modal>
    <ConfirmModal isOpen={Boolean(confirm)} title={confirm?.type === 'unbind' ? '解绑收件邮箱' : '重新安排提醒'}
      message={confirm?.type === 'unbind' ? '解绑后，所有待发送和等待重试的提醒都会取消。正在发送的邮件可能仍会送达。' : confirm?.type === 'resend' && confirm.reminder.status === 'unknown' ? '这封邮件可能已经送达。重新安排会创建一条新提醒，可能造成重复收件。确认继续？' : '将创建一条新提醒，请重新核对发送时间。'}
      confirmText={confirm?.type === 'unbind' ? '确认解绑' : '继续安排'} danger={confirm?.type === 'unbind'} onConfirm={confirmAction} onCancel={() => { if (!busy) setConfirm(null); }} />
  </>;
};
