import type { Request, Response, NextFunction } from "express";
import { verify } from "../utils/extensionToken";

export interface ExtensionUser {
  id: string;
  tier: string;
}

declare global {
  namespace Express {
    interface Request {
      extensionUser?: ExtensionUser;
    }
  }
}

export function extensionAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: "Invalid or expired extension token",
      code: "INVALID_EXTENSION_TOKEN",
    });
    return;
  }

  const token = authHeader.slice(7);
  const result = verify(token);
  if (!result) {
    console.warn("Extension token verification failed");
    res.status(401).json({
      error: "Invalid or expired extension token",
      code: "INVALID_EXTENSION_TOKEN",
    });
    return;
  }

  req.extensionUser = { id: result.userId, tier: result.tier };
  next();
}
