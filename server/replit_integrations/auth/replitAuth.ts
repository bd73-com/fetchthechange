import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { authStorage } from "./storage";

/**
 * Validates and sanitizes a returnTo query parameter.
 * Only relative paths (starting with "/" but not "//") are allowed
 * to prevent open-redirect attacks.
 */
export function sanitizeReturnTo(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length > 2048) return undefined;
  if (!value.startsWith("/")) return undefined;
  if (value.startsWith("//")) return undefined;
  if (value.includes("\\") || /%5c/i.test(value)) return undefined;
  if (/[\x00-\x1f]/.test(value) || /%[01][0-9a-f]/i.test(value)) return undefined;
  return value;
}

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: sessionTtl,
    },
  });
}

function serializeUserPayload(user: any) {
  return {
    claims: user.claims,
    access_token: user.access_token,
    refresh_token: user.refresh_token,
    expires_at: user.expires_at,
  };
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token ?? user.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims: any) {
  await authStorage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  // Keep track of registered strategies
  const registeredStrategies = new Set<string>();

  // Helper function to ensure strategy exists for a domain
  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: any, cb) => {
    // Only persist the fields needed for authentication — avoid leaking
    // the full user object (tokens, profile data) into the session store.
    cb(null, serializeUserPayload(user));
  });
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    const returnTo = sanitizeReturnTo(req.query.returnTo);
    if (returnTo) {
      (req.session as any).returnTo = returnTo;
    } else {
      delete (req.session as any).returnTo;
    }

    const proceed = () => {
      ensureStrategy(req.hostname);
      passport.authenticate(`replitauth:${req.hostname}`, {
        prompt: "login consent",
        scope: ["openid", "email", "profile", "offline_access"],
      })(req, res, next);
    };

    // Persist returnTo to the session store before the OAuth redirect
    // so it survives the round-trip to the identity provider.
    if (returnTo) {
      req.session.save((err) => {
        if (err) return next(err);
        proceed();
      });
    } else {
      proceed();
    }
  });

  app.get("/api/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, (err: any, user: any) => {
      if (err) return next(err);
      if (!user) return res.redirect("/api/login");

      const oldSessionData = { ...req.session } as any;
      delete oldSessionData.cookie;

      req.session.regenerate((regenerateErr) => {
        if (regenerateErr) return next(regenerateErr);

        Object.assign(req.session, oldSessionData);

        req.logIn(user, (loginErr) => {
          if (loginErr) return next(loginErr);

          const returnTo = (req.session as any).returnTo;
          delete (req.session as any).returnTo;

          req.session.save((saveErr) => {
            if (saveErr) return next(saveErr);
            res.redirect(returnTo || "/");
          });
        });
      });
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

// Per-session in-flight refresh promise cache to deduplicate concurrent
// refresh attempts that would otherwise invalidate rotated refresh tokens.
const inflightRefreshes = new Map<string, Promise<void>>();
const MAX_INFLIGHT_REFRESHES = 10_000;

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const sessionId = req.sessionID;

  try {
    let refreshPromise = inflightRefreshes.get(sessionId);
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const config = await getOidcConfig();
        const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
        updateUserSession(user, tokenResponse);
      })();
      if (inflightRefreshes.size < MAX_INFLIGHT_REFRESHES) {
        inflightRefreshes.set(sessionId, refreshPromise);
        // Suppress unhandled rejection on the cleanup chain; callers
        // handle errors via their own await + try/catch.
        refreshPromise.catch(() => {}).finally(() => inflightRefreshes.delete(sessionId));
      }
    }

    await refreshPromise;

    // Persist refreshed tokens to the session store.
    // resave is false, so we must explicitly re-serialize and save.
    const passport = (req.session as any).passport;
    if (passport) {
      passport.user = serializeUserPayload(user);
    }
    req.session.save((err) => {
      if (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[auth] Failed to save refreshed session:", msg);
        return res.status(500).json({ message: "Internal Server Error" });
      }
      return next();
    });
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
