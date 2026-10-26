import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Button } from '../common/UIComponents';
import { User } from '../../types';
import { Eye, EyeOff, AlertCircle, ArrowRight, Sparkles, CheckCircle2 } from 'lucide-react';

interface AuthViewProps {
  initialMode?: 'login' | 'register';
  onLoginSuccess?: (user: User) => void;
  onToast: (msg: string) => void;
  /** Optional notice (e.g. session expired) shown above the form. */
  sessionNotice?: string | null;
}

export const AuthView: React.FC<AuthViewProps> = ({
  initialMode = 'login',
  onLoginSuccess,
  onToast,
  sessionNotice = null,
}) => {
  const { login, register } = useApp();
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Synchronize route if available
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.pathname) {
      if (window.location.pathname === '/register') {
        setMode('register');
      } else if (window.location.pathname === '/login') {
        setMode('login');
      }
    }
  }, []);

  const switchMode = (newMode: 'login' | 'register') => {
    setMode(newMode);
    setErrorMsg('');
    if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
      window.history.replaceState(null, '', newMode === 'register' ? '/register' : '/login');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const cleanUser = username.trim().toLowerCase();
    if (!cleanUser || cleanUser.length < 2) {
      setErrorMsg('请输入有效的学员用户名（至少 2 个字符）');
      return;
    }

    if (!password || password.length < 8) {
      setErrorMsg('密码长度至少需要 8 位字符，请提高密码安全强度');
      return;
    }

    if (mode === 'register' && !inviteCode.trim()) {
      setErrorMsg('本系统为专属邀请制，请输入有效的注册邀请码');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'login') {
        const res = await login(cleanUser, password);
        if (!res.ok) {
          setErrorMsg(res.message || '登录失败，请核对用户名与密码');
          return;
        }
        onToast('登录成功，已载入学员专属空间！');
        if (onLoginSuccess && res.value) {
          onLoginSuccess(res.value);
        }
      } else {
        const cleanNick = nickname.trim() || cleanUser;
        const res = await register(cleanUser, password, cleanNick, inviteCode.trim());
        if (!res.ok) {
          setErrorMsg(res.message || '注册失败，请检查邀请码或用户名');
          return;
        }
        onToast('注册成功，已初始化默认学习资料库！');
        if (onLoginSuccess && res.value) {
          onLoginSuccess(res.value);
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '网络通信异常，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full min-h-screen bg-[#ECEAE1] flex flex-col items-center justify-center p-4 selection:bg-sage-light">
      <div className="w-full max-w-sm bg-paper border border-line rounded-3xl p-6 sm:p-8 shadow-card flex flex-col animate-fade-in">
        {/* 品牌标识与角色 Logo */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-20 h-20 rounded-2xl bg-cream border-2 border-line/80 flex items-center justify-center p-2 shadow-soft mb-3">
            <img
              src="/branding/logo-transparent.png"
              alt="考公工作台 Logo"
              className="w-full h-full object-contain"
            />
          </div>
          <h1 className="text-xl font-bold text-ink-main tracking-tight">考公工作台</h1>
          <p className="text-xs text-ink-muted mt-1">你的专属备考陪伴与学情统计空间</p>
        </div>

        {/* 模式切换器 */}
        <div className="flex bg-cream/70 p-1 rounded-2xl border border-line mb-5">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
              mode === 'login'
                ? 'bg-paper text-ink-main shadow-sm'
                : 'text-ink-muted hover:text-ink-main'
            }`}
          >
            登录账号
          </button>
          <button
            type="button"
            onClick={() => switchMode('register')}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
              mode === 'register'
                ? 'bg-paper text-ink-main shadow-sm'
                : 'text-ink-muted hover:text-ink-main'
            }`}
          >
            注册新学员
          </button>
        </div>

        {sessionNotice && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 flex items-start gap-2">
            <AlertCircle size={15} className="shrink-0 mt-0.5 text-amber-600" />
            <span className="leading-relaxed flex-1">{sessionNotice}</span>
          </div>
        )}

        {/* 错误提示 */}
        {errorMsg && (
          <div className="mb-4 p-3 bg-alarm-light text-alarm rounded-xl text-xs flex items-start gap-2 border border-red-200">
            <AlertCircle size={15} className="shrink-0 mt-0.5 text-alarm" />
            <span className="leading-relaxed flex-1">{errorMsg}</span>
          </div>
        )}

        {/* 登录/注册表单 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-ink-main mb-1">
              用户名
              <span className="text-[10px] text-ink-muted font-normal ml-1.5">(支持英文字母与数字)</span>
            </label>
            <input
              type="text"
              autoComplete="username"
              placeholder="请输入用户名"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-cream/70 border border-line rounded-xl text-sm focus:outline-none focus:border-sage transition-colors"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-xs font-bold text-ink-main mb-1">
                学员昵称
                <span className="text-[10px] text-ink-muted font-normal ml-1.5">(用于个性化学习空间称呼)</span>
              </label>
              <input
                type="text"
                placeholder="例如：土豆备考中"
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-cream/70 border border-line rounded-xl text-sm focus:outline-none focus:border-sage transition-colors"
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-ink-main">
                账号密码
              </label>
              <span className="text-[10px] text-ink-muted">至少 8 位字符</span>
            </div>
            <div className="relative flex items-center">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="请输入密码"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full pl-3.5 pr-10 py-2.5 bg-cream/70 border border-line rounded-xl text-sm focus:outline-none focus:border-sage transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 p-1 text-ink-muted hover:text-ink-main focus:outline-none transition-colors"
                title={showPassword ? '隐藏明文密码' : '显示明文密码'}
                aria-label={showPassword ? '隐藏明文密码' : '显示明文密码'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-xs font-bold text-ink-main mb-1">
                注册邀请码
                <span className="text-[10px] text-ink-muted font-normal ml-1.5">(专属通道凭证)</span>
              </label>
              <input
                type="text"
                placeholder="请输入管理员提供的专属邀请码"
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-cream/70 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage transition-colors"
              />
            </div>
          )}

          <div className="pt-2">
            <Button
              variant="primary"
              size="md"
              fullWidth
              type="submit"
              disabled={isSubmitting}
              className="py-3 font-bold"
            >
              {isSubmitting ? (
                '正在验证并载入...'
              ) : mode === 'login' ? (
                <span className="flex items-center justify-center gap-1.5">
                  登录学员空间 <ArrowRight size={15} />
                </span>
              ) : (
                <span className="flex items-center justify-center gap-1.5">
                  注册并进入工作台 <Sparkles size={15} />
                </span>
              )}
            </Button>
          </div>
        </form>

        {/* 底部特性提示 */}
        <div className="mt-6 pt-4 border-t border-line/60 text-center text-[11px] text-ink-muted flex items-center justify-center gap-1.5">
          <CheckCircle2 size={13} className="text-sage" />
          <span>学情记录本地可靠暂存 · 联网自动实时云端同步</span>
        </div>
      </div>
    </div>
  );
};
