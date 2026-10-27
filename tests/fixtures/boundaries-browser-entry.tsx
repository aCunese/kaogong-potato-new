import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useApp } from '../../src/context/AppContext';
import { BackupModal } from '../../src/components/views/BackupModal';
import * as db from '../../src/utils/db';
import * as sync from '../../src/utils/syncClient';
import * as mut from '../../src/utils/workflowMutators';
import * as versionCheck from '../../src/utils/versionCheck';
import { BLANK_STATE, DEMO_STATE } from '../../src/constants/initialData';

const w = window as any;
Object.assign(w, { db, sync, mut, versionCheck, BLANK_STATE, DEMO_STATE, React, createRoot, AppProvider, BackupModal });

function Consumer() {
  w.api = useApp();
  return React.createElement(BackupModal, {
    isOpen: Boolean(w.backupModalOpen),
    onClose: () => { w.backupModalOpen = false; },
    onOpenResetConfirm: () => {},
    onToast: (msg: string) => { w.lastToast = msg; },
  });
}

w.mount = () => {
  const rootEl = document.getElementById('root');
  if (rootEl) {
    createRoot(rootEl).render(
      React.createElement(AppProvider, null, React.createElement(Consumer))
    );
  }
};
