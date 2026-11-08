import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Eye,
  HelpCircle,
  Link2,
  MessageSquarePlus,
  MonitorPlay,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { SUBJECTS } from '../../types';
import { Button, Modal } from '../common/UIComponents';
import { EditCompanionNoteModal } from './EditCompanionNoteModal';
import type {
  CreatedSharingCode,
  SharedGrant,
  SharedStudyOverview,
  SharedStudyTotals,
  SharingCodeMetadata,
  SharingGrantsResponse,
} from '../../types/sharing';

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

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDemoOverview(id: string, date: string): SharedStudyOverview {
  const isBean = id === 'demo-bean';
  return {
    ownerNickname: isBean ? '小豆子' : '阿土同学',
    updatedAt: new Date().toISOString(),
    range: { from: date, to: date },
    selectedTotals: {
      minutes: isBean ? 0 : 75,
      questions: isBean ? 0 : 80,
      errors: isBean ? 0 : 12,
      accuracy: isBean ? null : 85,
      lessons: isBean ? 0 : 2,
    },
    allTimeTotals: {
      minutes: 3620,
      questions: 2850,
      errors: 410,
      accuracy: 85.6,
      lessons: 48,
    },
    books: [
      { name: '决战行测5000题·资料分析', subject: '资料分析', total: 1000, done: 680, errors: 82, minutes: 1200 },
      { name: '决战行测5000题·言语理解', subject: '言语理解', total: 1000, done: 540, errors: 76, minutes: 980 },
      { name: '申论范文与真题精讲', subject: '申论', total: 50, done: 28, errors: 0, minutes: 850 },
    ],
    courses: [
      { name: '行测高分系统班·判断推理', subject: '判断推理', total: 32, done: 24, errors: 0, minutes: 480 },
      { name: '申论热点与大作文拔高', subject: '申论', total: 20, done: 12, errors: 0, minutes: 240 },
    ],
    records: {
      items: isBean ? [] : [
        { date, type: 'book', subject: '资料分析', sourceName: '决战行测5000题·资料分析', quantity: 50, minutes: 45, errors: 6 },
        { date, type: 'course', subject: '判断推理', sourceName: '行测高分系统班·判断推理', quantity: 2, minutes: 30, errors: 0 },
      ],
      page: 1,
      pageSize: 30,
      total: isBean ? 0 : 2,
    },
    studyDates: [date, shiftDate(date, -1), shiftDate(date, -2)],
  };
}

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
  const { activeDate } = useApp();
  const todayStr = activeDate || new Date().toISOString().slice(0, 10);

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
  const [showDemoPartners, setShowDemoPartners] = useState(false);
  const [poking, setPoking] = useState<Record<string, boolean>>({});
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});

  const [myTargetTime, setMyTargetTime] = useState<string>('14:00');
  const [showScheduleGuide, setShowScheduleGuide] = useState(false);
  const [noteTarget, setNoteTarget] = useState<{ id?: string; nickname: string } | null>(null);

  useEffect(() => {
    fetch('/api/sharing/settings', {
      headers: { 'x-workspace-user': userId },
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.targetStudyTime) setMyTargetTime(data.targetStudyTime);
      })
      .catch(() => {});
  }, [userId]);

  const handleUpdateTargetTime = async (newTime: string) => {
    setMyTargetTime(newTime);
    try {
      await fetch('/api/sharing/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-workspace-user': userId,
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ targetStudyTime: newTime }),
      });
      onToast?.(`已将每日约定学习时间设置为 ${newTime}`);
    } catch {
      onToast?.('设置更新失败，请重试');
    }
  };

  useEffect(() => {
    const hasCooldown = Object.values(cooldowns).some(c => c > 0);
    if (!hasCooldown) return;
    const timer = setInterval(() => {
      setCooldowns(prev => {
        const next: Record<string, number> = {};
        for (const [id, count] of Object.entries(prev)) {
          if (count > 1) next[id] = count - 1;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldowns]);

  const handlePoke = async (grant: SharedGrant) => {
    if (poking[grant.id]) return;
    setPoking(prev => ({ ...prev, [grant.id]: true }));
    setError('');

    try {
      if (grant.id.startsWith('demo-')) {
        // Demo simulation
        await new Promise(r => setTimeout(r, 600));
        setCooldowns(prev => ({ ...prev, [grant.id]: 1800 }));
        onToast?.(`⚡️ 已向「${grant.nickname}」发送催学提醒邮件！`);
        return;
      }

      const res = await fetch('/api/sharing/nudge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ grantId: grant.id }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || '催学提醒发送失败');
      }

      setCooldowns(prev => ({ ...prev, [grant.id]: data.cooldownSeconds || 1800 }));
      onToast?.(data.message || `⚡️ 已向「${grant.nickname}」发送催学邮件！`);
    } catch (err: any) {
      setError(err.message || '催学提醒发送失败');
      onToast?.(err.message || '催学提醒发送失败');
    } finally {
      setPoking(prev => ({ ...prev, [grant.id]: false }));
    }
  };

  // 学情查看状态
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overview, setOverview] = useState<SharedStudyOverview | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [partnerTab, setPartnerTab] = useState<'daily' | 'library' | 'all'>('daily');
  const [showCalendar, setShowCalendar] = useState(false);

  const initialYear = Number(todayStr.slice(0, 4)) || new Date().getFullYear();
  const initialMonth = Number(todayStr.slice(5, 7)) || (new Date().getMonth() + 1);
  const [calYear, setCalYear] = useState(initialYear);
  const [calMonth, setCalMonth] = useState(initialMonth);

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
    setListLoading(true); setError('');
    try {
      const result = await api<SharingGrantsResponse>('/grants');
      if (!alive.current || serial !== listRequest.current) return;
      setOwned(result.owned); setReceived(result.received); setCodes(result.codes);
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
    if (!selectedId) { setViewLoading(false); setOverview(null); return; }

    if (selectedId.startsWith('demo-')) {
      setViewLoading(false);
      setOverview(getDemoOverview(selectedId, selectedDate));
      return;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(page), pageSize: '30' });
    if (selectedDate) {
      query.set('from', selectedDate);
      query.set('to', selectedDate);
    }

    setViewLoading(true); setError('');
    void api<{ ok: true; overview: SharedStudyOverview }>(`/grants/${encodeURIComponent(selectedId)}/overview?${query}`, 'GET', undefined, controller)
      .then(result => { if (alive.current && serial === viewRequest.current) setOverview(result.overview); })
      .catch(cause => { if (serial === viewRequest.current) showFailure(cause); })
      .finally(() => { if (alive.current && serial === viewRequest.current) setViewLoading(false); });
    return () => { viewRequest.current += 1; controller.abort(); };
  }, [selectedId, selectedDate, page, refresh]);

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
  const selectedGrant = received.find(grant => grant.id === selectedId) || (
    selectedId === 'demo-atu'
      ? { id: 'demo-atu', nickname: '阿土同学', createdAt: '', liveStatus: { state: 'focusing' as const, focusTitle: '行测真题 5000 题', focusMinutes: 34 } }
      : selectedId === 'demo-bean'
      ? { id: 'demo-bean', nickname: '小豆子', createdAt: '', liveStatus: { state: 'missed' as const, scheduledTime: '14:00', overdueHours: 2, missedText: '约定 14:00 学习，已超 2 小时未学', canPoke: true } }
      : undefined
  );

  return (
    <div className="[&_h3]:min-w-0 [&_h3]:flex-1 [&_h3]:break-words [&_h3]:pr-2">
      <Modal isOpen onClose={onClose} title={selectedId ? selectedNickname ? `${selectedNickname}的学情` : '伙伴学情' : '学习伙伴'}>
        <div className="min-w-0 space-y-4">
          {error && <p role="alert" className="rounded-xl bg-alarm-light p-3 text-xs leading-5 text-alarm">{error}</p>}
          {selectedId ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <Button size="sm" variant="ghost" className="-ml-2 px-2" onClick={() => { setSelectedId(null); setOverview(null); setTab('received'); setError(''); }}><ArrowLeft size={14} />返回伙伴列表</Button>
                <Button size="sm" variant="ghost" className="shrink-0" onClick={refreshData} disabled={listLoading || viewLoading || busy} aria-label="刷新伙伴学情"><RefreshCw size={14} />刷新</Button>
              </div>

              {/* 顶部伙伴实时动态与打气/催学直达卡片 */}
              <div className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-gradient-to-r from-cream via-[#FAF7EE] to-sage-light/35 border border-line">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-[#E8EFE2] text-[#4B6240] font-bold flex items-center justify-center text-sm shrink-0 border border-[#D5E1CB] shadow-2xs">
                    🥔
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-ink-main block truncate">{selectedNickname || '学习伙伴'}</span>
                    <span className="text-[11px] text-ink-muted block truncate">
                      {selectedGrant?.liveStatus?.state === 'focusing'
                        ? `🟢 正在专注《${selectedGrant.liveStatus.focusTitle || '备考'}》`
                        : selectedGrant?.liveStatus?.state === 'missed'
                        ? `🟠 ${selectedGrant.liveStatus.missedText || '约定14:00未学'}`
                        : selectedGrant?.liveStatus?.state === 'completed'
                        ? '👏 今日任务已打卡完成'
                        : `⏰ 约定 ${selectedGrant?.liveStatus?.scheduledTime || '14:00'} 学习`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="px-2.5 py-1 text-xs text-sage font-bold flex items-center gap-1 bg-paper hover:bg-cream"
                    onClick={() => setNoteTarget({ id: selectedId, nickname: selectedNickname || '研友' })}
                  >
                    <MessageSquarePlus size={13} />
                    <span>贴便签</span>
                  </Button>
                  {selectedGrant && (
                    <Button
                      size="sm"
                      variant="primary"
                      className={`font-bold flex items-center gap-1 shadow-sm px-2.5 py-1 text-xs ${
                        selectedGrant.liveStatus?.state === 'missed'
                          ? 'bg-amber-500 hover:bg-amber-600 border-amber-500 text-white'
                          : 'bg-sage/20 border-sage/30 text-sage hover:bg-sage/30'
                      }`}
                      disabled={busy || poking[selectedGrant.id] || (cooldowns[selectedGrant.id] ?? selectedGrant.liveStatus?.cooldownSeconds ?? 0) > 0}
                      onClick={() => handlePoke(selectedGrant)}
                      title="给对方发送催学邮件"
                    >
                      <Zap size={13} className="fill-current" />
                      <span>
                        {poking[selectedGrant.id]
                          ? '发送中…'
                          : (cooldowns[selectedGrant.id] ?? selectedGrant.liveStatus?.cooldownSeconds ?? 0) > 0
                          ? `${Math.ceil((cooldowns[selectedGrant.id] ?? selectedGrant.liveStatus?.cooldownSeconds ?? 0) / 60)}分后`
                          : selectedGrant.liveStatus?.state === 'missed'
                          ? '⚡️ 戳一下'
                          : '⚡️ 催学'}
                      </span>
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-xl bg-sage-light/50 px-3 py-2.5">
                <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md bg-paper px-1.5 py-0.5 text-[10px] font-bold text-sage-dark"><Eye size={11} />只读</span>
                <p className="min-w-0 text-[11px] leading-5 text-ink-muted">云端最近同步：{overview ? formatTime(overview.updatedAt) : viewLoading ? '正在读取…' : '暂时无法读取'}</p>
              </div>

              {/* 三标签分栏导航：彻底解决长列表下拉冗长问题 */}
              <div role="tablist" aria-label="伙伴学情分栏" className="grid grid-cols-3 gap-1 rounded-xl bg-cream p-1 text-xs font-bold">
                <button
                  type="button"
                  role="tab"
                  aria-selected={partnerTab === 'daily'}
                  onClick={() => { setPartnerTab('daily'); setError(''); }}
                  className={`rounded-lg py-2 transition-colors ${partnerTab === 'daily' ? 'bg-paper text-sage-dark shadow-sm' : 'text-ink-muted hover:text-ink-main'}`}
                >
                  当日学情
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={partnerTab === 'library'}
                  onClick={() => { setPartnerTab('library'); setError(''); }}
                  className={`rounded-lg py-2 transition-colors ${partnerTab === 'library' ? 'bg-paper text-sage-dark shadow-sm' : 'text-ink-muted hover:text-ink-main'}`}
                >
                  累计资料 {overview ? `(${overview.books.length + overview.courses.length})` : ''}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={partnerTab === 'all'}
                  onClick={() => { setPartnerTab('all'); setPage(1); setError(''); }}
                  className={`rounded-lg py-2 transition-colors ${partnerTab === 'all' ? 'bg-paper text-sage-dark shadow-sm' : 'text-ink-muted hover:text-ink-main'}`}
                >
                  全部统计
                </button>
              </div>

              {viewLoading && !overview && (
                <p role="status" className="text-sm text-ink-muted text-center py-8">正在读取云端学习数据…</p>
              )}

              {overview && (
                <SharedOverview
                  overview={overview}
                  partnerTab={partnerTab}
                  setPartnerTab={setPartnerTab}
                  selectedDate={selectedDate}
                  setSelectedDate={setSelectedDate}
                  todayStr={todayStr}
                  showCalendar={showCalendar}
                  setShowCalendar={setShowCalendar}
                  calYear={calYear}
                  setCalYear={setCalYear}
                  calMonth={calMonth}
                  setCalMonth={setCalMonth}
                  initialYear={initialYear}
                  initialMonth={initialMonth}
                  onPage={setPage}
                />
              )}
            </>
          ) : (
            <>
              <div role="tablist" aria-label="学习伙伴授权方向" className="grid grid-cols-2 gap-1 rounded-xl bg-cream p-1">
                {([['received', '我查看的'], ['owned', '谁可以看我']] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    id={`learning-partners-${value}-tab`}
                    aria-controls={`learning-partners-${value}-panel`}
                    aria-selected={tab === value}
                    disabled={busy}
                    onClick={() => { setTab(value); setError(''); }}
                    className={`rounded-lg px-2 py-2.5 text-sm font-bold transition-colors ${tab === value ? 'bg-paper text-sage-dark shadow-sm' : 'text-ink-muted hover:text-ink-main'} disabled:opacity-50`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-xs leading-5 text-ink-muted">{tab === 'received' ? '输入朋友的分享码，查看对方学习进度' : '生成分享码后，收到码的朋友可查看你的学习数据'}</p>
                <Button size="sm" variant="ghost" className="shrink-0 px-2" onClick={refreshData} disabled={listLoading || busy} aria-label="刷新学习伙伴"><RefreshCw size={14} />刷新</Button>
              </div>
              {tab === 'received' ? (
                <section id="learning-partners-received-panel" role="tabpanel" aria-labelledby="learning-partners-received-tab" className="space-y-5">
                  {/* 我的每日约定最晚学习时间设置 & 规则指南 */}
                  <div className="rounded-2xl border border-sage/25 bg-sage-light/20 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Clock size={15} className="text-sage shrink-0" />
                        <span className="text-xs font-bold text-ink-main">我的每日约定最晚开始学习时间</span>
                      </div>
                      <select
                        value={myTargetTime}
                        onChange={e => handleUpdateTargetTime(e.target.value)}
                        className="text-xs font-bold text-sage bg-paper border border-sage/30 rounded-lg px-2 py-1 outline-none cursor-pointer focus:ring-1 focus:ring-sage"
                        title="设置我的约定学习时间"
                      >
                        <option value="09:00">09:00 (早起备考)</option>
                        <option value="12:00">12:00 (中午打卡)</option>
                        <option value="14:00">14:00 (下午起步 · 推荐)</option>
                        <option value="18:00">18:00 (下班开学)</option>
                        <option value="20:00">20:00 (晚间专注)</option>
                        <option value="22:00">22:00 (深夜突击)</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-ink-muted">
                      <span>超过此时间且今日进度为 0，伙伴将能看到并「戳一戳」提醒你</span>
                      <button
                        type="button"
                        onClick={() => setShowScheduleGuide(v => !v)}
                        className="text-sage hover:underline flex items-center gap-0.5 shrink-0 ml-1 font-medium"
                      >
                        <HelpCircle size={12} />
                        <span>{showScheduleGuide ? '收起规则' : '规则说明'}</span>
                      </button>
                    </div>

                    {showScheduleGuide && (
                      <div className="mt-2 pt-2 border-t border-sage/20 text-[11px] leading-5 text-ink-muted space-y-1 bg-paper/60 p-2.5 rounded-xl">
                        <p className="font-bold text-ink-main">💡 约定时间与戳一戳机制说明：</p>
                        <p>1. <strong className="text-ink-main">约定时间怎么定义</strong>：在上方选择你每天最晚打算开学的时间（默认 14:00）。系统每日自动同步该约定。</p>
                        <p>2. <strong className="text-ink-main">怎么触发戳一戳</strong>：当天过了约定时间，如果你的学习时间仍为 0 分钟，伙伴端就会显示橙色「超时未学」状态，并激活「⚡️ 戳一下」按钮；伙伴点击后，将直接给你的提醒邮箱发送一封定制催学提醒邮件。</p>
                        <p>3. <strong className="text-ink-main">防打扰机制</strong>：每次戳一戳后有 30 分钟冷却期，避免重复轰炸；一旦你开始今日学习或打卡，状态立即更新，解除催学。</p>
                        <p>4. <strong className="text-ink-main">打气便签怎么写</strong>：在下方伙伴列表点击「💌 贴便签」，或点击伙伴卡片进入学情页贴便签，给研友送上每日鼓励！</p>
                      </div>
                    )}
                  </div>

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
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-ink-main">
                        伙伴列表
                        <span className="ml-2 text-xs font-normal text-ink-muted">
                          {listLoading ? '' : `${received.length > 0 ? received.length : showDemoPartners ? 2 : 0} 位`}
                        </span>
                      </h4>
                    </div>

                    {listLoading ? (
                      <p role="status" className="py-5 text-center text-xs text-ink-muted">正在读取伙伴列表…</p>
                    ) : (received.length === 0 && !showDemoPartners) ? (
                      <div className="py-6 text-center space-y-3">
                        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-potato-light text-potato-dark">
                          <Users size={23} />
                        </span>
                        <div>
                          <p className="text-sm font-medium text-ink-main">还没有学习伙伴</p>
                          <p className="mt-1 text-xs leading-5 text-ink-muted">收到朋友的分享码后，即可添加并查看学情。</p>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setShowDemoPartners(true)}
                          className="text-xs text-sage"
                        >
                          👀 体验学情督学（阿土 & 小豆子）
                        </Button>
                      </div>
                    ) : (
                      <ul className="divide-y divide-line">
                        {(received.length > 0 ? received : [
                          {
                            id: 'demo-atu',
                            nickname: '阿土同学',
                            createdAt: new Date().toISOString(),
                            liveStatus: {
                              state: 'focusing',
                              focusTitle: '行测真题 5000 题',
                              focusMinutes: 34,
                              canPoke: false,
                            },
                          },
                          {
                            id: 'demo-bean',
                            nickname: '小豆子',
                            createdAt: new Date().toISOString(),
                            liveStatus: {
                              state: 'missed',
                              scheduledTime: '14:00',
                              overdueHours: 2,
                              missedText: '约定 14:00 学习，已超 2 小时未学',
                              canPoke: true,
                              hasEmailBinding: true,
                            },
                          },
                        ] as SharedGrant[]).map(grant => (
                          <li key={grant.id} className="py-3.5 space-y-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="break-words text-sm font-bold text-ink-main">{grant.nickname}</span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cream text-ink-muted border border-line/60">
                                    已授权 · 只读
                                  </span>
                                </div>

                                {/* 实时学情展示：正在专注 或 约定时间未打卡 */}
                                {grant.liveStatus?.state === 'focusing' ? (
                                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200/80 rounded-xl px-2.5 py-1 w-fit font-medium">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" />
                                    <span>🟢 正在专注《{grant.liveStatus.focusTitle || '行测真题 5000 题'}》已学 {grant.liveStatus.focusMinutes ?? 34} 分钟</span>
                                  </div>
                                ) : grant.liveStatus?.state === 'missed' ? (
                                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200/80 rounded-xl px-2.5 py-1 w-fit font-medium">
                                    <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                                    <span>🟠 {grant.liveStatus.missedText || `约定 ${grant.liveStatus.scheduledTime || '14:00'} 学习，已超 ${grant.liveStatus.overdueHours || 2} 小时未学`}</span>
                                  </div>
                                ) : grant.liveStatus?.state === 'completed' ? (
                                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-sage bg-sage-light/40 border border-sage/20 rounded-xl px-2.5 py-0.5 w-fit font-medium">
                                    <span>👏 今日任务已打卡完成</span>
                                  </div>
                                ) : (
                                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-muted bg-paper border border-line/80 rounded-xl px-2.5 py-1 w-fit font-medium">
                                    <Clock size={12} className="text-ink-muted" />
                                    <span>{grant.liveStatus?.missedText || `约定 ${grant.liveStatus?.scheduledTime || '14:00'} 学习，今日尚未开始`}</span>
                                  </div>
                                )}
                              </div>

                              {/* 右侧动作按钮 */}
                              <div className="flex items-center gap-1.5 shrink-0 pt-0.5 flex-wrap justify-end">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="px-2 py-1 text-xs text-sage font-bold flex items-center gap-1 bg-paper hover:bg-cream"
                                  onClick={() => setNoteTarget({ id: grant.id, nickname: grant.nickname })}
                                  title="给伙伴贴打气便签"
                                >
                                  <MessageSquarePlus size={13} />
                                  <span>贴便签</span>
                                </Button>

                                {grant.liveStatus?.state === 'missed' ? (
                                  <Button
                                    size="sm"
                                    variant="primary"
                                    className="bg-amber-500 hover:bg-amber-600 border-amber-500 text-white font-bold flex items-center gap-1 shadow-sm px-2.5 py-1 text-xs"
                                    disabled={busy || poking[grant.id] || (cooldowns[grant.id] ?? grant.liveStatus?.cooldownSeconds ?? 0) > 0}
                                    onClick={() => handlePoke(grant)}
                                    title="给对方邮箱发送催学邮件"
                                  >
                                    <Zap size={13} className="fill-current" />
                                    <span>
                                      {poking[grant.id]
                                        ? '发送中…'
                                        : (cooldowns[grant.id] ?? grant.liveStatus?.cooldownSeconds ?? 0) > 0
                                        ? `${Math.ceil((cooldowns[grant.id] ?? grant.liveStatus?.cooldownSeconds ?? 0) / 60)}分后`
                                        : '⚡️ 戳一下'}
                                    </span>
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="px-2 py-1 text-xs text-ink-muted flex items-center gap-1 border border-line/60 bg-cream/40"
                                    onClick={() => {
                                      if (grant.liveStatus?.state === 'focusing') {
                                        onToast?.(`「${grant.nickname}」正在专注学习中，无需催学~`);
                                      } else if (grant.liveStatus?.state === 'completed') {
                                        onToast?.(`「${grant.nickname}」今日已打卡完成，太棒啦！`);
                                      } else {
                                        onToast?.(`尚未到约定时间（${grant.liveStatus?.scheduledTime || '14:00'}），到时未学方可催学~`);
                                      }
                                    }}
                                    title={grant.liveStatus?.state === 'focusing' ? '正在专注学习中' : grant.liveStatus?.state === 'completed' ? '今日打卡已完成' : `约定 ${grant.liveStatus?.scheduledTime || '14:00'} 学习`}
                                  >
                                    <Zap size={12} className="text-ink-muted" />
                                    <span>戳一戳</span>
                                  </Button>
                                )}

                                <Button
                                  size="sm"
                                  variant="light"
                                  className="shrink-0 px-2 py-1 text-xs"
                                  disabled={busy}
                                  onClick={() => {
                                    setPage(1);
                                    setSelectedDate(todayStr);
                                    setPartnerTab('daily');
                                    setShowCalendar(false);
                                    setCalYear(initialYear);
                                    setCalMonth(initialMonth);
                                    setSelectedId(grant.id);
                                  }}
                                >
                                  <Eye size={13} />学情
                                </Button>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
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
      {noteTarget && (
        <EditCompanionNoteModal
          isOpen={Boolean(noteTarget)}
          defaultRecipientId={noteTarget.id}
          defaultRecipientNickname={noteTarget.nickname}
          onClose={() => setNoteTarget(null)}
          onNoteSent={() => {
            setNoteTarget(null);
            onToast?.(`已成功为 ${noteTarget.nickname} 贴上打气便签！💌`);
            refreshData();
          }}
          onToast={onToast}
        />
      )}
    </div>
  );
}

export function calculatePartnerStreak(
  studyDates: string[] | undefined,
  todayStr: string
): { type: 'streak' | 'break' | 'none'; text: string } {
  if (!studyDates || studyDates.length === 0) {
    return { type: 'none', text: '暂无打卡' };
  }
  const dateSet = new Set(studyDates);
  const isTodayStudied = dateSet.has(todayStr);

  if (isTodayStudied) {
    let count = 1;
    let curr = shiftDate(todayStr, -1);
    while (dateSet.has(curr)) {
      count++;
      curr = shiftDate(curr, -1);
    }
    return {
      type: 'streak',
      text: count === 1 ? '打卡 1 天 🔥' : `连续打卡 ${count} 天 🔥`,
    };
  } else {
    let missed = 1;
    let curr = shiftDate(todayStr, -1);
    const earliestDate = studyDates[0];
    while (!dateSet.has(curr) && curr >= earliestDate) {
      missed++;
      curr = shiftDate(curr, -1);
    }
    return {
      type: 'break',
      text: missed === 1 ? '1天未打卡' : `连续 ${missed} 天未打卡 💤`,
    };
  }
}

function Totals({
  totals,
  streakText,
  streakType,
}: {
  totals: SharedStudyTotals;
  streakText?: string;
  streakType?: 'streak' | 'break' | 'none';
}) {
  const values = [
    ['学习分钟', formatNumber(totals.minutes)],
    ['完成题数', formatNumber(totals.questions)],
    ['错题数', formatNumber(totals.errors)],
    ['正确率', totals.accuracy === null ? '暂无题量' : `${formatNumber(totals.accuracy)}%`],
    ['完成节数', formatNumber(totals.lessons)],
  ];
  return (
    <dl className="grid grid-cols-3 gap-2 rounded-2xl bg-sage-light/45 p-3.5 border border-sage/15">
      {values.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[10px] text-ink-muted">{label}</dt>
          <dd className="mt-0.5 break-words font-mono text-base font-bold text-ink-main">{value}</dd>
        </div>
      ))}
      <div className="min-w-0">
        <dt className="text-[10px] text-ink-muted">学习状态</dt>
        <dd className={`mt-0.5 text-xs font-bold ${
          streakType === 'break' ? 'text-amber-800' : 'text-sage'
        }`}>
          {streakText || (totals.minutes > 0 || totals.questions > 0 ? '已打卡 🔥' : '未打卡')}
        </dd>
      </div>
    </dl>
  );
}

function SharedOverview({
  overview,
  partnerTab,
  setPartnerTab,
  selectedDate,
  setSelectedDate,
  todayStr,
  showCalendar,
  setShowCalendar,
  calYear,
  setCalYear,
  calMonth,
  setCalMonth,
  initialYear,
  initialMonth,
  onPage,
}: {
  overview: SharedStudyOverview;
  partnerTab: 'daily' | 'library' | 'all';
  setPartnerTab: (tab: 'daily' | 'library' | 'all') => void;
  selectedDate: string;
  setSelectedDate: React.Dispatch<React.SetStateAction<string>>;
  todayStr: string;
  showCalendar: boolean;
  setShowCalendar: React.Dispatch<React.SetStateAction<boolean>>;
  calYear: number;
  setCalYear: React.Dispatch<React.SetStateAction<number>>;
  calMonth: number;
  setCalMonth: React.Dispatch<React.SetStateAction<number>>;
  initialYear: number;
  initialMonth: number;
  onPage: (page: number) => void;
}) {
  const studyDatesSet = useMemo(() => new Set(overview.studyDates ?? []), [overview.studyDates]);
  const pageCount = Math.max(1, Math.ceil(overview.records.total / overview.records.pageSize));
  const streak = useMemo(() => calculatePartnerStreak(overview.studyDates, todayStr), [overview.studyDates, todayStr]);

  // Library subject filter state
  const [selectedSubject, setSelectedSubject] = useState<'ALL' | string>('ALL');

  // Compute available subjects for library tab
  const availableSubjects = useMemo(() => {
    const counts: Record<string, { books: number; courses: number; total: number }> = {};
    overview.books.forEach(b => {
      const sub = b.subject || '其他';
      if (!counts[sub]) counts[sub] = { books: 0, courses: 0, total: 0 };
      counts[sub].books++;
      counts[sub].total++;
    });
    overview.courses.forEach(c => {
      const sub = c.subject || '其他';
      if (!counts[sub]) counts[sub] = { books: 0, courses: 0, total: 0 };
      counts[sub].courses++;
      counts[sub].total++;
    });
    const ordered = SUBJECTS.filter(s => counts[s]);
    Object.keys(counts).forEach(s => {
      if (!ordered.includes(s as any)) ordered.push(s as any);
    });
    return ordered.map(subject => ({
      subject,
      count: counts[subject].total,
      booksCount: counts[subject].books,
      coursesCount: counts[subject].courses,
    }));
  }, [overview.books, overview.courses]);

  const totalResources = overview.books.length + overview.courses.length;

  const filteredBooks = useMemo(() => {
    if (selectedSubject === 'ALL') return overview.books;
    return overview.books.filter(b => b.subject === selectedSubject);
  }, [overview.books, selectedSubject]);

  const filteredCourses = useMemo(() => {
    if (selectedSubject === 'ALL') return overview.courses;
    return overview.courses.filter(c => c.subject === selectedSubject);
  }, [overview.courses, selectedSubject]);

  // Group historical records by date for all tab
  const dateGroups = useMemo(() => {
    const groups: {
      date: string;
      items: typeof overview.records.items;
      totalMinutes: number;
      totalQuestions: number;
      totalErrors: number;
      totalLessons: number;
    }[] = [];
    const map = new Map<string, typeof groups[0]>();

    for (const item of overview.records.items) {
      let group = map.get(item.date);
      if (!group) {
        group = {
          date: item.date,
          items: [],
          totalMinutes: 0,
          totalQuestions: 0,
          totalErrors: 0,
          totalLessons: 0,
        };
        map.set(item.date, group);
        groups.push(group);
      }
      group.items.push(item);
      group.totalMinutes += item.minutes || 0;
      if (item.type === 'book') {
        group.totalQuestions += item.quantity || 0;
        group.totalErrors += item.errors || 0;
      } else if (item.type === 'course') {
        group.totalLessons += item.quantity || 0;
      }
    }
    return groups;
  }, [overview.records.items]);

  // Expanded dates state: default expands first date
  const [expandedDates, setExpandedDates] = useState<Set<string>>(() => {
    const initial = overview.records.items[0]?.date;
    return initial ? new Set([initial]) : new Set();
  });

  useEffect(() => {
    if (expandedDates.size === 0 && overview.records.items.length > 0) {
      setExpandedDates(new Set([overview.records.items[0].date]));
    }
  }, [overview.records.items]);

  const toggleDate = (date: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  // Calendar calculations
  const firstDayIndex = new Date(calYear, calMonth - 1, 1).getDay();
  const totalDaysInMonth = new Date(calYear, calMonth, 0).getDate();
  const isViewingCurrentMonth = calYear === initialYear && calMonth === initialMonth;

  // 1. 【累计资料】分栏
  if (partnerTab === 'library') {
    return (
      <div className="space-y-3" aria-label="累计资料进度">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-ink-main">累计资料进度</h4>
            <p className="mt-0.5 text-[11px] leading-4 text-ink-muted">按科目分类收纳，题本与网课进度不随日期变化。</p>
          </div>
          <span className="text-[11px] font-mono text-ink-muted shrink-0">
            共 {overview.books.length}本 · {overview.courses.length}课
          </span>
        </div>

        {/* 科目快速筛选胶囊栏 */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
          <button
            type="button"
            onClick={() => setSelectedSubject('ALL')}
            className={`shrink-0 px-2.5 py-1 rounded-xl text-xs font-medium transition ${
              selectedSubject === 'ALL'
                ? 'bg-sage-dark text-white font-bold shadow-xs'
                : 'bg-cream/80 text-ink-muted border border-line hover:text-ink-main'
            }`}
          >
            全部 {totalResources}
          </button>
          {availableSubjects.map(({ subject, count }) => (
            <button
              key={subject}
              type="button"
              onClick={() => setSelectedSubject(subject)}
              className={`shrink-0 px-2.5 py-1 rounded-xl text-xs font-medium transition ${
                selectedSubject === subject
                  ? 'bg-sage-dark text-white font-bold shadow-xs'
                  : 'bg-cream/80 text-ink-muted border border-line hover:text-ink-main'
              }`}
            >
              {subject} {count}
            </button>
          ))}
        </div>

        {/* 紧凑卡片列表 */}
        <div className="space-y-3 pt-1">
          {/* 题本分组 */}
          {(selectedSubject === 'ALL' || filteredBooks.length > 0) && (
            <section className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold text-ink-main">
                <span className="flex items-center gap-1.5">
                  <BookOpen size={13} className="text-sage" />
                  题本进度
                </span>
                <span className="text-[10px] font-normal text-ink-muted">
                  {filteredBooks.length} 本
                </span>
              </div>
              {filteredBooks.length === 0 ? (
                <p className="py-2 text-center text-xs text-ink-muted bg-cream/40 rounded-xl border border-line/60">
                  {selectedSubject}暂无题本
                </p>
              ) : (
                <div className="space-y-1.5">
                  {filteredBooks.map((source, index) => {
                    const progressPct = source.total ? Math.min(100, Math.round((source.done / source.total) * 100)) : 0;
                    return (
                      <div key={`book-${index}`} className="p-2.5 rounded-2xl bg-cream/50 border border-line/80">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-sage-light text-sage-dark font-medium shrink-0">
                              {source.subject}
                            </span>
                            <span className="font-bold text-ink-main truncate text-xs">{source.name}</span>
                          </div>
                          <span className="font-mono text-xs font-bold text-sage-dark shrink-0">
                            {formatNumber(source.done)} / {formatNumber(source.total)} 题
                          </span>
                        </div>
                        <div
                          role="progressbar"
                          aria-label={`${source.name}累计进度`}
                          aria-valuemin={0}
                          aria-valuemax={source.total || 1}
                          aria-valuenow={Math.min(source.done, source.total || 1)}
                          className="my-1.5 h-1 overflow-hidden rounded-full bg-cream-dark/50"
                        >
                          <div
                            className="h-full rounded-full bg-sage transition-all duration-300"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-ink-muted">
                          <span>已学 {formatNumber(source.minutes)} 分钟{source.errors > 0 ? ` · 错 ${formatNumber(source.errors)} 题` : ''}</span>
                          <span>进度 {progressPct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* 网课分组 */}
          {(selectedSubject === 'ALL' || filteredCourses.length > 0) && (
            <section className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold text-ink-main">
                <span className="flex items-center gap-1.5">
                  <MonitorPlay size={13} className="text-course-text" />
                  网课进度
                </span>
                <span className="text-[10px] font-normal text-ink-muted">
                  {filteredCourses.length} 门
                </span>
              </div>
              {filteredCourses.length === 0 ? (
                <p className="py-2 text-center text-xs text-ink-muted bg-cream/40 rounded-xl border border-line/60">
                  {selectedSubject}暂无网课
                </p>
              ) : (
                <div className="space-y-1.5">
                  {filteredCourses.map((source, index) => {
                    const progressPct = source.total ? Math.min(100, Math.round((source.done / source.total) * 100)) : 0;
                    return (
                      <div key={`course-${index}`} className="p-2.5 rounded-2xl bg-cream/50 border border-line/80">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-course-bg text-course-text font-medium shrink-0">
                              {source.subject}
                            </span>
                            <span className="font-bold text-ink-main truncate text-xs">{source.name}</span>
                          </div>
                          <span className="font-mono text-xs font-bold text-course-text shrink-0">
                            {formatNumber(source.done)} / {formatNumber(source.total)} 节
                          </span>
                        </div>
                        <div
                          role="progressbar"
                          aria-label={`${source.name}累计进度`}
                          aria-valuemin={0}
                          aria-valuemax={source.total || 1}
                          aria-valuenow={Math.min(source.done, source.total || 1)}
                          className="my-1.5 h-1 overflow-hidden rounded-full bg-cream-dark/50"
                        >
                          <div
                            className="h-full rounded-full bg-course-text transition-all duration-300"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-ink-muted">
                          <span>累计听课 {formatNumber(source.minutes)} 分钟</span>
                          <span>进度 {progressPct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    );
  }

  // 2. 【全部统计】分栏
  if (partnerTab === 'all') {
    return (
      <div className="space-y-4" aria-label="全部统计与历史记录">
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-ink-main">全部学习记录统计</h4>
            <span className="text-[11px] text-ink-muted">累计打卡 {studyDatesSet.size} 天</span>
          </div>
          <Totals
            totals={overview.allTimeTotals}
            streakText={streak.text}
            streakType={streak.type}
          />
        </section>

        <section className="space-y-2.5 border-t border-line pt-3">
          <div className="flex items-center justify-between">
            <h5 className="text-xs font-bold text-ink-main">历史打卡记录 · 共 {overview.records.total} 条</h5>
            <span className="text-[10px] text-ink-muted">按日期收纳折叠</span>
          </div>
          {dateGroups.length === 0 ? (
            <p className="text-xs text-ink-muted py-4 text-center">暂无打卡记录。</p>
          ) : (
            <div className="space-y-2">
              {dateGroups.map(group => {
                const isExpanded = expandedDates.has(group.date);
                return (
                  <div key={group.date} className="rounded-2xl border border-line overflow-hidden bg-cream/40 shadow-xs">
                    <button
                      type="button"
                      onClick={() => toggleDate(group.date)}
                      aria-expanded={isExpanded}
                      className="w-full px-3 py-2 bg-cream/70 flex items-center justify-between text-left border-b border-line/60 hover:bg-cream transition"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-bold text-ink-main shrink-0">📅 {group.date}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-sage-light text-sage-dark font-medium shrink-0">
                          {group.items.length}条打卡
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-ink-muted shrink-0">
                        <span>
                          {formatNumber(group.totalMinutes)}分钟
                          {group.totalQuestions > 0 ? ` · ${formatNumber(group.totalQuestions)}题` : ''}
                          {group.totalLessons > 0 ? ` · ${formatNumber(group.totalLessons)}节` : ''}
                        </span>
                        <ChevronRight
                          size={13}
                          className={`text-ink-muted transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                        />
                      </div>
                    </button>
                    {isExpanded && (
                      <ul className="divide-y divide-line/60 p-1.5 space-y-1">
                        {group.items.map((record, rIdx) => (
                          <li key={`${group.date}-${rIdx}`} className="px-2 py-1.5 flex items-center justify-between text-xs hover:bg-cream/60 rounded-xl transition">
                            <div className="flex items-center gap-1.5 min-w-0 pr-2">
                              <span className={`text-[9px] px-1 py-0.2 rounded font-medium shrink-0 ${
                                record.type === 'book'
                                  ? 'bg-sage-light text-sage-dark'
                                  : record.type === 'course'
                                    ? 'bg-course-bg text-course-text'
                                    : 'bg-potato-light text-potato-dark'
                              }`}>
                                {record.type === 'book' ? '刷题' : record.type === 'course' ? '网课' : '其他'}
                              </span>
                              <span className="text-[10px] text-ink-muted shrink-0">[{record.subject}]</span>
                              <span className="font-medium text-ink-main truncate text-xs">{record.sourceName}</span>
                            </div>
                            <span className="text-[11px] font-mono text-ink-muted shrink-0">
                              {formatNumber(record.minutes)}分
                              {record.type === 'book' ? ` · ${formatNumber(record.quantity)}题${record.errors > 0 ? `(错${formatNumber(record.errors)})` : ''}` : ''}
                              {record.type === 'course' ? ` · ${formatNumber(record.quantity)}节` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-2 pt-2">
              <Button size="sm" disabled={overview.records.page <= 1} onClick={() => onPage(overview.records.page - 1)}>上一页</Button>
              <span className="text-xs text-ink-muted">{overview.records.page} / {pageCount}</span>
              <Button size="sm" disabled={overview.records.page >= pageCount} onClick={() => onPage(overview.records.page + 1)}>下一页</Button>
            </div>
          )}
        </section>
      </div>
    );
  }

  // 3. 【当日学情】分栏（默认展示）
  const isTodaySelected = selectedDate === todayStr;

  return (
    <div className="space-y-4" aria-label="伙伴当日学习概览">
      {/* 日期选择条（仿待办速选设计） */}
      <div className="flex items-center justify-between p-1.5 rounded-2xl bg-cream/70 border border-line">
        <button
          type="button"
          onClick={() => setSelectedDate(prev => shiftDate(prev, -1))}
          className="p-1.5 rounded-xl hover:bg-black/5 active:scale-95 text-ink-muted transition"
          aria-label="前一天"
        >
          <ChevronLeft size={16} />
        </button>

        <button
          type="button"
          onClick={() => setShowCalendar(v => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-paper border border-line text-xs font-bold text-ink-main shadow-sm hover:bg-black/5 active:scale-95 transition"
        >
          <Calendar size={13} className="text-sage" />
          <span>{selectedDate}</span>
          {isTodaySelected && <span className="text-[10px] bg-sage text-white px-1.5 py-0.2 rounded-full font-bold">今天</span>}
          <ChevronDown size={13} className={`text-ink-muted transition-transform duration-200 ${showCalendar ? 'rotate-180' : ''}`} />
        </button>

        <button
          type="button"
          disabled={selectedDate >= todayStr}
          onClick={() => setSelectedDate(prev => shiftDate(prev, 1))}
          className="p-1.5 rounded-xl hover:bg-black/5 active:scale-95 text-ink-muted disabled:opacity-25 disabled:cursor-not-allowed transition"
          aria-label="后一天"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* 仿待办月历展开面板：仅有打卡记录的日期高亮可选 */}
      {showCalendar && (
        <div className="rounded-2xl border border-sage/20 bg-paper p-3.5 space-y-3 shadow-md animate-fadeIn">
          <div className="flex items-center justify-between px-1">
            <button
              type="button"
              onClick={() => {
                if (calMonth === 1) { setCalYear(y => y - 1); setCalMonth(12); }
                else { setCalMonth(m => m - 1); }
              }}
              className="p-1 text-ink-muted hover:bg-black/5 rounded-lg transition"
              aria-label="上个月"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-ink-main">{calYear}年 {calMonth}月</span>
              {!isViewingCurrentMonth && (
                <button
                  type="button"
                  onClick={() => { setCalYear(initialYear); setCalMonth(initialMonth); }}
                  className="text-[11px] text-sage hover:underline cursor-pointer"
                >
                  回到本月
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                if (calMonth === 12) { setCalYear(y => y + 1); setCalMonth(1); }
                else { setCalMonth(m => m + 1); }
              }}
              className="p-1 text-ink-muted hover:bg-black/5 rounded-lg transition"
              aria-label="下个月"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="grid grid-cols-7 text-center text-[11px] text-ink-muted font-medium py-0.5">
            <span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>
          </div>

          <div className="grid grid-cols-7 gap-y-1.5 text-center text-xs">
            {Array.from({ length: firstDayIndex }).map((_, i) => (
              <div key={`pad-${i}`} className="h-8 w-8 mx-auto" />
            ))}
            {Array.from({ length: totalDaysInMonth }).map((_, i) => {
              const dayNum = i + 1;
              const dayString = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const hasData = studyDatesSet.has(dayString);
              const isToday = dayString === todayStr;
              const isSelected = dayString === selectedDate;
              const isClickable = hasData || isToday;

              if (!isClickable) {
                return (
                  <div
                    key={dayString}
                    className="h-8 w-8 mx-auto flex items-center justify-center text-ink-muted/25 select-none cursor-default font-normal text-xs"
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
                    setSelectedDate(dayString);
                    setShowCalendar(false);
                  }}
                  className={`h-8 w-8 mx-auto rounded-full flex flex-col items-center justify-center text-xs transition-all active:scale-95 ${
                    isSelected
                      ? 'bg-sage text-white font-bold shadow-sm'
                      : isToday
                      ? 'border border-sage/50 text-sage font-bold bg-sage/10 hover:bg-sage/20'
                      : 'text-ink-main font-bold hover:bg-sage-light cursor-pointer'
                  }`}
                  title={`${dayString}${isToday ? ' (今天)' : ''}${hasData ? ' (有学习打卡记录)' : ''}`}
                >
                  <span>{dayNum}</span>
                  {hasData && !isSelected && <span className="w-1 h-1 bg-sage rounded-full -mt-0.5" />}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-ink-muted text-center pt-1 border-t border-line">
            💡 仅亮起有学习打卡的日期可点击查看
          </p>
        </div>
      )}

      {/* 今日/所选日 核心统计指标卡片（满足第一点需求：默认展示今日数据） */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-ink-main flex items-center gap-1.5">
            <span className="w-1.5 h-3.5 bg-sage rounded-full" />
            {isTodaySelected ? '今日学情概况' : `${selectedDate} 学情概况`}
          </h4>
          <span className="text-[11px] text-sage font-medium">
            {overview.records.items.length > 0 ? `当日打卡 ${overview.records.items.length} 项` : '当日暂无打卡'}
          </span>
        </div>

        <Totals totals={overview.selectedTotals} />

        {/* 累计全部统计快捷胶囊（满足第一点需求：点击看全部统计） */}
        <button
          type="button"
          onClick={() => setPartnerTab('all')}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-cream/70 hover:bg-cream border border-line transition text-xs group text-left"
        >
          <span className="text-ink-muted text-[11px] flex items-center gap-1.5 truncate">
            <span className="font-bold text-ink-main shrink-0">累计全部统计：</span>
            <span className="truncate">
              {formatNumber(overview.allTimeTotals.minutes)} 分钟 · {formatNumber(overview.allTimeTotals.questions)} 题 · 错 {formatNumber(overview.allTimeTotals.errors)} 题
            </span>
          </span>
          <span className="inline-flex items-center text-sage font-medium text-[11px] shrink-0 group-hover:translate-x-0.5 transition ml-2">
            点击看全部
            <ArrowRight size={13} className="ml-0.5" />
          </span>
        </button>
      </section>

      {/* 当天学习打卡明细列表（满足第三点需求：清晰掌握真实情况） */}
      <section className="space-y-2.5 pt-1">
        <h5 className="text-xs font-bold text-ink-main flex items-center justify-between">
          <span>当天学习打卡明细</span>
          <span className="text-[10px] text-ink-muted font-normal">
            {overview.records.items.length > 0 ? `共 ${overview.records.items.length} 条` : ''}
          </span>
        </h5>

        {overview.records.items.length === 0 ? (
          <div className="rounded-xl border border-line bg-cream/30 py-6 text-center">
            <p className="text-xs text-ink-muted">
              {isTodaySelected ? '今天伙伴还没有学习打卡，稍后再来看看吧~' : '该日伙伴暂无学习记录。'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {overview.records.items.map((record, index) => (
              <div key={`${record.date}-${index}`} className="rounded-xl border border-line bg-paper p-3 space-y-1 shadow-sm">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-ink-main truncate">{record.sourceName}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                    record.type === 'book' ? 'bg-sage/10 text-sage' : record.type === 'course' ? 'bg-course-text/10 text-course-text' : 'bg-cream text-ink-muted'
                  }`}>
                    {record.type === 'book' ? '刷题' : record.type === 'course' ? '网课' : '自定义'} · {record.subject}
                  </span>
                </div>
                <div className="text-[11px] text-ink-muted flex items-center gap-2 flex-wrap">
                  <span>⏱ {formatNumber(record.minutes)} 分钟</span>
                  {record.type === 'book' && (
                    <>
                      <span>•</span>
                      <span>📝 {formatNumber(record.quantity)} 题 (错 {formatNumber(record.errors)} 题)</span>
                      {record.quantity > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-sage font-medium">
                            {Math.round((record.quantity - record.errors) / record.quantity * 100)}% 正确率
                          </span>
                        </>
                      )}
                    </>
                  )}
                  {record.type === 'course' && (
                    <>
                      <span>•</span>
                      <span>🎬 完成 {formatNumber(record.quantity)} 节视频</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
