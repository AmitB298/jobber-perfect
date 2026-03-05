import { z } from 'zod';

// FIX: Input validation schemas (added by Fix-JobberProject.ps1)
const AngelLoginSchema = z.object({
  clientcode: z.string().min(1).max(20),
  password:   z.string().min(4).max(100),
  totp:       z.string().length(6).optional(),
});

const AngelOrderSchema = z.object({
  symbol:      z.string().min(1).max(50),
  quantity:    z.number().int().positive().max(100000),
  price:       z.number().nonnegative(),
  ordertype:   z.enum(['MARKET','LIMIT','SL','SL-M']),
  transactiontype: z.enum(['BUY','SELL']),
});

// Usage: const body = AngelLoginSchema.parse(req.body);  — throws ZodError on invalid input
import { Router, Request, Response } from 'express';
import { createAngelOneService, AngelOneService } from '../services/angelone.service';

const router = Router();

class AngelServiceManager {
  private services = new Map<string, { service: AngelOneService; lastUsed: Date }>();
  
  getService(userId: string): AngelOneService {
    const existing = this.services.get(userId);
    if (existing) {
      existing.lastUsed = new Date();
      return existing.service;
    }
    
    const service = createAngelOneService();
    this.services.set(userId, { service, lastUsed: new Date() });
    return service;
  }
  
  async removeService(userId: string): Promise<void> {
    const entry = this.services.get(userId);
    if (entry) {
      await entry.service.logout();
      this.services.delete(userId);
    }
  }
}

const serviceManager = new AngelServiceManager();

const requireAuth = (req: Request, res: Response, next: any) => {
  const userId = req.headers['user-id'] as string;
  if (!userId) {
    return res.status(401).json({ success: false, error: 'user-id header required' });
  }
  (req as any).userId = userId;
  next();
};

router.post('/login', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const angelService = serviceManager.getService(userId);
    const result = await angelService.login();

    if (result.success) {
      res.json({
        success: true,
        message: 'Logged in successfully',
        feedToken: angelService.getFeedToken()?.substring(0, 20) + '...'
      });
    } else {
      res.status(401).json({ success: false, message: result.message });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const angelService = serviceManager.getService(userId);

    if (!angelService.isLoggedIn()) {
      return res.status(401).json({ success: false, message: 'Not logged in' });
    }

    const profile = await angelService.getProfile();
    res.json({ success: true, data: profile });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/ltp/:symbol', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const angelService = serviceManager.getService(userId);

    if (!angelService.isLoggedIn()) {
      return res.status(401).json({ success: false, message: 'Not logged in' });
    }

    const symbol = req.params.symbol.toUpperCase();
    const symbolMap: any = {
      'NIFTY': { token: '99926000', exchange: 'NSE' },
      'BANKNIFTY': { token: '99926009', exchange: 'NSE' },
      'FINNIFTY': { token: '99926037', exchange: 'NSE' }
    };

    if (!symbolMap[symbol]) {
      return res.status(400).json({ success: false, message: 'Symbol not supported' });
    }

    const { token, exchange } = symbolMap[symbol];
    const ltp = await angelService.getLTP(exchange, symbol, token);

    res.json({ success: true, symbol, ltp, timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/logout', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    await serviceManager.removeService(userId);
    res.json({ success: true, message: 'Logged out' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;