import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronDown, Copy, Eye, Link2, MonitorPlay, Plus, RefreshCw, ShieldCheck, Users, X } from 'lucide-react';
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
    <Modal isOpen onClose={props.onClose} title="学习伙伴">
      <p className="text-sm text-ink-muted">请登录后添加学习伙伴。</p>
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
  const [tab, setTab] = useState<'received' | 'owned'>('received');
  const [addingPartner, setAddingPartner] = useState(false);
  const [codesExpanded, setCodesExpanded] = useState(false);
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
      setRedeemCode(''); setAddingPartner(false); setListLoading(false); onToast?.('学习伙伴已添加');
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

  const selectedNickname = overview?.ownerNickname || received.find(grant => grant.id === selectedId)?.nickname;

  return (
    <div className="[&_h3]:min-w-0 [&_h3]:flex-1 [&_h3]:break-words [&_h3]:pr-2">
    <Modal isOpen onClose={onClose} title={selectedId ? selectedNickname ? `${selectedNickname}的学情` : '伙伴学情' : '学习伙伴'}>
      <div className="min-w-0 space-y-5">
        {error && <p role="alert" className="rounded-xl bg-alarm-light p-3 text-xs leading-5 text-alarm">{error}</p>}
        {selectedId ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <Button size="sm" variant="ghost" className="-ml-2 px-2" onClick={() => { setSelectedId(null); setOverview(null); setTab('received'); setError(''); }}><ArrowLeft size={14} />返回伙伴列表</Button>
              <Button size="sm" variant="ghost" className="shrink-0" onClick={refreshData} disabled={listLoading || viewLoading || busy} aria-label="刷新伙伴学情"><RefreshCw size={14} />刷新</Button>
            </div>
            <div className="flex items-start gap-2 rounded-xl bg-sage-light/50 px-3 py-2.5">
              <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md bg-paper px-1.5 py-0.5 text-[10px] font-bold text-sage-dark"><Eye size={11} />只读</span>
              <p className="min-w-0 text-[11px] leading-5 text-ink-muted">云端最近同步：{overview ? formatTime(overview.updatedAt) : viewLoading ? '正在读取…' : '暂时无法读取'}</p>
            </div>
            <form className="space-y-2" onSubmit={event => {
              event.preventDefault();
              if (fromInput && toInput && fromInput > toInput) { setError('开始日期不能晚于结束日期'); return; }
              setPage(1); setRange({ from: fromInput, to: toInput }); setRefresh(value => value + 1);
            }}>
              <div className="grid grid-cols-2 gap-2">
                <label className="min-w-0 text-xs text-ink-muted">开始日期<input type="date" aria-label="分享统计开始日期" className={`${inputClass} mt-1 max-w-full appearance-none`} value={fromInput} onChange={event => setFromInput(event.target.value)} /></label>
                <label className="min-w-0 text-xs text-ink-muted">结束日期<input type="date" aria-label="分享统计结束日期" className={`${inputClass} mt-1 max-w-full appearance-none`} value={toInput} onChange={event => setToInput(event.target.value)} /></label>
              </div>
              <Button type="submit" size="sm" fullWidth disabled={viewLoading}>查询日期范围</Button>
            </form>
            {viewLoading && <p role="status" className="text-sm text-ink-muted">正在读取云端学习数据…</p>}
            {overview && <SharedOverview overview={overview} onPage={setPage} />}
          </>
        ) : (
          <>
            <div role="tablist" aria-label="学习伙伴授权方向" className="grid grid-cols-2 gap-1 rounded-xl bg-cream p-1">
              {([['received', '我查看的'], ['owned', '谁可以看我']] as const).map(([value, label]) => <button key={value} type="button" role="tab" id={`learning-partners-${value}-tab`} aria-controls={`learning-partners-${value}-panel`} aria-selected={tab === value} disabled={busy} onClick={() => { setTab(value); setError(''); }} className={`rounded-lg px-2 py-2.5 text-sm font-bold transition-colors ${tab === value ? 'bg-paper text-sage-dark shadow-sm' : 'text-ink-muted hover:text-ink-main'} disabled:opacity-50`}>{label}</button>)}
            </div>
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-xs leading-5 text-ink-muted">{tab === 'received' ? '输入朋友的分享码，查看对方学习进度' : '生成分享码后，收到码的朋友可查看你的学习数据'}</p>
              <Button size="sm" variant="ghost" className="shrink-0 px-2" onClick={refreshData} disabled={listLoading || busy} aria-label="刷新学习伙伴"><RefreshCw size={14} />刷新</Button>
            </div>
            {tab === 'received' ? (
              <section id="learning-partners-received-panel" role="tabpanel" aria-labelledby="learning-partners-received-tab" className="space-y-5">
                {addingPartner ? (
                  <form className="space-y-3 rounded-2xl border border-sage/25 bg-sage-light/25 p-4" onSubmit={redeem}>
                    <h4 className="text-sm font-bold text-ink-main">添加学习伙伴</h4>
                    <label htmlFor="redeem-study-code" className="block text-xs text-ink-muted">朋友的分享码</label>
                    <input id="redeem-study-code" className={`${inputClass} bg-paper`} value={redeemCode} onChange={event => setRedeemCode(event.target.value)} placeholder="粘贴一次性分享码" maxLength={128} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} autoFocus />
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" size="sm" disabled={busy} onClick={() => { setAddingPartner(false); setRedeemCode(''); setError(''); }}>取消添加</Button>
                      <Button type="submit" variant="primary" size="sm" disabled={busy || !redeemCode.trim()}>{busy ? '添加中…' : '确认添加'}</Button>
                    </div>
                  </form>
                ) : <Button variant="primary" fullWidth onClick={() => { setAddingPartner(true); setError(''); }} disabled={busy}><Plus size={16} />添加学习伙伴</Button>}
                <div aria-label="可查看的学习伙伴" className="space-y-3">
                  <h4 className="text-sm font-bold text-ink-main">伙伴列表<span className="ml-2 text-xs font-normal text-ink-muted">{listLoading ? '' : `${received.length} 位`}</span></h4>
                  {listLoading ? <p role="status" className="py-5 text-center text-xs text-ink-muted">正在读取伙伴列表…</p> : received.length === 0 ? <div className="py-6 text-center"><span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-potato-light text-potato-dark"><Users size={23} /></span><p className="text-sm font-medium text-ink-main">还没有学习伙伴</p><p className="mt-1.5 text-xs leading-5 text-ink-muted">收到朋友的分享码后，即可添加并查看学情。</p></div> : <ul className="divide-y divide-line">{received.map(grant => <li key={grant.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0"><p className="break-words text-sm font-bold text-ink-main">{grant.nickname}</p><p className="mt-1 text-[11px] text-ink-muted">已授权 · 只读</p></div>
                    <Button size="sm" variant="light" className="shrink-0" disabled={busy} onClick={() => { setPage(1); setRange({ from: '', to: '' }); setFromInput(''); setToInput(''); setSelectedId(grant.id); }}><Eye size={13} />查看学情</Button>
                  </li>)}</ul>}
                </div>
              </section>
            ) : (
              <section id="learning-partners-owned-panel" role="tabpanel" aria-labelledby="learning-partners-owned-tab" className="space-y-5">
                <div className="space-y-3">
                  <Button variant="primary" fullWidth onClick={generate} disabled={busy}><Link2 size={16} />生成分享码</Button>
                  {createdCode && <div className="space-y-2.5 rounded-2xl border border-potato/40 bg-potato-light p-4">
                    <label className="block text-xs font-bold text-ink-main" htmlFor="generated-study-code">本次分享码</label>
                    <input id="generated-study-code" className={`${inputClass} bg-paper font-mono text-xs`} readOnly value={createdCode.value} onFocus={event => event.target.select()} />
                    <p className="text-[11px] leading-5 text-ink-muted">10 分钟内可用一次，截止 {formatTime(createdCode.expiresAt)}。关闭后不再展示完整码。</p>
                    <Button size="sm" variant="secondary" onClick={() => void copyCode()}><Copy size={13} />复制分享码</Button>
                  </div>}
                  {codes.length > 0 && <div className="border-b border-line pb-2">
                    <button type="button" aria-expanded={codesExpanded} aria-controls="pending-study-codes" onClick={() => setCodesExpanded(value => !value)} className="flex w-full items-center justify-between gap-2 py-2 text-xs text-ink-muted"><span>待使用分享码 · {codes.length} 个</span><ChevronDown size={14} className={`shrink-0 transition-transform ${codesExpanded ? 'rotate-180' : ''}`} /></button>
                    {codesExpanded && <ul id="pending-study-codes" className="space-y-1">{codes.map(code => <li key={code.id} className="flex items-center justify-between gap-2 py-1 text-xs text-ink-muted"><span className="min-w-0">{formatTime(code.expiresAt)} 到期</span><Button size="sm" variant="ghost" className="shrink-0 px-2" onClick={() => cancelCode(code.id)} disabled={busy} aria-label="取消待使用分享码"><X size={13} />取消</Button></li>)}</ul>}
                  </div>}
                </div>
                <div className="space-y-3" aria-label="已授权查看者">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-ink-main"><ShieldCheck size={16} className="text-sage" />已授权查看者</h4>
                  {listLoading ? <p role="status" className="text-xs text-ink-muted">正在读取授权…</p> : owned.length === 0 ? <p className="rounded-xl bg-cream/70 px-3 py-4 text-xs leading-5 text-ink-muted">还没有朋友可以查看你的学习数据。</p> : <ul className="divide-y divide-line">{owned.map(grant => <li key={grant.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0"><p className="break-words text-sm font-bold text-ink-main">{grant.nickname}</p><p className="mt-1 text-[11px] text-ink-muted">可只读查看我的学习数据</p></div>
                    <Button size="sm" variant="danger" className="shrink-0" disabled={busy} onClick={() => revoke(grant.id)}>撤销授权</Button>
                  </li>)}</ul>}
                  <p className="text-[11px] leading-5 text-ink-muted">仅展示学习统计、资料进度和学习记录，可随时撤销授权。</p>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
    </div>
  );
}

