import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { X, AlertTriangle, ChevronDown, Check } from 'lucide-react';

const modalBackStack: { close: () => void }[] = [];

export function closeTopModal(): boolean {
  const top = modalBackStack[modalBackStack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

function useModalBack(isOpen: boolean, onClose: () => void, closeDisabled = false) {
  const closeRef = useRef(onClose);
  const disabledRef = useRef(closeDisabled);
  closeRef.current = onClose;
  disabledRef.current = closeDisabled;
  useEffect(() => {
    if (!isOpen) return;
    const entry = { close: () => { if (!disabledRef.current) closeRef.current(); } };
    modalBackStack.push(entry);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && modalBackStack[modalBackStack.length - 1] === entry) {
        event.preventDefault();
        entry.close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      const index = modalBackStack.indexOf(entry);
      if (index >= 0) modalBackStack.splice(index, 1);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);
}

/* =========================================================================
   Button
   ========================================================================= */
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'light';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  children: ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className = '',
  disabled,
  children,
  ...props
}) => {
  const baseStyles = 'inline-flex items-center justify-center font-medium rounded-btn transition-colors focus:outline-none select-none active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none';
  
  const variantStyles = {
    primary: 'bg-sage text-white hover:bg-sage-dark active:bg-sage-dark shadow-sm',
    secondary: 'bg-[#ECE8DF] text-ink-main hover:bg-[#E2DDD3]',
    danger: 'bg-alarm-light text-alarm hover:bg-red-100',
    ghost: 'bg-transparent text-ink-muted hover:text-ink-main hover:bg-black/5',
    light: 'bg-sage-light text-sage-dark hover:bg-[#DDE5D3]',
  };

  const sizeStyles = {
    sm: 'text-xs px-3 py-1.5 h-8 gap-1.5',
    md: 'text-sm px-4 py-2.5 h-11 gap-2',
    lg: 'text-base px-5 py-3.5 h-13 gap-2.5',
  };

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};

/* =========================================================================
   Card
   ========================================================================= */
export const Card: React.FC<{
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}> = ({ children, className = '', onClick }) => {
  return (
    <div
      onClick={onClick}
      className={`bg-paper border border-line rounded-card p-4 shadow-soft ${onClick ? 'cursor-pointer active:scale-[0.99] transition-transform' : ''} ${className}`}
    >
      {children}
    </div>
  );
};

/* =========================================================================
   Tag
   ========================================================================= */
export const Tag: React.FC<{
  children: ReactNode;
  variant?: 'sage' | 'course' | 'potato' | 'gray' | 'danger';
  className?: string;
}> = ({ children, variant = 'gray', className = '' }) => {
  const styles = {
    sage: 'bg-sage-light text-sage-dark border-sage-light',
    course: 'bg-course-bg text-course-text border-course-bg',
    potato: 'bg-potato-light text-potato-dark border-potato-light',
    gray: 'bg-[#ECE8DF] text-ink-muted border-[#E4E0D6]',
    danger: 'bg-alarm-light text-alarm border-alarm-light',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md border ${styles[variant]} ${className}`}>
      {children}
    </span>
  );
};

/* =========================================================================
   ProgressBar
   ========================================================================= */
export const ProgressBar: React.FC<{
  value: number; // 0 to 100
  color?: string;
  className?: string;
}> = ({ value, className = '' }) => {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className={`h-2 bg-[#ECE8DF] rounded-full overflow-hidden ${className}`}>
      <div
        className="h-full bg-gradient-to-r from-sage to-potato transition-all duration-300 rounded-full"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
};

/* =========================================================================
   Segmented Controls
   ========================================================================= */
export const Segment: React.FC<{
  options: { label: string; value: string }[];
  value: string;
  onChange: (val: string) => void;
  className?: string;
}> = ({ options, value, onChange, className = '' }) => {
  return (
    <div className={`flex bg-[#ECE8DF] p-1 rounded-sub gap-1 ${className}`}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
              active
                ? 'bg-paper text-ink-main shadow-sm font-semibold'
                : 'text-ink-muted hover:text-ink-main'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

/* =========================================================================
   Modal / Sheet
   ========================================================================= */
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  closeDisabled?: boolean;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, closeDisabled = false }) => {
  useModalBack(isOpen, onClose, closeDisabled);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-paper border border-line w-full max-w-lg rounded-2xl p-5 shadow-modal max-h-[90vh] overflow-y-auto flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-line mb-4">
          <h3 className="text-lg font-bold text-ink-main">{title}</h3>
          <button
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="关闭弹窗"
            className="p-1 rounded-lg text-ink-muted hover:text-ink-main hover:bg-black/5"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
};

/* =========================================================================
   Confirmation Modal (for dangerous operations)
   ========================================================================= */
interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  impactText?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => unknown | Promise<unknown>;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  impactText,
  confirmText = '确认',
  cancelText = '取消',
  danger = true,
  onConfirm,
  onCancel,
}) => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const pendingRef = useRef(false);
  useModalBack(isOpen, onCancel, pending);
  useEffect(() => {
    if (isOpen) setError('');
  }, [isOpen, title]);
  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    try {
      const result = await onConfirm();
      if (result && typeof result === 'object' && 'ok' in result && result.ok === false) {
        setError('message' in result ? String(result.message) : '操作失败，请重试');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请重试');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-paper border border-line w-full max-w-sm rounded-2xl p-5 shadow-modal max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center gap-3 mb-3">
          <div className={`p-2.5 rounded-full ${danger ? 'bg-alarm-light text-alarm' : 'bg-sage-light text-sage'}`}>
            <AlertTriangle size={22} />
          </div>
          <h3 className="text-base font-bold text-ink-main">{title}</h3>
        </div>
        <p className="text-sm text-ink-muted leading-relaxed mb-3">
          {message}
        </p>
        {impactText && (
          <div className="p-2.5 mb-4 rounded-lg bg-cream/70 border border-line/60 text-xs text-ink-muted leading-relaxed">
            {impactText}
          </div>
        )}
        {error && <p role="alert" className="text-xs text-alarm mb-3">{error}</p>}
        <div className="flex gap-2.5">
          <Button variant="secondary" fullWidth onClick={onCancel} disabled={pending}>
            {cancelText}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} fullWidth onClick={handleConfirm} disabled={pending}>
            {pending ? '处理中…' : confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
};

export { Avatar } from './Avatar';

/* =========================================================================
   SubjectCapsuleGrid (Inline Capsule Grid for 8/9 Subjects)
   ========================================================================= */
export interface SubjectCapsuleGridProps {
  options: readonly string[] | Array<{ label: string; value: string }>;
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  columns?: 3 | 4;
  ariaLabel?: string;
  className?: string;
}

export const SubjectCapsuleGrid: React.FC<SubjectCapsuleGridProps> = ({
  options,
  value,
  onChange,
  disabled = false,
  columns = 3,
  ariaLabel,
  className = '',
}) => {
  const normalized = options.map(opt =>
    typeof opt === 'string' ? { label: opt, value: opt } : opt
  );
  const gridCols = columns === 4 ? 'grid-cols-4' : 'grid-cols-3';

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`grid ${gridCols} gap-1.5 ${className}`}
    >
      {normalized.map(opt => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`rounded-xl py-2 px-2 text-xs transition-all truncate ${
              active
                ? 'bg-sage text-white font-bold shadow-sm'
                : 'bg-cream/80 text-ink-muted border border-line/60 hover:border-sage/40 hover:text-ink-main'
            } disabled:opacity-50`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

/* =========================================================================
   CustomSelect (Potato Paper-Style Custom Dropdown Picker)
   ========================================================================= */
export interface CustomSelectOption {
  value: string;
  label: string;
  subLabel?: string;
  badge?: string;
  badgeVariant?: 'sage' | 'course' | 'potato' | 'gray' | 'danger';
  dotColor?: string;
}

export interface CustomSelectProps {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
  compact?: boolean;
  columns?: 1 | 2;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  options,
  onChange,
  placeholder = '请选择',
  emptyText = '暂无可选项',
  disabled = false,
  ariaLabel,
  id,
  className = '',
  compact = false,
  columns = 1,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen(prev => !prev)}
        className={`w-full flex items-center justify-between gap-2 bg-cream/70 border transition-colors text-left ${
          open ? 'border-sage bg-paper shadow-sm' : 'border-line hover:border-sage/60'
        } ${
          compact ? 'px-2.5 py-1.5 rounded-lg text-xs' : 'px-3 py-2.5 rounded-xl text-sm'
        } disabled:opacity-50`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {selected?.dotColor && (
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: selected.dotColor }}
            />
          )}
          <span
            className={`truncate ${
              selected ? 'text-ink-main font-medium' : 'text-ink-muted/70'
            }`}
          >
            {selected ? selected.label : options.length === 0 ? emptyText : placeholder}
          </span>
          {selected?.badge && (
            <Tag variant={selected.badgeVariant || 'potato'} className="shrink-0 py-0 text-[10px]">
              {selected.badge}
            </Tag>
          )}
        </div>
        <ChevronDown
          size={compact ? 14 : 16}
          className={`text-ink-muted shrink-0 transition-transform duration-200 ${
            open ? 'rotate-180 text-sage' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className={`mt-1.5 max-h-56 overflow-y-auto rounded-2xl border border-sage/30 bg-paper p-1.5 shadow-modal z-40 relative ${
            columns === 2 && options.length > 0 ? 'grid grid-cols-2 gap-1' : 'space-y-1'
          }`}
        >
          {options.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-cream/40 p-3 text-center text-xs text-ink-muted">
              {emptyText}
            </div>
          ) : (
            options.map(opt => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full px-3 py-2 rounded-xl flex items-center justify-between gap-2 text-left transition-colors ${
                    isSelected
                      ? 'bg-sage-light/80 text-sage-dark font-bold'
                      : 'hover:bg-cream/80 text-ink-main'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {opt.dotColor && (
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: opt.dotColor }}
                        />
                      )}
                      <span className="text-xs truncate">{opt.label}</span>
                    </div>
                    {opt.subLabel && (
                      <div className="text-[11px] text-ink-muted truncate mt-0.5">
                        {opt.subLabel}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {opt.badge && (
                      <Tag variant={opt.badgeVariant || 'gray'} className="py-0 text-[10px]">
                        {opt.badge}
                      </Tag>
                    )}
                    {isSelected && <Check size={14} className="text-sage shrink-0" />}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};


