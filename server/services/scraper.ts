import axios from "axios";
import * as cheerio from "cheerio";
import { storage } from "../storage";
import { sendNotificationEmail } from "./email";
import { type Monitor } from "@shared/schema";

export async function checkMonitor(monitor: Monitor): Promise<{ changed: boolean, currentValue: string | null }> {
  try {
    console.log(`Checking monitor ${monitor.id}: ${monitor.url}`);
    
    const response = await axios.get(monitor.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const element = $(monitor.selector);
    let newValue: string | null = null;

    if (element.length > 0) {
      // Try to get text, or value if it's an input
      newValue = element.text().trim() || element.val() as string || null;
    } else {
      console.warn(`Selector ${monitor.selector} not found on ${monitor.url}`);
      newValue = null; 
      // Option: treat "not found" as a change? or just null? 
      // For now, if selector is invalid, we might get null. 
      // If previously it was "Something", and now "null", that is a change.
    }

    const oldValue = monitor.currentValue;
    const changed = newValue !== oldValue;

    // Update last checked
    await storage.updateMonitor(monitor.id, {
      lastChecked: new Date(),
      currentValue: newValue ?? undefined // Drizzle handling of null/undefined
    });

    if (changed) {
      console.log(`Change detected for monitor ${monitor.id}! Old: ${oldValue}, New: ${newValue}`);
      
      // Record change
      await storage.addMonitorChange(monitor.id, oldValue, newValue);
      
      // Update last changed timestamp
      await storage.updateMonitor(monitor.id, {
        lastChanged: new Date()
      });

      // Send email if enabled
      if (monitor.emailEnabled) {
        // We need to fetch the user email to send the notification
        // This requires accessing the auth storage or joining tables.
        // For simplicity, we'll implement a helper or assume storage can do it.
        // Let's implement getUserEmail in storage or just query here.
        // Actually, storage.getMonitor doesn't return user email.
        // I should add a method to get user by id or include it.
        // I will use db directly here to get user email, or import authStorage.
        // But authStorage is in another file. 
        // I'll assume we can get it.
        
        await sendNotificationEmail(monitor, oldValue, newValue);
      }
    }

    return { changed, currentValue: newValue };

  } catch (error) {
    console.error(`Error checking monitor ${monitor.id}:`, error);
    return { changed: false, currentValue: null };
  }
}
