import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useApp } from '../../src/context/AppContext';
import { BackupModal } from '../../src/components/views/BackupModal';
import { SettingsView } from '../../src/components/views/SettingsView';
import * as db from '../../src/utils/db';
import * as sync from '../../src/utils/syncClient';
import * as mut from '../../src/utils/workflowMutators';
import * as versionCheck from '../../src/utils/versionCheck';
import * as backupExport from '../../src/utils/backupExport';
import * as imageCompressor from '../../src/utils/imageCompressor';
import { ConflictModal } from '../../src/components/views/ConflictModal';
import { CompletionModal } from '../../src/components/views/CompletionModal';
import { PhotoImportModal } from '../../src/components/views/EditModals';
import { BLANK_STATE, DEMO_STATE } from '../../src/constants/initialData';

const w = window as any;
Object.assign(w, {
  db,
  sync,
  mut,
  versionCheck,
  backupExport,
  imageCompressor,
  BLANK_STATE,
  DEMO_STATE,
  React,
  createRoot,
  AppProvider,
  BackupModal,
  SettingsView,
  ConflictModal,
  CompletionModal,
  PhotoImportModal,
});

function Consumer() {
  w.api = useApp();
  const [backupOpen, setBackupOpen] = React.useState(Boolean(w.backupModalOpen));
  w.setBackupModalOpen = setBackupOpen;
  React.useEffect(() => {
    if (w.backupModalOpen !== backupOpen) {
      setBackupOpen(Boolean(w.backupModalOpen));
    }
  }, [w.backupModalOpen]);

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(BackupModal, {
      isOpen: backupOpen || Boolean(w.backupModalOpen),
      onClose: () => {
        w.backupModalOpen = false;
        setBackupOpen(false);
      },
      onOpenResetConfirm: () => {},
      onToast: (msg: string) => {
        w.lastToast = msg;
      },
    }),
    w.showSettingsView
      ? React.createElement(SettingsView, {
          onOpenProfile: () => {},
          onOpenBackup: () => {
            w.backupModalOpen = true;
            w.backupOpened = true;
            setBackupOpen(true);
          },
          onOpenLogoutConfirm: () => {},
          onOpenResetConfirm: () => {},
          onToast: (msg: string) => {
            w.lastToast = msg;
          },
        })
      : null,
    w.conflictModalOpen
      ? React.createElement(ConflictModal, {
          isOpen: true,
          localState: w.conflictLocalState || BLANK_STATE,
          localRevision: w.conflictLocalRev || 1,
          serverState: w.conflictServerState || null,
          serverRevision: w.conflictServerRev || 2,
          onKeepLocal: w.onKeepLocal || (async () => ({ ok: true, value: undefined })),
          onKeepRemote: w.onKeepRemote || (async () => ({ ok: true, value: undefined })),
          onClose: () => {
            w.conflictModalOpen = false;
            w.conflictModalDeferred = true;
          },
        })
      : null,
    w.completionModalOpen
      ? React.createElement(CompletionModal, {
          plan: w.completionPlan || null,
          isOpen: true,
          initialSuccess: w.completionInitialSuccess,
          onClose: () => { w.completionModalOpen = false; },
          onOpenPhotoImport: (target: any) => {
            w.completionModalOpen = false;
            w.photoImportTarget = target;
            w.photoImportModalOpen = true;
          },
          onToast: (msg: string) => { w.lastToast = msg; },
        })
      : null,
    w.photoImportModalOpen
      ? React.createElement(PhotoImportModal, {
          isOpen: true,
          initialTarget: w.photoImportTarget,
          onClose: () => {
            w.photoImportModalOpen = false;
            w.photoImportCancelled = true;
          },
          onToast: (msg: string) => { w.lastToast = msg; },
        })
      : null
  );
}

w.mount = () => {
  const rootEl = document.getElementById('root');
  if (rootEl) {
    createRoot(rootEl).render(
      React.createElement(AppProvider, null, React.createElement(Consumer))
    );
  }
};
