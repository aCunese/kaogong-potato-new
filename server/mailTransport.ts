import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  messageId: string;
  signal?: AbortSignal;
}

export interface MailSender {
  readonly available: boolean;
  send(message: MailMessage): Promise<void>;
}

/** Only a known SMTP rejection may be retried; a lost DATA acknowledgement is uncertain. */
export class MailDeliveryError extends Error {
  constructor(public readonly kind: 'transient' | 'permanent' | 'unknown' | 'unavailable') {
    super('邮件暂时无法发送，请稍后重试');
    this.name = 'MailDeliveryError';
  }
}

export function createSmtpMailSender(env: NodeJS.ProcessEnv = process.env): MailSender {
  const { SMTP_HOST: host, SMTP_PORT: rawPort, SMTP_USER: user, SMTP_PASS: pass, SMTP_FROM: from } = env;
  const port = Number(rawPort);
  const available = Boolean(host && !/[\s/]/.test(host) && [465, 587].includes(port) && user && pass && from && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from));
  let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
  return {
    available,
    async send(message) {
      if (!available) throw new MailDeliveryError('unavailable');
      if (message.signal?.aborted) throw new MailDeliveryError('unknown');
      transport ??= nodemailer.createTransport({
        host, port, secure: port === 465, requireTLS: port === 587,
        auth: { user: user!, pass: pass! },
        tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
        connectionTimeout: 4000, greetingTimeout: 4000, socketTimeout: 6000,
        disableFileAccess: true, disableUrlAccess: true,
        logger: false, debug: false,
      });
      const activeTransport = transport;
      const abort = () => { activeTransport.close(); transport = undefined; };
      message.signal?.addEventListener('abort', abort, { once: true });
      try {
        const result = await activeTransport.sendMail({
          from, to: message.to, subject: message.subject, text: message.text,
          messageId: message.messageId, disableFileAccess: true, disableUrlAccess: true,
        });
        if (!Array.isArray(result.accepted) || result.accepted.length === 0) throw new MailDeliveryError('permanent');
      } catch (error) {
        if (error instanceof MailDeliveryError) throw error;
        const smtp = error as { responseCode?: number; command?: string; code?: string };
        if (typeof smtp.responseCode === 'number' && smtp.responseCode >= 400) {
          throw new MailDeliveryError(smtp.responseCode < 500 ? 'transient' : 'permanent');
        }
        // Nodemailer also reports a lost final DATA acknowledgement as command=CONN.
        const beforeData = /^(EHLO|HELO|STARTTLS|AUTH|MAIL FROM|RCPT TO)$/i.test(smtp.command || '')
          || ['EDNS', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(smtp.code || '');
        throw new MailDeliveryError(beforeData && !message.signal?.aborted ? 'transient' : 'unknown');
      } finally {
        message.signal?.removeEventListener('abort', abort);
      }
    },
  };
}
