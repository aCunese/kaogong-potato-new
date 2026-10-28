import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Eye, Link2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Button, Modal } from '../common/UIComponents';
import type { CreatedSharingCode, SharedGrant, SharedStudyOverview, SharedStudyTotals, SharingCodeMetadata, SharingGrantsResponse } from '../../types/sharing';

interface SharingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast?: (message: string) => void;
}

class SharingRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const formatTime = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚无云端学习数据';
const formatNumber = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const inputClass = 'w-full min-w-0 rounded-xl border border-line bg-cream/70 px-3 py-2.5 text-sm focus:outline-none focus:border-sage';

export const SharingModal: React.FC<SharingModalProps> = props => {
  const { currentUser, csrfToken } = useApp();
  if (!props.isOpen) return null;
  if (!currentUser || !csrfToken) return (
    <Modal isOpen onClose={props.onClose} title="学习数据分享">
      <p className="text-sm text-ink-muted">请登录后使用学习数据分享。</p>
    </Modal>
  );
  // Replacing this child erases all fetched data and invalidates pending requests on an account change.
  return <SharingSession key={`${currentUser.id}:${csrfToken}`} {...props} userId={currentUser.id} csrfToken={csrfToken} />;
};

function SharingSession({ onClose, onToast, userId, csrfToken }: SharingModalProps & { userId: string; csrfToken: string }) {
  const [owned, setOwned] = useState<SharedGrant[]>([]);
  const [received, setReceived] = useState<SharedGrant[]>([]);
  const [codes, setCodes] = useState<SharingCodeMetadata[]>([]);
  const [createdCode, setCreatedCode] = useState<CreatedSharingCode | null>(null);
  const [redeemCode, setRedeemCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overview, setOverview] = useState<SharedStudyOverview | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const alive = useRef(true);
  const operationPending = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const listRequest = useRef(0);
  const viewRequest = useRef(0);
  const selectedRef = useRef(selectedId); selectedRef.current = selectedId;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      listRequest.current += 1; viewRequest.current += 1;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
    };
  }, []);

  async function api<T>(path: string, method = 'GET', body?: unknown, controller = new AbortController()): Promise<T> {
    controllers.current.add(controller);
    try {
      const response = await fetch(`/api/sharing${path}`, {
        method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-workspace-user': userId, ...(method === 'GET' ? {} : { 'x-csrf-token': csrfToken }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new SharingRequestError(response.status, payload?.message || '分享服务暂时不可用，请稍后重试');
      return payload as T;
    } finally { controllers.current.delete(controller); }
  }

  function showFailure(cause: unknown) {
    if (!alive.current || (cause instanceof Error && cause.name === 'AbortError')) return;
    if (cause instanceof SharingRequestError && [401, 403, 409].includes(cause.status)) {
      setOwned([]); setReceived([]); setCodes([]); setCreatedCode(null); setOverview(null); setSelectedId(null);
    }
    setError(cause instanceof Error ? cause.message : '网络连接失败，请重试');
  }

  async function loadList() {
    const serial = ++listRequest.current;
    setListLoading(true);
    try {
      const result = await api<SharingGrantsResponse>('/grants');
      if (!alive.current || serial !== listRequest.current) return;
      setOwned(result.owned); setReceived(result.received); setCodes(result.codes);
      setCreatedCode(previous => previous && result.codes.some(code => code.id === previous.id) ? previous : null);
      if (selectedRef.current && !result.received.some(grant => grant.id === selectedRef.current)) {
        setSelectedId(null); setOverview(null); setError('分享授权已失效，请向分享者重新获取授权');
      }
    } catch (cause) { if (serial === listRequest.current) showFailure(cause); }
    finally { if (alive.current && serial === listRequest.current) setListLoading(false); }
  }

  useEffect(() => { void loadList(); }, []);

  useEffect(() => {
    if (!createdCode) return;
    const timer = window.setTimeout(() => {
      setCodes(previous => previous.filter(code => code.id !== createdCode.id));
      setCreatedCode(null);
    }, Math.max(0, Date.parse(createdCode.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [createdCode]);

  useEffect(() => {
    const serial = ++viewRequest.current;
    setOverview(null);
    if (!selectedId) { setViewLoading(false); return; }
    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(page), pageSize: '30' });
    if (range.from) query.set('from', range.from);
    if (range.to) query.set('to', range.to);
    setViewLoading(true); setError('');
    void api<{ ok: true; overview: SharedStudyOverview }>(`/grants/${encodeURIComponent(selectedId)}/overview?${query}`, 'GET', undefined, controller)
      .then(result => { if (alive.current && serial === viewRequest.current) setOverview(result.overview); })
      .catch(cause => { if (serial === viewRequest.current) showFailure(cause); })
      .finally(() => { if (alive.current && serial === viewRequest.current) setViewLoading(false); });
    return () => { viewRequest.current += 1; controller.abort(); };
  }, [selectedId, range.from, range.to, page, refresh]);

  async function mutate(action: () => Promise<void>) {
    if (operationPending.current) return;
    operationPending.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (cause) { showFailure(cause); }
    finally { operationPending.current = false; if (alive.current) setBusy(false); }
  }

  function generate() {
    void mutate(async () => {
      const result = await api<{ ok: true; code: CreatedSharingCode }>('/codes', 'POST');
      if (!alive.current) return;
      // Invalidate a list request started before code creation.
      listRequest.current += 1;
      setCreatedCode(result.code); setCodes(previous => [result.code, ...previous]); setListLoading(false);
      onToast?.('分享码已生成，10 分钟内可使用一次');
    });
  }

  function cancelCode(id: string) {
    void mutate(async () => {
      await api(`/codes/${encodeURIComponent(id)}`, 'DELETE');
      if (!alive.current) return;
      listRequest.current += 1;
      setCodes(previous => previous.filter(code => code.id !== id));
      setCreatedCode(previous => previous?.id === id ? null : previous); setListLoading(false);
      onToast?.('分享码已取消');
    });
  }

  function redeem(event: React.FormEvent) {
    event.preventDefault();
    if (!redeemCode.trim()) { setError('请输入分享码'); return; }
    void mutate(async () => {
      const result = await api<{ ok: true; grant: SharedGrant }>('/redeem', 'POST', { code: redeemCode.trim() });
      if (!alive.current) return;
      listRequest.current += 1;
      setReceived(previous => [result.grant, ...previous.filter(grant => grant.id !== result.grant.id)]);
      setRedeemCode(''); setListLoading(false); onToast?.('已获得只读查看授权');
    });
  }

  function revoke(id: string) {
    void mutate(async () => {
      await api(`/grants/${encodeURIComponent(id)}`, 'DELETE');
      if (!alive.current) return;
      listRequest.current += 1; setOwned(previous => previous.filter(grant => grant.id !== id)); setListLoading(false);
      onToast?.('已撤销查看授权');
    });
  }

  async function copyCode() {
    if (!createdCode) return;
    try {
      await navigator.clipboard.writeText(createdCode.value);
      if (alive.current) onToast?.('分享码已复制');
    } catch { if (alive.current) setError('复制失败，请长按分享码手动复制'); }
  }

  function refreshData() {
    setError(''); void loadList(); if (selectedId) setRefresh(value => value + 1);
  }

  return (
    <Modal isOpen onClose={onClose} title={selectedId ? '好友学习数据 · 只读' : '学习数据分享'}>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs leading-5 text-ink-muted">{selectedId ? '展示分享者最近同步到云端的学习数据。' : '将一次性分享码交给已登录的朋友，即可持续查看你的学习统计。你可以随时撤销授权。'}</p>
          <Button size="sm" variant="ghost" onClick={refreshData} disabled={listLoading || viewLoading || busy} aria-label="刷新分享数据"><RefreshCw size={14} />刷新</Button>
        </div>
        {error && <p role="alert" className="rounded-xl bg-alarm-light p-3 text-xs leading-5 text-alarm">{error}</p>}
        {selectedId ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => { setSelectedId(null); setOverview(null); setError(''); }}><ArrowLeft size={14} />返回分享管理</Button>
            <form className="space-y-2" onSubmit={event => {
              event.preventDefault();
              if (fromInput && toInput && fromInput > toInput) { setError('开始日期不能晚于结束日期'); return; }
              setPage(1); setRange({ from: fromInput, to: toInput }); setRefresh(value => value + 1);
            }}>
              <div className="grid grid-cols-2 gap-2">
                <label className="min-w-0 text-xs text-ink-muted">开始日期<input type="date" aria-label="分享统计开始日期" className={`${inputClass} mt-1`} value={fromInput} onChange={event => setFromInput(event.target.value)} /></label>
                <label className="min-w-0 text-xs text-ink-muted">结束日期<input type="date" aria-label="分享统计结束日期" className={`${inputClass} mt-1`} value={toInput} onChange={event => setToInput(event.target.value)} /></label>
              </div>
              <Button type="submit" size="sm" fullWidth disabled={viewLoading}>查询日期范围</Button>
            </form>
            {viewLoading && <p role="status" className="text-sm text-ink-muted">正在读取云端学习数据…</p>}
            {overview && <SharedOverview overview={overview} onPage={setPage} />}
          </>
        ) : (
          <>
            <section className="space-y-3 rounded-2xl border border-sage/30 bg-sage-light/30 p-4" aria-label="分享我的学习数据">
              <h4 className="flex items-center gap-2 text-sm font-bold text-ink-main"><Link2 size={16} />分享我的学习数据</h4>
              <p className="text-xs leading-5 text-ink-muted">仅分享学习统计、题库与课程进度、每日学习记录。头像、账号、错题照片、笔记和未来日程不会展示。</p>
              <Button variant="primary" size="sm" onClick={generate} disabled={busy}>生成一次性分享码</Button>
              {createdCode && (
                <div className="space-y-2 rounded-xl border border-line bg-paper p-3">
                  <label className="block text-xs font-bold text-ink-main" htmlFor="generated-study-code">本次分享码（仅本次展示）</label>
                  <input id="generated-study-code" className={`${inputClass} font-mono text-xs`} readOnly value={createdCode.value} onFocus={event => event.target.select()} />
                  <p className="text-[11px] text-ink-muted">有效至 {formatTime(createdCode.expiresAt)}，使用一次后失效。</p>
                  <Button size="sm" onClick={() => void copyCode()}><Copy size={13} />复制分享码</Button>
                </div>
              )}
              {codes.length > 0 && <ul className="space-y-2">{codes.map(code => (
                <li key={code.id} className="flex items-center justify-between gap-2 text-xs text-ink-muted">
                  <span>待使用 · {new Date(code.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 到期</span>
                  <Button size="sm" variant="ghost" onClick={() => cancelCode(code.id)} disabled={busy} aria-label="取消待使用分享码"><X size={13} />取消</Button>
                </li>
              ))}</ul>}
            </section>
            <form className="space-y-2" onSubmit={redeem}>
              <label htmlFor="redeem-study-code" className="block text-sm font-bold text-ink-main">输入朋友的分享码</label>
              <input id="redeem-study-code" className={inputClass} value={redeemCode} onChange={event => setRedeemCode(event.target.value)} placeholder="粘贴一次性分享码" maxLength={128} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} />
              <Button type="submit" size="sm" fullWidth disabled={busy || !redeemCode.trim()}><Eye size={14} />获得只读查看授权</Button>
            </form>
            <section className="space-y-2" aria-label="已授权查看者">
              <h4 className="flex items-center gap-2 text-sm font-bold text-ink-main"><ShieldCheck size={16} />谁可以查看我</h4>
              {listLoading ? <p role="status" className="text-xs text-ink-muted">正在读取授权…</p> : owned.length === 0 ? <p className="text-xs text-ink-muted">尚未授权任何朋友。</p> : <ul className="divide-y divide-line">{owned.map(grant => (
                <li key={grant.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0"><p className="break-words text-sm text-ink-main">{grant.nickname}</p><p className="text-[10px] text-ink-muted">授权于 {formatTime(grant.createdAt)}</p></div>
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => revoke(grant.id)}>撤销授权</Button>
                </li>
              ))}</ul>}
            </section>
            <section className="space-y-2" aria-label="可查看的朋友">
              <h4 className="text-sm font-bold text-ink-main">朋友分享给我</h4>
              {!listLoading && received.length === 0 && <p className="text-xs text-ink-muted">输入朋友的分享码后，会显示在这里。</p>}
              <ul className="divide-y divide-line">{received.map(grant => (
                <li key={grant.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 break-words text-sm text-ink-main">{grant.nickname}</span>
                  <Button size="sm" variant="light" disabled={busy} onClick={() => { setPage(1); setRange({ from: '', to: '' }); setFromInput(''); setToInput(''); setSelectedId(grant.id); }}><Eye size={13} />只读查看</Button>
                </li>
              ))}</ul>
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

function Totals({ totals }: { totals: SharedStudyTotals }) {
  const values = [
    ['学习分钟', formatNumber(totals.minutes)], ['完成题数', formatNumber(totals.questions)],
    ['错题数', formatNumber(totals.errors)], ['正确率', totals.accuracy === null ? '暂无题量' : `${formatNumber(totals.accuracy)}%`],
    ['完成节数', formatNumber(totals.lessons)],
  ];
  return <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">{values.map(([label, value]) => <div key={label} className="rounded-xl bg-cream p-3"><dt className="text-[11px] text-ink-muted">{label}</dt><dd className="mt-1 font-mono text-base font-bold text-ink-main">{value}</dd></div>)}</dl>;
}

function SharedOverview({ overview, onPage }: { overview: SharedStudyOverview; onPage: (page: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(overview.records.total / overview.records.pageSize));
  return <div className="space-y-5" aria-label="好友只读学习概览">
    <div><h4 className="break-words font-bold text-ink-main">{overview.ownerNickname}的学习概览</h4><p className="mt-1 text-[11px] leading-5 text-ink-muted">上次云端同步：{formatTime(overview.updatedAt)}</p></div>
    <section className="space-y-2"><h5 className="text-xs font-bold text-ink-main">所选日期统计 · {overview.range.from || '最早'} 至 {overview.range.to || '至今'}</h5><Totals totals={overview.selectedTotals} /></section>
    <section className="space-y-2"><h5 className="text-xs font-bold text-ink-main">全部学习记录累计</h5><Totals totals={overview.allTimeTotals} /></section>
    {(['books', 'courses'] as const).map(type => <section key={type} className="space-y-2">
      <h5 className="text-sm font-bold text-ink-main">{type === 'books' ? '题库累计进度' : '课程累计进度'}</h5>
      <p className="text-[11px] text-ink-muted">累计资料进度不随日期筛选变化。</p>
      {overview[type].length === 0 ? <p className="text-xs text-ink-muted">暂无{type === 'books' ? '题库' : '课程'}。</p> : <ul className="space-y-3">{overview[type].map((source, index) => <li key={`${type}-${index}`} className="rounded-xl border border-line p-3">
        <div className="flex items-start justify-between gap-2 text-xs"><span className="min-w-0 break-words font-bold text-ink-main">{source.name}</span><span className="shrink-0 text-ink-muted">{source.subject}</span></div>
        <div role="progressbar" aria-label={`${source.name}累计进度`} aria-valuemin={0} aria-valuemax={source.total || 1} aria-valuenow={Math.min(source.done, source.total || 1)} className="my-2 h-1.5 overflow-hidden rounded-full bg-cream"><div className="h-full rounded-full bg-sage" style={{ width: `${source.total ? Math.min(100, source.done / source.total * 100) : 0}%` }} /></div>
        <p className="text-[11px] leading-5 text-ink-muted">{formatNumber(source.done)} / {formatNumber(source.total)} {type === 'books' ? '题' : '节'} · {formatNumber(source.minutes)} 分钟{type === 'books' ? ` · 错 ${formatNumber(source.errors)} 题` : ''}</p>
      </li>)}</ul>}
    </section>)}
    <section className="space-y-3">
      <h5 className="text-sm font-bold text-ink-main">每日学习记录 · 共 {overview.records.total} 条</h5>
      {overview.records.items.length === 0 ? <p className="text-xs text-ink-muted">所选日期暂无学习记录。</p> : <ul className="divide-y divide-line">{overview.records.items.map((record, index) => <li key={`${record.date}-${index}`} className="space-y-1 py-2.5">
        <p className="text-[11px] text-ink-muted">{record.date} · {record.type === 'book' ? '刷题' : record.type === 'course' ? '网课' : '自定义学习'} · {record.subject}</p>
        <p className="break-words text-xs font-medium text-ink-main">{record.sourceName}</p>
        <p className="text-xs text-ink-muted">{formatNumber(record.minutes)} 分钟{record.type === 'book' ? ` · ${formatNumber(record.quantity)} 题 · 错 ${formatNumber(record.errors)} 题` : record.type === 'course' ? ` · ${formatNumber(record.quantity)} 节` : ''}</p>
      </li>)}</ul>}
      {pageCount > 1 && <div className="flex items-center justify-between gap-2"><Button size="sm" disabled={overview.records.page <= 1} onClick={() => onPage(overview.records.page - 1)}>上一页</Button><span className="text-xs text-ink-muted">{overview.records.page} / {pageCount}</span><Button size="sm" disabled={overview.records.page >= pageCount} onClick={() => onPage(overview.records.page + 1)}>下一页</Button></div>}
    </section>
  </div>;
}
