export type EmailReminderStatus = 'pending' | 'retry' | 'sending' | 'sent' | 'failed' | 'unknown' | 'cancelled' | 'missed' | 'needs_review';

export interface AccountEmailStatus {
  available: boolean;
  bound: boolean;
  maskedEmail: string | null;
}

export interface EmailReminder {
  id: string;
  title: string;
  body: string;
  sendAt: string;
  timezone: string;
  status: EmailReminderStatus;
  revision: number;
  attempts: number;
  delayed: boolean;
  messageId: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailReminderInput {
  requestId: string;
  title: string;
  body: string;
  sendAt: string;
  timezone: string;
}
