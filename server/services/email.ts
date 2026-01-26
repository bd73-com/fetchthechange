import nodemailer from "nodemailer";
import { type Monitor } from "@shared/schema";
import { authStorage } from "../replit_integrations/auth/storage";

// Create transporter
// If no env vars, it will fail to send but we catch errors.
// Replit doesn't provide SMTP by default, user must provide.
// Or we can use a built-in Replit email service if available (none standard yet besides external connectors).

export async function sendNotificationEmail(monitor: Monitor, oldValue: string | null, newValue: string | null) {
  if (!process.env.SMTP_HOST) {
    console.log("SMTP_HOST not set. Skipping email.");
    console.log(`[MOCK EMAIL] To: User of Monitor ${monitor.id}`);
    console.log(`[MOCK EMAIL] Subject: Change detected on ${monitor.name}`);
    console.log(`[MOCK EMAIL] Body: Value changed from "${oldValue}" to "${newValue}"`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  try {
    const user = await authStorage.getUser(monitor.userId);
    if (!user || !user.email) {
      console.log(`User ${monitor.userId} has no email. Skipping.`);
      return;
    }

    await transporter.sendMail({
      from: process.env.SMTP_FROM || '"Web Monitor" <noreply@example.com>',
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
    console.log(`Email sent to ${user.email} for monitor ${monitor.id}`);
  } catch (error) {
    console.error("Error sending email:", error);
  }
}
