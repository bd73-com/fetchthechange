import { resolve4, resolve6 } from 'dns/promises';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
  'metadata',
]);

export function isPrivateIp(ip: string): boolean {
  if (/^10\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^127\./.test(ip)) return true;
  if (/^0\./.test(ip) || ip === '0.0.0.0') return true;
  if (/^(fc00|fd|fe80)/i.test(ip)) return true;
  if (ip === '::1') return true;
  return false;
}

export async function isPrivateUrl(urlString: string): Promise<string | null> {
  try {
    const parsed = new URL(urlString);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return "Only http and https URLs are allowed";
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (BLOCKED_HOSTNAMES.has(hostname)) {
      return "This hostname is not allowed";
    }

    if (hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost')) {
      return "Internal hostnames are not allowed";
    }

    if (isPrivateIp(hostname)) {
      return "Private or internal IP addresses are not allowed";
    }

    try {
      const ips: string[] = [];
      try { ips.push(...await resolve4(hostname)); } catch {}
      try { ips.push(...await resolve6(hostname)); } catch {}

      if (ips.length === 0) {
        return "Could not resolve hostname";
      }

      for (const ip of ips) {
        if (isPrivateIp(ip)) {
          return "This URL resolves to a private or internal address";
        }
      }
    } catch {
      return "Could not verify hostname";
    }

    return null;
  } catch {
    return "Invalid URL format";
  }
}

/**
 * Validates a URL against SSRF at fetch time (closes TOCTOU gap).
 * Throws if the URL resolves to a private/internal address.
 */
export async function validateUrlBeforeFetch(urlString: string): Promise<void> {
  const error = await isPrivateUrl(urlString);
  if (error) {
    throw new Error(`SSRF blocked: ${error}`);
  }
}
