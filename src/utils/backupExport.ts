import { BackupExportReceipt, OperationContext } from '../types';

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function computeSha256Hex(arrayBuffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function saveBackupFile(
  blob: Blob,
  filename: string,
  context: OperationContext
): Promise<BackupExportReceipt> {
  if (!context.isCurrent() || context.abortSignal?.aborted) {
    throw new Error('AUTH_SCOPE_INVALID');
  }

  // Detect Android bridge
  let bridge: any = null;
  let appInfo: any = null;
  if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge === 'object') {
    bridge = window.AndroidBridge;
    if (typeof bridge.getAppInfo === 'function') {
      try {
        const raw = bridge.getAppInfo();
        appInfo = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (e) {
        // ignore parse error
      }
    }
  }

  // If in Android environment (bridge exists)
  if (bridge) {
    const protocol = appInfo?.backupExportProtocol;
    if (protocol !== 1) {
      throw new Error(
        '当前 Android 客户端版本过低，暂不支持原生文档保存。请前往设置检查更新客户端，或使用系统浏览器访问工作台导出备份。'
      );
    }

    const arrayBuffer = await blob.arrayBuffer();
    const bytes = arrayBuffer.byteLength;
    if (bytes > 50 * 1024 * 1024) {
      throw new Error(`备份大小超过 50MB 限制: ${bytes} 字节`);
    }

    const sha256 = await computeSha256Hex(arrayBuffer);
    const operationId = 'backup_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    if (!context.isCurrent() || context.abortSignal?.aborted) {
      throw new Error('AUTH_SCOPE_INVALID');
    }

    return new Promise<BackupExportReceipt>((resolve, reject) => {
      let isSettled = false;
      const previousListener = (window as any).__kaogongBackupExportEvent;

      const cleanup = () => {
        (window as any).__kaogongBackupExportEvent = previousListener;
      };

      const handleEvent = (eventData: string | any) => {
        if (isSettled) return;
        try {
          const evt = typeof eventData === 'string' ? JSON.parse(eventData) : eventData;
          if (!evt || evt.operationId !== operationId) return;

          if (evt.type === 'backup_saved') {
            isSettled = true;
            cleanup();
            resolve({
              status: 'saved',
              destination: 'android-document',
              filename: evt.filename || filename,
              bytes: typeof evt.bytes === 'number' ? evt.bytes : bytes,
            });
          } else if (evt.type === 'backup_cancelled') {
            isSettled = true;
            cleanup();
            resolve({
              status: 'cancelled',
              destination: 'android-document',
            });
          } else if (evt.type === 'backup_failed') {
            isSettled = true;
            cleanup();
            reject(new Error(evt.message || '原生备份导出失败'));
          }
        } catch (e) {
          // ignore parse error
        }
      };

      (window as any).__kaogongBackupExportEvent = handleEvent;

      if (context.abortSignal) {
        context.abortSignal.addEventListener(
          'abort',
          () => {
            if (!isSettled) {
              isSettled = true;
              try {
                bridge.cancelBackupExport?.(operationId);
              } catch (_) {}
              cleanup();
              reject(new Error('AUTH_SCOPE_INVALID'));
            }
          },
          { once: true }
        );
      }

      // Execute sequential chunk streaming
      (async () => {
        const beginReq = JSON.stringify({
          operationId,
          filename,
          mimeType: 'application/json',
          bytes,
          sha256,
        });

        let beginAck: any;
        try {
          const beginAckStr = bridge.beginBackupExport(beginReq);
          beginAck = typeof beginAckStr === 'string' ? JSON.parse(beginAckStr) : beginAckStr;
        } catch (err) {
          isSettled = true;
          cleanup();
          reject(err instanceof Error ? err : new Error('调用 beginBackupExport 失败'));
          return;
        }

        if (!beginAck || !beginAck.ok) {
          isSettled = true;
          cleanup();
          reject(new Error(beginAck?.message || '初始化备份导出失败'));
          return;
        }

        const uint8 = new Uint8Array(arrayBuffer);
        const CHUNK_SIZE = 48 * 1024; // <= 48KiB raw bytes
        let offset = 0;
        let sequence = 0;

        while (offset < uint8.byteLength) {
          if (isSettled) return;

          if (!context.isCurrent() || context.abortSignal?.aborted) {
            isSettled = true;
            try {
              bridge.cancelBackupExport?.(operationId);
            } catch (_) {}
            cleanup();
            reject(new Error('AUTH_SCOPE_INVALID'));
            return;
          }

          const nextOffset = Math.min(offset + CHUNK_SIZE, uint8.byteLength);
          const chunk = uint8.subarray(offset, nextOffset);
          const base64Chunk = uint8ArrayToBase64(chunk);

          let ack: any;
          try {
            const ackStr = bridge.appendBackupExport(operationId, sequence, base64Chunk);
            ack = typeof ackStr === 'string' ? JSON.parse(ackStr) : ackStr;
          } catch (err) {
            isSettled = true;
            try {
              bridge.cancelBackupExport?.(operationId);
            } catch (_) {}
            cleanup();
            reject(err instanceof Error ? err : new Error(`发送分块 ${sequence} 失败`));
            return;
          }

          if (!ack || !ack.ok) {
            isSettled = true;
            try {
              bridge.cancelBackupExport?.(operationId);
            } catch (_) {}
            cleanup();
            reject(new Error(ack?.message || `写入分块 ${sequence} 失败`));
            return;
          }

          offset = nextOffset;
          sequence++;
        }

        if (isSettled) return;

        if (!context.isCurrent() || context.abortSignal?.aborted) {
          isSettled = true;
          try {
            bridge.cancelBackupExport?.(operationId);
          } catch (_) {}
          cleanup();
          reject(new Error('AUTH_SCOPE_INVALID'));
          return;
        }

        let finishAck: any;
        try {
          const finishAckStr = bridge.finishBackupExport(operationId);
          finishAck = typeof finishAckStr === 'string' ? JSON.parse(finishAckStr) : finishAckStr;
        } catch (err) {
          isSettled = true;
          cleanup();
          reject(err instanceof Error ? err : new Error('调用 finishBackupExport 失败'));
          return;
        }

        if (!finishAck || !finishAck.ok) {
          isSettled = true;
          cleanup();
          reject(new Error(finishAck?.message || '完成备份导出失败'));
          return;
        }
        // Native will trigger SAF document creation and emit event via __kaogongBackupExportEvent
      })().catch(err => {
        if (!isSettled) {
          isSettled = true;
          try {
            bridge.cancelBackupExport?.(operationId);
          } catch (_) {}
          cleanup();
          reject(err);
        }
      });
    });
  }

  // Normal browser download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return {
    status: 'download_requested',
    destination: 'browser',
    filename,
    bytes: blob.size,
  };
}
