const BOT_PROTECTED_EXACT_HOSTS = new Set([
  "jomashop.com", "watchuseek.com", "chrono24.com", "farfetch.com",
  "ssense.com", "mytheresa.com",
  "dekk365.no", "finn.no", "komplett.no", "elkjop.no", "power.no", "cdon.com",
  "amazon.com", "amazon.co.uk", "amazon.de", "amazon.fr", "amazon.co.jp",
  "ebay.com", "etsy.com",
  "ticketmaster.com", "livenation.com", "axs.com",
]);

const BOT_PROTECTED_HOST_SUBSTRINGS = ["shopify", "bigcommerce", "salesforce"];

const WARNING_MESSAGE =
  "This site uses bot protection that may block automated monitoring. " +
  "The monitor will still be created and will attempt to extract the value using a real browser — " +
  "but some sites reliably block all automated access regardless of technique.";

export function detectBotProtectedUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (BOT_PROTECTED_EXACT_HOSTS.has(hostname)) return WARNING_MESSAGE;
    if (BOT_PROTECTED_HOST_SUBSTRINGS.some((s) => hostname.includes(s))) return WARNING_MESSAGE;
    return null;
  } catch {
    return null;
  }
}
