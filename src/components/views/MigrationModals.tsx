import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal, Button } from '../common/UIComponents';
import { BookOpen, Sparkles, AlertCircle, ShieldCheck, Check, RefreshCw } from 'lucide-react';

interface EmptyLibraryChoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
}

/**
 * Server-driven one-time empty-library initialization choice (R10).
 * The choice is persisted on the server (POST /api/workspace/init-choice) so it is
 * consistent across devices and never re-asked; no localStorage-only decision.
 */
export const EmptyLibraryChoiceModal: React.FC<EmptyLibraryChoiceModalProps> = ({
  isOpen,
  onClose,
  onToast,
}) => {
  const { chooseEmptyLibrary, needsInitChoice } = useApp();
  const [pendingChoice, setPendingChoice] = useState<'default' | 'blank' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const runChoice = async (choice: 'default' | 'blank') => {
    if (pendingChoice) return;
    setPendingChoice(choice);
    setErrorMessage(null);
    try {
      const result = await chooseEmptyLibrary(choice);
      if (!result.ok) {
        setErrorMessage(result.message || '保存选择失败，请联网后重试');
        onToast(result.message || '保存选择失败，请重试');
        return;
      }
      onToast(choice === 'default'
        ? '已载入系统默认学习资料库（保留原有自定义内容与进度）'
        : '已保留空白工作台，您可以自主创建学习资料');
      onClose();
    } finally {
      setPendingChoice(null);
    }
  };

  return (
    <Modal isOpen={isOpen && needsInitChoice} onClose={onClose} title="备考空间资料库初始化" closeDisabled>
      <div className="space-y-4 text-xs">
        <div className="p-3 bg-sage-light/50 border border-sage/30 rounded-2xl flex items-start gap-2.5">
          <BookOpen size={18} className="text-sage shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold text-ink-main">当前工作台暂无学习题本与课程</div>
            <div className="text-ink-muted leading-relaxed">
              请选择一次资料库初始化方式。选择结果将保存在服务器账号中，所有设备保持一致，且不会在您主动删除后再次自动出现。
            </div>
          </div>
        </div>

        <div className="p-3 bg-cream/70 border border-line rounded-2xl space-y-2">
          <div className="font-bold text-ink-main">系统官方推荐资料库包含：</div>
          <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
            <div className="p-2 bg-paper rounded-xl border border-line">
              <div className="font-bold text-sage">14 本</div>
              <div className="text-ink-muted mt-0.5">真题与宝典</div>
            </div>
            <div className="p-2 bg-paper rounded-xl border border-line">
              <div className="font-bold text-sage">7 门</div>
              <div className="text-ink-muted mt-0.5">名师核心网课</div>
            </div>
            <div className="p-2 bg-paper rounded-xl border border-line">
              <div className="font-bold text-sage">22 项</div>
              <div className="text-ink-muted mt-0.5">标准化备考日程</div>
            </div>
          </div>
          <p className="text-[10px] text-ink-muted mt-1">
            注：载入默认资料会保留您已有的自定义事项、自定义题本与全部学习进度；所有新增题本初始进度为 0。
          </p>
        </div>

        {errorMessage && (
          <div className="p-3 bg-alarm/10 border border-alarm/30 rounded-2xl flex items-start gap-2 text-alarm">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <div className="leading-relaxed">{errorMessage}</div>
          </div>
        )}

        <div className="space-y-2 pt-2">
          <Button
            variant="primary"
            size="md"
            fullWidth
            onClick={() => runChoice('default')}
            disabled={Boolean(pendingChoice)}
            className="py-2.5 justify-center font-bold"
          >
            {pendingChoice === 'default' ? <RefreshCw size={14} className="mr-1.5 animate-spin" /> : <Sparkles size={14} className="mr-1.5" />}
            {pendingChoice === 'default' ? '正在载入资料库...' : '使用官方推荐资料库 (推荐)'}
          </Button>

          <Button
            variant="secondary"
            size="md"
            fullWidth
            onClick={() => runChoice('blank')}
            disabled={Boolean(pendingChoice)}
            className="py-2.5 justify-center text-ink-muted"
          >
            {pendingChoice === 'blank' ? '正在保存...' : '保留空白工作台 (自主创建)'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

interface GuestMigrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
}

/**
 * One-time legacy guest data migration (R10): explicit scope/conflict preview,
 * both recovery points, full ID-mapped merge of books/courses/library/plans/records/
 * photos, and no automatic cross-account move.
 */
export const GuestMigrationModal: React.FC<GuestMigrationModalProps> = ({
  isOpen,
  onClose,
  onToast,
}) => {
  const { guestMigration, migrateLegacyGuestData, dismissGuestMigration } = useApp();
  const [isMigrating, setIsMigrating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const preview = guestMigration?.preview;

  const handleMigrate = async () => {
    if (isMigrating) return;
    setIsMigrating(true);
    setErrorMessage(null);
    try {
      const result = await migrateLegacyGuestData();
      if (!result.ok) {
        setErrorMessage(result.message || '迁移失败，本机数据仍保留');
        onToast(result.message || '迁移失败');
        return;
      }
      onToast('旧版本地数据已完整迁移至当前账号，正在同步到云端');
      onClose();
    } finally {
      setIsMigrating(false);
    }
  };

  const handleDismiss = () => {
    dismissGuestMigration();
    onClose();
  };

  return (
    <Modal isOpen={isOpen && Boolean(guestMigration?.available)} onClose={handleDismiss} title="旧版本地数据迁移确认">
      <div className="space-y-4 text-xs">
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2.5 text-amber-900">
          <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold">检测到本机存在旧版本地学情数据</div>
            <div className="text-amber-800 leading-relaxed">
              这些数据属于旧版本本机游客分区，仅会迁移到您当前登录的账号，不会跨账号自动搬运。
            </div>
          </div>
        </div>

        {preview && (
          <div className="p-3 bg-cream/70 border border-line rounded-2xl space-y-2">
            <div className="font-bold text-ink-main">迁移范围预览</div>
            <div className="grid grid-cols-2 gap-1.5 text-[11px] text-ink-muted">
              <div>新增题本：{preview.booksToAdd} 本（复用已有 {preview.booksMatched} 本）</div>
              <div>新增网课：{preview.coursesToAdd} 门（复用已有 {preview.coursesMatched} 门）</div>
              <div>新增事项：{preview.libraryToAdd} 项</div>
              <div>日程：{preview.plansToMigrate} 条{preview.plansSkipped > 0 ? `（跳过失效 ${preview.plansSkipped} 条）` : ''}</div>
              <div>学习记录：{preview.recordsToMigrate} 条</div>
              <div>错题：{preview.wrongToMigrate} 条（含照片 {preview.photosToMigrate} 张）</div>
              <div>倒计时补充：{preview.countdownsToFill} 项</div>
            </div>
            {preview.notes.length > 0 && (
              <ul className="list-disc pl-4 text-[10px] text-ink-muted space-y-0.5">
                {preview.notes.map((note, index) => <li key={index}>{note}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="p-3 bg-cream/70 border border-line rounded-2xl text-[11px] text-ink-muted space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-ink-main">
            <ShieldCheck size={14} className="text-sage" />
            双方恢复快照保护
          </div>
          <p>
            迁移执行前，系统会先为当前账号数据与旧版本机数据分别持久化恢复快照；任一恢复点写入失败都会停止迁移。迁移完成后旧版本机副本仍会保留。
          </p>
        </div>

        {errorMessage && (
          <div className="p-3 bg-alarm/10 border border-alarm/30 rounded-2xl flex items-start gap-2 text-alarm">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <div className="leading-relaxed">{errorMessage}</div>
          </div>
        )}

        <div className="space-y-2 pt-2">
          <Button
            variant="primary"
            size="md"
            fullWidth
            onClick={handleMigrate}
            disabled={isMigrating}
            className="py-2.5 justify-center font-bold"
          >
            {isMigrating ? <RefreshCw size={14} className="mr-1.5 animate-spin" /> : <Check size={14} className="mr-1.5" />}
            {isMigrating ? '正在建立恢复点并迁移...' : '确认将旧版数据迁移到当前账号'}
          </Button>

          <Button
            variant="secondary"
            size="md"
            fullWidth
            onClick={handleDismiss}
            disabled={isMigrating}
            className="py-2.5 justify-center text-ink-muted"
          >
            暂不迁移，保留本机副本
          </Button>
        </div>
      </div>
    </Modal>
  );
};
