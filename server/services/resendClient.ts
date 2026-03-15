import { Resend } from "resend";

/** Singleton Resend client — reuses HTTP connections across all email sends. */
let instance: Resend | null = null;

export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!instance) {
    instance = new Resend(apiKey);
  }
  return instance;
}
