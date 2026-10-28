import { Router, type Response } from 'express';
import { requireAuth, type AuthenticatedRequest, checkEndpointRateLimit, recordEndpointAttempt } from './auth';
import { getDb } from './db';
import { createAccountEmailService, EmailFeatureError, type EmailServiceOptions } from './accountEmail';
import { createReminderService } from './reminders';

export function createEmailRouter(options?: EmailServiceOptions): Router {
  const router = Router();
  const services = () => {
    const deps = options ?? { db: getDb() };
    return { email: createAccountEmailService(deps), reminders: createReminderService(deps) };
  };
  const route = (handler: (req: AuthenticatedRequest, res: Response) => unknown | Promise<unknown>) => async (req: AuthenticatedRequest, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof EmailFeatureError) res.status(error.status).json({ ok: false, code: error.code, message: error.message });
      else res.status(500).json({ ok: false, code: 'EMAIL_REQUEST_FAILED', message: '邮件提醒操作暂未完成，请稍后重试' });
    }
  };
  const requireAvailable = (req: AuthenticatedRequest) => {
    const feature = services();
    if (!feature.email.status(req.user!.id).available) throw new EmailFeatureError(503, 'EMAIL_UNAVAILABLE', '邮件服务尚未启用，请联系管理员');
    return feature;
  };
  router.get('/api/account/email', requireAuth, route((req, res) => { res.json({ ok: true, ...services().email.status(req.user!.id) }); }));
  router.post('/api/account/email/code', requireAuth, route(async (req, res) => {
    const result = await services().email.requestCode(req.user!.id, req.ip || req.socket.remoteAddress || 'unknown', req.body?.email);
    res.json({ ok: true, ...result });
  }));
  router.post('/api/account/email/verify', requireAuth, route((req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkEndpointRateLimit('verify-email', ip, 100, 3_600_000)) throw new EmailFeatureError(429, 'RATE_LIMITED', '验证请求过于频繁，请稍后重试');
    recordEndpointAttempt('verify-email', ip, 3_600_000);
    res.json({ ok: true, ...services().email.verifyCode(req.user!.id, req.body?.challengeId, req.body?.code) });
  }));
  router.delete('/api/account/email', requireAuth, route((req, res) => { res.json({ ok: true, ...services().email.unbind(req.user!.id) }); }));
  router.get('/api/reminders', requireAuth, route((req, res) => { res.json({ ok: true, reminders: services().reminders.list(req.user!.id) }); }));
  router.post('/api/reminders', requireAuth, route((req, res) => { res.json({ ok: true, reminder: requireAvailable(req).reminders.create(req.user!.id, req.body) }); }));
  router.patch('/api/reminders/:id', requireAuth, route((req, res) => { res.json({ ok: true, reminder: requireAvailable(req).reminders.update(req.user!.id, String(req.params.id), req.body) }); }));
  router.post('/api/reminders/:id/cancel', requireAuth, route((req, res) => { res.json({ ok: true, reminder: services().reminders.cancel(req.user!.id, String(req.params.id), req.body?.revision) }); }));
  return router;
}

// Creating a router opens neither SQLite nor a network connection.
export const emailRouter = createEmailRouter();
