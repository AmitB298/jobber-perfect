import { Router, Request, Response } from 'express';

const router = Router();

let _latestPush: any = null;
const _sseClients: Response[] = [];

// WebSocket collector POSTs live chain data here
router.post('/push', (req: Request, res: Response) => {
  _latestPush = req.body;
  // broadcast to all SSE clients
  const data = `data: ${JSON.stringify(_latestPush)}\n\n`;
  for (let i = _sseClients.length - 1; i >= 0; i--) {
    try { _sseClients[i].write(data); }
    catch (_) { _sseClients.splice(i, 1); }
  }
  res.json({ ok: true });
});

// Frontend subscribes here for live updates
router.get('/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  _sseClients.push(res);
  if (_latestPush) res.write(`data: ${JSON.stringify(_latestPush)}\n\n`);
  req.on('close', () => {
    const idx = _sseClients.indexOf(res);
    if (idx !== -1) _sseClients.splice(idx, 1);
  });
});

// Latest snapshot for frontend on load
router.get('/latest', (_req: Request, res: Response) => {
  if (_latestPush) res.json(_latestPush);
  else res.status(404).json({ error: 'No data yet' });
});

export default router;
