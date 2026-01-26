import { Resend } from "resend";
import { type Monitor } from "@shared/schema";
import { authStorage } from "../replit_integrations/auth/storage";

export async function sendNotificationEmail(monitor: Monitor, oldValue: string | null, newValue: string | null) {
  if (!process.env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set. Skipping email.");
    console.log(`[MOCK EMAIL] To: User of Monitor ${monitor.id}`);
    console.log(`[MOCK EMAIL] Subject: Change detected on ${monitor.name}`);
    console.log(`[MOCK EMAIL] Body: Value changed from "${oldValue}" to "${newValue}"`);
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const user = await authStorage.getUser(monitor.userId);
    if (!user || !user.email) {
      console.log(`User ${monitor.userId} has no email. Skipping.`);
      return;
    }

    await resend.emails.send({
      from: process.env.RESEND_FROM || 'onboarding@resend.dev',
      to: user.email,
      subject: `Change detected: ${monitor.name}`,
      text: `
        Hello,

        A change was detected on your monitored page: ${monitor.name}
        URL: ${monitor.url}

        Old Value: ${oldValue}
        New Value: ${newValue}

        Check your dashboard for more details.
      `,
      html: `
        <h2>Change Detected</h2>
        <p><strong>Monitor:</strong> ${monitor.name}</p>
        <p><strong>URL:</strong> <a href="${monitor.url}">${monitor.url}</a></p>
        <hr/>
        <p><strong>Old Value:</strong></p>
        <pre>${oldValue}</pre>
        <p><strong>New Value:</strong></p>
        <pre>${newValue}</pre>
        <hr/>
        <p><a href="https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co">View Dashboard</a></p>
      `
    });
    console.log(`Email sent to ${user.email} for monitor ${monitor.id} via Resend`);
  } catch (error) {
    console.error("Error sending email via Resend:", error);
  }
}
