import React from 'react';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  onReset?: () => void;
  onSecondaryAction?: () => void;
  secondaryLabel?: string;
  fallback?: (args: { error: Error | null; reset: () => void }) => React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Caught rendering error:', error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback({ error: this.state.error, reset: this.reset });
    }

    const {
      title = '页面暂时遇到渲染异常',
      description = '你的本地学习数据安全无损，点击下方重试即可恢复显示。',
      onSecondaryAction,
      secondaryLabel = '关闭',
    } = this.props;

    return (
      <div
        role="alert"
        data-testid="error-boundary-fallback"
        className="rounded-2xl border border-alarm/30 bg-alarm-light/70 p-4 text-center space-y-3"
      >
        <div className="space-y-1">
          <p className="text-sm font-bold text-ink-main">{title}</p>
          <p className="text-xs leading-relaxed text-ink-muted">{description}</p>
        </div>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={this.reset}
            className="px-3.5 py-1.5 rounded-xl bg-sage text-white text-xs font-bold hover:bg-sage-dark transition"
          >
            重试
          </button>
          {onSecondaryAction && (
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                onSecondaryAction();
              }}
              className="px-3.5 py-1.5 rounded-xl bg-paper border border-line text-ink-main text-xs font-medium hover:bg-cream transition"
            >
              {secondaryLabel}
            </button>
          )}
        </div>
      </div>
    );
  }
}
