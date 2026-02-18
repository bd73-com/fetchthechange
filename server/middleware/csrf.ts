import type { Request, Response, NextFunction } from 'express';

/**
 * CSRF protection middleware using Origin header validation.
 *
 * For state-changing requests (POST, PATCH, DELETE, PUT), validates that the
 * Origin header matches one of the allowed origins. Requests without an Origin
 * header (e.g. same-origin form submissions in older browsers) are rejected
 * for safety — the SPA always sends the Origin header.
 *
 * Exempts paths that use their own authentication (e.g. Stripe webhooks with
 * signature verification).
 */
const EXEMPT_PATHS = new Set(['/api/stripe/webhook', '/api/webhooks/resend']);
const STATE_CHANGING_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);

export function csrfProtection(allowedOrigins: string[], isDev: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!STATE_CHANGING_METHODS.has(req.method)) {
      return next();
    }

    if (EXEMPT_PATHS.has(req.path)) {
      return next();
    }

    const origin = req.headers['origin'];

    if (!origin) {
      res.status(403).json({ message: 'Forbidden: missing Origin header' });
      return;
    }

    if (allowedOrigins.includes(origin)) {
      return next();
    }

    if (isDev) {
      try {
        const hostname = new URL(origin).hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
          return next();
        }
      } catch {}
    }

    res.status(403).json({ message: 'Forbidden: origin not allowed' });
  };
}
