import { db } from "../db";
import { errorLogs } from "@shared/schema";

type LogLevel = "error" | "warning" | "info";
type LogSource = "scraper" | "email" | "api" | "scheduler" | "stripe";

const SENSITIVE_KEYS = ["password", "token", "apikey", "api_key", "secret", "authorization", "cookie", "session"];

function sanitizeContext(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj.length > 1000 ? obj.substring(0, 1000) + "...[truncated]" : obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeContext);

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.some(s => key.toLowerCase().includes(s))) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = sanitizeContext(value);
    }
  }
  return sanitized;
}

export class ErrorLogger {
  static async log(
    level: LogLevel,
    source: LogSource,
    message: string,
    error?: Error | null,
    context?: Record<string, any> | null
  ): Promise<void> {
    const prefix = `[${level.toUpperCase()}][${source}]`;
    const logMsg = `${prefix} ${message}`;

    if (level === "error") {
      console.error(logMsg, error?.message || "");
    } else if (level === "warning") {
      console.warn(logMsg);
    } else {
      console.log(logMsg);
    }

    try {
      await db.insert(errorLogs).values({
        level,
        source,
        message,
        errorType: error?.constructor?.name || null,
        stackTrace: error?.stack || null,
        context: context ? sanitizeContext(context) : null,
      });
    } catch (dbError) {
      console.error(`[ErrorLogger] Failed to write log to database:`, dbError);
    }
  }

  static async error(source: LogSource, message: string, error?: Error | null, context?: Record<string, any> | null) {
    return ErrorLogger.log("error", source, message, error, context);
  }

  static async warning(source: LogSource, message: string, context?: Record<string, any> | null) {
    return ErrorLogger.log("warning", source, message, null, context);
  }

  static async info(source: LogSource, message: string, context?: Record<string, any> | null) {
    return ErrorLogger.log("info", source, message, null, context);
  }
}
