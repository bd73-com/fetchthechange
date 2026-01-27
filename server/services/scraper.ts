import axios from "axios";
import * as cheerio from "cheerio";
import { storage } from "../storage";
import { sendNotificationEmail } from "./email";
import { type Monitor } from "@shared/schema";

async function fetchWithPuppeteer(url: string): Promise<string> {
  const puppeteer = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const content = await page.content();
    return content;
  } finally {
    await browser.close();
  }
}

export async function checkMonitor(monitor: Monitor): Promise<{ changed: boolean, currentValue: string | null }> {
  try {
    console.log(`Checking monitor ${monitor.id}: ${monitor.url}`);
    
    let html: string;
    let status = 200;

    try {
      const response = await axios.get(monitor.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.google.com/',
        },
        timeout: 10000,
        validateStatus: () => true
      });
      html = response.data;
      status = response.status;
      
      if (status !== 200 || html.includes("Cloudflare") || html.length < 5000) {
        console.log(`Axios failed or blocked for ${monitor.url} (${status}). Trying Puppeteer...`);
        html = await fetchWithPuppeteer(monitor.url);
      }
    } catch (err) {
      console.log(`Axios error for ${monitor.url}, trying Puppeteer...`);
      html = await fetchWithPuppeteer(monitor.url);
    }

    const $ = cheerio.load(html);
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
              return false;
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

    const oldValue = monitor.currentValue;
    const changed = newValue !== null && newValue !== oldValue;

    if (newValue === null) {
      console.warn(`Scraping failed to find any value for monitor ${monitor.id}. Page content length: ${html.length}`);
    }

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