function Totals({ totals }: { totals: SharedStudyTotals }) {
  const values = [
    ['学习分钟', formatNumber(totals.minutes)], ['完成题数', formatNumber(totals.questions)],
    ['错题数', formatNumber(totals.errors)], ['正确率', totals.accuracy === null ? '暂无题量' : `${formatNumber(totals.accuracy)}%`],
    ['完成节数', formatNumber(totals.lessons)],
  ];
  return <dl className="grid grid-cols-2 gap-x-3 gap-y-4 rounded-2xl bg-sage-light/40 p-4 sm:grid-cols-3">{values.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[11px] text-ink-muted">{label}</dt><dd className="mt-1 break-words font-mono text-lg font-bold text-ink-main">{value}</dd></div>)}</dl>;
}

function SharedOverview({ overview, onPage }: { overview: SharedStudyOverview; onPage: (page: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(overview.records.total / overview.records.pageSize));
  const hasRange = Boolean(overview.range.from || overview.range.to);
  const totalsDiffer = (['minutes', 'questions', 'errors', 'accuracy', 'lessons'] as const).some(key => overview.selectedTotals[key] !== overview.allTimeTotals[key]);
  return <div className="space-y-5" aria-label="伙伴只读学习概览">
    <section className="space-y-2.5">
      <h4 className="text-sm font-bold text-ink-main">{hasRange ? '所选日期统计' : '学习统计'}</h4>
      <p className="text-[11px] text-ink-muted">{hasRange ? `${overview.range.from || '最早'} 至 ${overview.range.to || '至今'}` : '全部学习记录'}</p>
      <Totals totals={overview.selectedTotals} />
      {hasRange && !totalsDiffer && <p className="text-[11px] leading-5 text-ink-muted">本次范围与全部学习记录的累计统计一致。</p>}
    </section>
    {hasRange && totalsDiffer && <section className="space-y-1.5 rounded-xl bg-cream/70 px-3 py-2.5">
      <h5 className="text-xs font-bold text-ink-main">累计学习统计 · 全部记录</h5>
      <p className="text-[11px] leading-6 text-ink-muted">{formatNumber(overview.allTimeTotals.minutes)} 分钟 · {formatNumber(overview.allTimeTotals.questions)} 题 · 错 {formatNumber(overview.allTimeTotals.errors)} 题 · {overview.allTimeTotals.accuracy === null ? '暂无正确率' : `正确率 ${formatNumber(overview.allTimeTotals.accuracy)}%`} · {formatNumber(overview.allTimeTotals.lessons)} 节</p>
    </section>}
    <section className="space-y-4 border-t border-line pt-4" aria-label="累计资料进度">
      <div><h4 className="text-sm font-bold text-ink-main">累计资料进度</h4><p className="mt-1 text-[11px] leading-5 text-ink-muted">题本与网课的累计进度，不随日期范围变化。</p></div>
      {(['books', 'courses'] as const).map(type => <section key={type} className="space-y-2">
      <h5 className="flex items-center gap-1.5 text-xs font-bold text-ink-main">{type === 'books' ? <BookOpen size={14} className="text-sage" /> : <MonitorPlay size={14} className="text-course-text" />}{type === 'books' ? '题本' : '网课'}<span className="font-normal text-ink-muted">{overview[type].length}</span></h5>
      {overview[type].length === 0 ? <p className="py-1 text-xs text-ink-muted">暂无{type === 'books' ? '题本' : '网课'}。</p> : <ul className="divide-y divide-line">{overview[type].map((source, index) => <li key={`${type}-${index}`} className="py-3 first:pt-1">
        <div className="flex items-start justify-between gap-2 text-xs"><span className="min-w-0 break-words font-bold text-ink-main">{source.name}</span><span className="shrink-0 text-ink-muted">{source.subject}</span></div>
        <div role="progressbar" aria-label={`${source.name}累计进度`} aria-valuemin={0} aria-valuemax={source.total || 1} aria-valuenow={Math.min(source.done, source.total || 1)} className="my-2 h-1.5 overflow-hidden rounded-full bg-cream"><div className={`h-full rounded-full ${type === 'books' ? 'bg-sage' : 'bg-course-text'}`} style={{ width: `${source.total ? Math.min(100, source.done / source.total * 100) : 0}%` }} /></div>
        <p className="text-[11px] leading-5 text-ink-muted">{formatNumber(source.done)} / {formatNumber(source.total)} {type === 'books' ? '题' : '节'} · {formatNumber(source.minutes)} 分钟{type === 'books' ? ` · 错 ${formatNumber(source.errors)} 题` : ''}</p>
      </li>)}</ul>}
      </section>)}
    </section>
    <section className="space-y-3 border-t border-line pt-4">
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
