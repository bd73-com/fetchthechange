import { db } from "../db";
import { errorLogs } from "@shared/schema";

type LogLevel = "error" | "warning" | "info";
type LogSource = "scraper" | "email" | "api" | "scheduler" | "stripe";

const SENSITIVE_KEYS = [
  "password", "token", "apikey", "api_key", "secret", "authorization",
  "cookie", "session", "credential", "private_key", "privatekey",
  "access_key", "accesskey", "connection_string", "connectionstring",
  "database_url", "databaseurl", "dsn", "bearer",
];

const SENSITIVE_VALUE_PATTERNS = [
  /postgres(ql)?:\/\/[^\s"']+/gi,
  /mysql:\/\/[^\s"']+/gi,
  /mongodb(\+srv)?:\/\/[^\s"']+/gi,
  /redis:\/\/[^\s"']+/gi,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\b(sk|pk|rk|whsec)[-_](?:live|test)[-_][A-Za-z0-9]{10,}\b/g,
  /\bre_[A-Za-z0-9]{10,}\b/g,
  /\bghp_[A-Za-z0-9]{36,}\b/g,
  /\bxox[bprsao]-[A-Za-z0-9\-]{10,}\b/g,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
];

function sanitizeString(str: string): string {
  let result = str;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, "[REDACTED]");
  }
  return result.length > 1000 ? result.substring(0, 1000) + "...[truncated]" : result;
}

function sanitizeContext(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return sanitizeString(obj);
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
        message: sanitizeString(message),
        errorType: error?.constructor?.name || null,
        stackTrace: error?.stack ? sanitizeString(error.stack) : null,
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
