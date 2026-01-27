import axios from "axios";
import * as cheerio from "cheerio";
import { storage } from "../storage";
import { sendNotificationEmail } from "./email";
import { type Monitor } from "@shared/schema";

export async function checkMonitor(monitor: Monitor): Promise<{ changed: boolean, currentValue: string | null }> {
  try {
    console.log(`Checking monitor ${monitor.id}: ${monitor.url}`);
    
    // Using a more robust User-Agent and common headers to avoid simple bot detection
    const response = await axios.get(monitor.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      timeout: 15000,
      validateStatus: (status) => status < 500
    });

    console.log(`Response status for ${monitor.url}: ${response.status}`);
    const html = response.data;
    const $ = cheerio.load(html);
    
    let newValue: string | null = null;

    // Strategy 1: The user-defined CSS Selector
    const element = $(monitor.selector);
    if (element.length > 0) {
      newValue = element.first().text().trim() || element.first().attr('value') || null;
      if (newValue) console.log(`Found value via selector: "${newValue}"`);
    }

    // Strategy 2: Common Product Schema (JSON-LD)
    if (!newValue) {
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const data = JSON.parse($(el).html() || "");
          const items = Array.isArray(data) ? data : [data];
          for (const item of items) {
            // Looking for price, availability, or title
            const val = item.offers?.price || item.offers?.[0]?.price || item.price || item.name;
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

    // Strategy 3: Meta Tags (og:price:amount, og:title, etc.)
    if (!newValue) {
      newValue = $('meta[property="og:price:amount"]').attr('content') || 
                 $('meta[name="twitter:data1"]').attr('content') ||
                 $('meta[property="og:title"]').attr('content') ||
                 $('title').text().trim() || null;
      if (newValue) console.log(`Found value via Meta tags: "${newValue}"`);
    }

    const oldValue = monitor.currentValue;
    const changed = newValue !== null && newValue !== oldValue;

    // Always update last checked
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
