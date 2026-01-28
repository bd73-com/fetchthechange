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

    // Strategy 1: Specific overrides for high-value targets
    if (monitor.url.includes('jomashop.com')) {
      console.log("Applying Jomashop-specific scraping logic...");
      
      // 1. Check for specific scripts that Jomashop uses for product state
      $('script').each((_, el) => {
        const content = $(el).html();
        if (!content || !content.includes('price')) return true;
        
        // Match specific patterns in Jomashop's state objects
        const match = content.match(/"final_price"\s*:\s*([0-9.]+)/i) || 
                      content.match(/"price"\s*:\s*"?([0-9.]+)"?/i) ||
                      content.match(/"current_price"\s*:\s*([0-9.]+)/i);
        
        if (match && match[1]) {
          const val = match[1];
          if (!isNaN(parseFloat(val)) && val.length < 10 && parseFloat(val) > 1) {
            newValue = `$${val}`;
            console.log(`Found Jomashop price via state script: "${newValue}"`);
            return false;
          }
        }
        return true;
      });

      // 2. Scan all elements for text that looks like a watch price ($1,000.00 style)
      if (!newValue) {
        $('*').each((_, el) => {
          const text = $(el).text().trim();
          // Jomashop price usually has $ and is relatively short
          if (text.length < 15 && text.includes('$')) {
            const priceMatch = text.match(/\$[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?/);
            if (priceMatch) {
              const numVal = parseFloat(priceMatch[0].replace(/[$,]/g, ''));
              // Exclude MSRP/Retail if we can (usually higher) or just take first reasonable
              if (numVal > 100 && numVal < 100000) {
                newValue = priceMatch[0];
                console.log(`Found Jomashop price via text search: "${newValue}"`);
                return false;
              }
            }
          }
          return true;
        });
      }

      // 3. Last resort: check meta tags explicitly
      if (!newValue) {
        newValue = $('meta[property="og:price:amount"]').attr('content') || 
                   $('meta[itemprop="price"]').attr('content') ||
                   $('meta[name="twitter:data1"]').attr('content');
        if (newValue && !newValue.includes('$')) newValue = `$${newValue}`;
      }
    }

    if (!newValue) {
      // Original selector logic...
      const selector = monitor.selector.trim();
      const isClassName = !selector.startsWith('.') && !selector.startsWith('#') && !selector.includes(' ');
      const effectiveSelector = isClassName ? `.${selector}` : selector;
      const element = $(effectiveSelector);
      
      if (element.length > 0) {
        // Try to find a child price first
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
          const pageTitle = $('title').text().trim();
          const ogTitle = $('meta[property="og:title"]').attr('content');
          if (newValue === pageTitle || newValue === ogTitle || newValue.length > 80) {
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
