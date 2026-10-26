import React, { ReactNode } from 'react';
import { X, AlertTriangle } from 'lucide-react';

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
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
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
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
      <div
        className="bg-paper border border-line w-full max-w-lg rounded-2xl p-5 shadow-modal max-h-[90vh] overflow-y-auto flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-line mb-4">
          <h3 className="text-lg font-bold text-ink-main">{title}</h3>
          <button
            onClick={onClose}
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
  onConfirm: () => void;
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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-paper border border-line w-full max-w-sm rounded-2xl p-5 shadow-modal">
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
        <div className="flex gap-2.5">
          <Button variant="secondary" fullWidth onClick={onCancel}>
            {cancelText}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} fullWidth onClick={onConfirm}>
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
};

export { Avatar } from './Avatar';

