import * as cheerio from "cheerio";
import { storage } from "../storage";
import { sendNotificationEmail } from "./email";
import { type Monitor } from "@shared/schema";

export async function checkMonitor(monitor: Monitor): Promise<{ changed: boolean, currentValue: string | null }> {
  try {
    console.log(`Checking monitor ${monitor.id}: ${monitor.url}`);
    
    // Using native fetch which is more resilient to "Header Overflow" than axios
    const response = await fetch(monitor.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      },
      signal: AbortSignal.timeout(20000)
    });

    console.log(`Response status for ${monitor.url}: ${response.status}`);
    
    if (!response.ok && response.status !== 403) {
      console.warn(`Fetch failed with status ${response.status}`);
    }

    // Strategy 4: Fallback to a proxy or simpler request if needed
    // In this environment, we can't easily change global maxHeaderSize for fetch/undici
    // but we can try to use axios with a specific configuration if fetch fails
    // However, let's try to improve the fetch call first by reducing requested headers
    // and potentially using a different dispatcher if we were in a full node env.
    // Since we are limited, we will try to catch the header overflow and return a helpful message.
    
    let html = "";
    try {
      html = await response.text();
    } catch (e: any) {
      if (e.code === 'UND_ERR_HEADERS_OVERFLOW') {
        console.error("Header overflow detected. Site sent too much data in headers.");
        // Fallback: If we can't get the HTML, we can't scrape.
        // We'll return a special value to indicate the failure reason to the user indirectly
        return { changed: false, currentValue: "Error: Site blocked request (Header Overflow)" };
      }
      throw e;
    }
    
    const $ = cheerio.load(html);
    
    let newValue: string | null = null;

    // Strategy 1: The user-defined CSS Selector
    const element = $(monitor.selector);
    if (element.length > 0) {
      // Try text, then val, then title attribute
      newValue = element.first().text().trim() || 
                 element.first().val() as string || 
                 element.first().attr('title') || 
                 null;
      if (newValue) console.log(`Found value via selector: "${newValue}"`);
    }

    // Strategy 2: Common Product Schema (JSON-LD)
    if (!newValue) {
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const content = $(el).html();
          if (!content) return true;
          const data = JSON.parse(content);
          const items = Array.isArray(data) ? data : [data];
          for (const item of items) {
            // Expanded search for price or inventory status
            const val = item.offers?.price || 
                        item.offers?.[0]?.price || 
                        item.offers?.availability || 
                        item.price || 
                        item.name;
            if (val) {
              newValue = String(val);
              console.log(`Found value via JSON-LD: "${newValue}"`);
              return false;
            }
          }
        } catch (e) {}
        return !newValue;
      });
    }

    // Strategy 3: Meta Tags & Title
    if (!newValue) {
      newValue = $('meta[property="og:price:amount"]').attr('content') || 
                 $('meta[name="twitter:data1"]').attr('content') ||
                 $('meta[property="og:title"]').attr('content') ||
                 $('title').text().trim() || 
                 null;
      if (newValue) console.log(`Found value via Meta/Title: "${newValue}"`);
    }

    const oldValue = monitor.currentValue;
    const changed = newValue !== null && newValue !== oldValue;

    // Update the monitor in storage regardless of change
    await storage.updateMonitor(monitor.id, {
      lastChecked: new Date(),
      currentValue: newValue ?? (oldValue || undefined)
    });

    if (changed) {
      console.log(`Change detected for monitor ${monitor.id}!`);
      await storage.addMonitorChange(monitor.id, oldValue, newValue);
      await storage.updateMonitor(monitor.id, { lastChanged: new Date() });

      if (monitor.emailEnabled) {
        await sendNotificationEmail(monitor, oldValue, newValue);
      }
    }

    return { changed, currentValue: newValue };

  } catch (error) {
    console.error(`Scraping error for monitor ${monitor.id}:`, error);
    return { changed: false, currentValue: null };
  }
}
