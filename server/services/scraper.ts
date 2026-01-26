import axios from "axios";
import * as cheerio from "cheerio";
import { storage } from "../storage";
import { sendNotificationEmail } from "./email";
import { type Monitor } from "@shared/schema";

export async function checkMonitor(monitor: Monitor): Promise<{ changed: boolean, currentValue: string | null }> {
  try {
    console.log(`Checking monitor ${monitor.id}: ${monitor.url}`);
    
    // Attempt scraping with more advanced headers to bypass some static protections
    const response = await axios.get(monitor.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 30000,
      validateStatus: () => true
    });

    console.log(`Response status for ${monitor.url}: ${response.status}`);

    const $ = cheerio.load(response.data);
    
    // Check for common blocking indicators
    if (response.status === 403 || response.status === 429 || response.data.includes("Cloudflare") || response.data.includes("Access Denied")) {
      console.warn(`Access restricted for ${monitor.url} (Status ${response.status}). Potential bot detection.`);
      return { changed: false, currentValue: monitor.currentValue };
    }

    let newValue: string | null = null;

    // Primary: Use the selector
    const element = $(monitor.selector);
    if (element.length > 0) {
      newValue = element.first().text().trim() || element.first().val() as string || null;
      if (newValue) console.log(`Found value via selector for monitor ${monitor.id}: "${newValue}"`);
    }

    // Fallback 1: JSON-LD (Common for e-commerce)
    if (!newValue) {
      const scripts = $('script[type="application/ld+json"]');
      scripts.each((_, el) => {
        try {
          const data = JSON.parse($(el).html() || "");
          const items = Array.isArray(data) ? data : [data];
          for (const item of items) {
            const val = item.offers?.price || item.price || item.name || item.headline;
            if (val) {
              newValue = String(val);
              console.log(`Found value in JSON-LD for monitor ${monitor.id}: "${newValue}"`);
              return false; // break each
            }
          }
        } catch (e) {}
        return !newValue;
      });
    }

    // Fallback 2: Meta Tags
    if (!newValue) {
      newValue = $('meta[property="og:price:amount"]').attr('content') || 
                 $('meta[name="twitter:data1"]').attr('content') ||
                 $('meta[property="og:title"]').attr('content') || null;
      if (newValue) console.log(`Found value in meta tags for monitor ${monitor.id}: "${newValue}"`);
    }

    // Fallback 3: preload_data (Jomashop specific)
    if (!newValue && response.data.includes('id="preload_data"')) {
      try {
        const preloadScript = $('#preload_data').html();
        if (preloadScript) {
           const data = JSON.parse(preloadScript);
           if (data?.product?.final_price) {
             newValue = String(data.product.final_price);
             console.log(`Found value in preload_data for monitor ${monitor.id}: "${newValue}"`);
           }
        }
      } catch (e) {}
    }

    const oldValue = monitor.currentValue;
    const changed = newValue !== null && newValue !== oldValue;

    if (newValue === null) {
      console.warn(`Scraping failed to find any value for monitor ${monitor.id}. Page content length: ${response.data.length}`);
    }

    // Update last checked
    await storage.updateMonitor(monitor.id, {
      lastChecked: new Date(),
      currentValue: newValue ?? (oldValue || undefined)
    });

    if (changed) {
      console.log(`Change detected for monitor ${monitor.id}! Old: ${oldValue}, New: ${newValue}`);
      await storage.addMonitorChange(monitor.id, oldValue, newValue);
      await storage.updateMonitor(monitor.id, { lastChanged: new Date() });

      if (monitor.emailEnabled) {
        await sendNotificationEmail(monitor, oldValue, newValue);
      }
    }

    return { changed, currentValue: newValue };

  } catch (error) {
    console.error(`Error checking monitor ${monitor.id}:`, error);
    return { changed: false, currentValue: null };
  }
}
