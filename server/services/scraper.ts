import * as cheerio from "cheerio";
import { storage } from "../storage";
import { sendNotificationEmail } from "./email";
import { type Monitor } from "@shared/schema";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function fetchWithCurl(url: string): Promise<string> {
  try {
    // curl handles large headers better than Node.js fetch
    // -L follows redirects, -s is silent, -m is timeout
    const { stdout } = await execAsync(`curl -L -s -m 15 -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36" "${url}"`);
    return stdout;
  } catch (error) {
    console.error(`Curl fallback failed:`, error);
    throw error;
  }
}

export async function checkMonitor(monitor: Monitor): Promise<{ changed: boolean, currentValue: string | null }> {
  try {
    console.log(`Checking monitor ${monitor.id}: ${monitor.url}`);
    
    let html = "";
    try {
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
      html = await response.text();
    } catch (e: any) {
      if (e.code === 'UND_ERR_HEADERS_OVERFLOW' || (e.cause && e.cause.code === 'UND_ERR_HEADERS_OVERFLOW')) {
        console.log(`Header overflow for ${monitor.id}, falling back to curl...`);
        html = await fetchWithCurl(monitor.url);
      } else {
        throw e;
      }
    }

    if (!html) {
      return { changed: false, currentValue: null };
    }

    const $ = cheerio.load(html);
    
    let newValue: string | null = null;

    // Strategy 1: The user-defined CSS Selector
    const selector = monitor.selector.trim();
    // Prioritize direct classes if common patterns
    const isClassName = !selector.startsWith('.') && !selector.startsWith('#') && !selector.includes(' ');
    const effectiveSelector = isClassName ? `.${selector}` : selector;
    
    // Specifically handle Jomashop now-price which is often deeply nested or duplicated
    if (monitor.url.includes('jomashop.com') && (selector.includes('now-price') || selector.includes('price'))) {
      const jomaPrice = $('.now-price').first().text().trim() || 
                        $('.price').first().text().trim() ||
                        $('[itemprop="price"]').attr('content');
      if (jomaPrice && jomaPrice.includes('$')) {
        newValue = jomaPrice;
        console.log(`Found Jomashop price via specific override: "${newValue}"`);
      }
    }

    if (!newValue) {
      const element = $(effectiveSelector);
      if (element.length > 0) {
        // Try to find a child price first to avoid capturing title if selector is too broad
        const priceInElement = element.find('.now-price, .price, [itemprop="price"], .product-price').first();
        if (priceInElement.length > 0) {
          newValue = priceInElement.text().trim() || priceInElement.attr('content');
        }

        if (!newValue) {
          newValue = element.first().text().trim() || 
                     element.first().val() as string || 
                     element.first().attr('title') || 
                     element.first().attr('content') ||
                     element.first().attr('data-price') ||
                     null;
        }
        
        if (newValue) {
          console.log(`Found value via selector: "${newValue}"`);
          // Verification: If it looks like a title, we try regex extraction
          const pageTitle = $('title').text().trim();
          const ogTitle = $('meta[property="og:title"]').attr('content');
          if (newValue === pageTitle || newValue === ogTitle || newValue.length > 100) {
             const pricePattern = /\$[0-9,.]+/;
             const match = element.text().match(pricePattern);
             if (match) {
               newValue = match[0];
               console.log(`Extracted price from text via regex: "${newValue}"`);
             }
          }
        }
      }
    }

    // Strategy 2: Common Product Schema (JSON-LD)
    const pageTitle = $('title').text().trim();
    const ogTitle = $('meta[property="og:title"]').attr('content');
    const isTitleOnly = newValue && (
      newValue === pageTitle || 
      newValue === ogTitle ||
      newValue.length > 100
    );

    if (!newValue || isTitleOnly) {
      console.log("Value missing or appears to be title only, checking JSON-LD...");
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const content = $(el).html();
          if (!content) return true;
          const data = JSON.parse(content);
          const items = Array.isArray(data) ? data : [data];
          for (const item of items) {
            const val = item.offers?.price || 
                        item.offers?.[0]?.price || 
                        item.offers?.availability || 
                        item.price || 
                        item.name ||
                        (item['@type'] === 'Offer' ? item.price : null);
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

    // Strategy 2.5: Look for price in any script tag
    if (!newValue || isTitleOnly) {
      console.log("Checking all script tags for price patterns...");
      $('script').each((_, el) => {
        const content = $(el).html();
        if (!content) return true;
        
        // Jomashop and others often have a huge state object
        // We look for patterns like "price":3200 or "final_price":3200
        const patterns = [
          /"price"\s*:\s*"?([0-9.,]+)"?/i,
          /"final_price"\s*:\s*"?([0-9.,]+)"?/i,
          /"value"\s*:\s*([0-9.,]+)/i,
          /price\s*=\s*"?([0-9.,]+)"?/i
        ];

        for (const pattern of patterns) {
          const match = content.match(pattern);
          if (match && match[1]) {
            // Verify it's not a tiny number or huge number that's unlikely to be a price
            const val = match[1].replace(/,/g, '');
            const num = parseFloat(val);
            if (!isNaN(num) && num > 1 && num < 1000000) {
              newValue = `$${match[1]}`;
              console.log(`Found value via regex in script (${pattern}): "${newValue}"`);
              return false;
            }
          }
        }
        return true;
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
