import { Router, type Response, type NextFunction } from 'express';
import { requireAuth, checkEndpointRateLimit, recordEndpointAttempt, type AuthenticatedRequest } from './auth';
import {
  cancelSharingCode, createSharingCode, getSharedStudyOverview, listSharingGrants,
  redeemSharingCode, revokeSharingGrant, SharingError,
  pokeCompanion, listCompanionNotes, createCompanionNote, heartCompanionNote,
  getCompanionSettings, updateCompanionSettings,
} from './sharing';

export const sharingRouter = Router();

sharingRouter.use('/api/sharing', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
}, requireAuth);

function limited(action: string, maximum: number, ipMaximum: number, window = 15 * 60 * 1000) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.user!.id; const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkEndpointRateLimit(`sharing:${action}:user`, user, maximum, window)
      || !checkEndpointRateLimit(`sharing:${action}:ip`, ip, ipMaximum, window)) {
      res.setHeader('Retry-After', String(Math.ceil(window / 1000)));
      res.status(429).json({ ok: false, code: 'SHARING_RATE_LIMIT', message: '操作过于频繁，请稍后重试' });
      return;
    }
    recordEndpointAttempt(`sharing:${action}:user`, user, window);
    recordEndpointAttempt(`sharing:${action}:ip`, ip, window);
    next();
  };
}

function handle(action: (req: AuthenticatedRequest, res: Response) => void) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try { action(req, res); } catch (error) {
      if (error instanceof SharingError) res.status(error.status).json({ ok: false, code: error.code, message: error.message });
      else next(error);
    }
  };
}

sharingRouter.post('/api/sharing/codes', limited('create', 10, 100), handle((req, res) => {
  res.json({ ok: true, code: createSharingCode(req.user!.id) });
}));
sharingRouter.delete('/api/sharing/codes/:id', limited('cancel', 30, 120), handle((req, res) => {
  cancelSharingCode(req.user!.id, String(req.params.id)); res.json({ ok: true });
}));
sharingRouter.post('/api/sharing/redeem', limited('redeem', 20, 120), handle((req, res) => {
  res.json({ ok: true, grant: redeemSharingCode(req.user!.id, req.body?.code) });
}));
sharingRouter.get('/api/sharing/grants', limited('list', 120, 300, 60_000), handle((req, res) => {
  res.json(listSharingGrants(req.user!.id));
}));
sharingRouter.delete('/api/sharing/grants/:id', limited('revoke', 30, 120), handle((req, res) => {
  revokeSharingGrant(req.user!.id, String(req.params.id)); res.json({ ok: true });
}));
sharingRouter.get('/api/sharing/grants/:id/overview', limited('overview', 120, 300, 60_000), handle((req, res) => {
  res.json({ ok: true, overview: getSharedStudyOverview(req.user!.id, String(req.params.id), req.query) });
}));
sharingRouter.post('/api/sharing/nudge', limited('nudge', 30, 100), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const result = await pokeCompanion(req.user!.id, String(req.body?.grantId));
    res.json(result);
  } catch (error) {
    if (error instanceof SharingError) res.status(error.status).json({ ok: false, code: error.code, message: error.message });
    else next(error);
  }
});
sharingRouter.get('/api/sharing/notes', limited('notes_list', 120, 300, 60_000), handle((req, res) => {
  res.json(listCompanionNotes(req.user!.id));
}));
sharingRouter.post('/api/sharing/notes', limited('notes_post', 30, 100), handle((req, res) => {
  res.json({ ok: true, note: createCompanionNote(req.user!.id, req.body) });
}));
sharingRouter.post('/api/sharing/notes/:id/heart', limited('notes_heart', 120, 300, 60_000), handle((req, res) => {
  res.json({ ok: true, hearts: heartCompanionNote(req.user!.id, String(req.params.id)) });
}));
sharingRouter.get('/api/sharing/settings', limited('settings_get', 120, 300, 60_000), handle((req, res) => {
  res.json({ ok: true, ...getCompanionSettings(req.user!.id) });
}));
sharingRouter.put('/api/sharing/settings', limited('settings_put', 30, 100), handle((req, res) => {
  res.json({ ok: true, ...updateCompanionSettings(req.user!.id, String(req.body?.targetStudyTime || '')) });
}));

