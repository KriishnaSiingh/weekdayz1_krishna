/**
 * Transactional email helpers.
 * If RESEND_API_KEY is set, emails are sent via Resend.
 * Otherwise they are logged to console (dev/CI mode).
 */

import { formatEstimatedDeliveryDate, getDtdcTrackingUrl } from "./shipping";
import { escapeHtml } from "./security";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

async function sendEmail(payload: EmailPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email stub] To: ${payload.to} | Subject: ${payload.subject}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "Weekdayzz <no-reply@weekdayz.in>",
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[email] Failed to send: ${body}`);
  }
}

function formatRupees(cents: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(cents / 100);
}

export const sendWelcomeEmail = createServerFn({ method: "POST" })
  .validator((data) => z.object({
    email: z.string().email().max(255),
    name: z.string().max(100).optional(),
  }).parse(data))
  .handler(async ({ data }) => {
    const safeName = escapeHtml(data.name?.trim() || "there");

    await sendEmail({
      to: data.email,
      subject: "Welcome to Weekdayzz",
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#111">
          <div style="background:#111;color:#fff;padding:28px;text-align:center">
            <div style="font-size:22px;font-weight:900;letter-spacing:.15em">WEEKDAYZZ</div>
          </div>
          <div style="padding:36px 28px">
            <h1 style="font-size:28px;margin:0 0 14px">Welcome, ${safeName}.</h1>
            <p style="font-size:16px;line-height:1.6;color:#444">Your Weekdayzz account is ready. Explore the latest drops, save your favourites, and make something your own in Creator Studio.</p>
            <a href="${process.env.VITE_SITE_URL ?? "https://weekdayzz.in"}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 24px;font-weight:700;margin-top:12px">Shop the latest drops</a>
          </div>
          <div style="border-top:1px solid #eee;padding:20px 28px;color:#888;font-size:12px">Weekdayzz · Built for the always-online generation</div>
        </div>
      `,
    });

    return { sent: true };
  });

export async function sendOrderConfirmation(
  to: string,
  orderId: string,
  totalCents: number,
  estimatedDeliveryDate?: string
): Promise<void> {
  const deliveryStatus = estimatedDeliveryDate
    ? formatEstimatedDeliveryDate(estimatedDeliveryDate)
    : "Arrives in 3–5 business days";

  const safeOrderId = escapeHtml(orderId.slice(0, 8).toUpperCase());
  const safeDeliveryStatus = escapeHtml(deliveryStatus);
  const trackOrderUrl = `${process.env.VITE_SITE_URL ?? "https://weekdayzz.in"}/account?tab=orders`;

  await sendEmail({
    to,
    subject: `Order Confirmed ✅ — #${safeOrderId} | Weekdayzz`,
    html: `
      <!DOCTYPE html>
      <html>
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
        <body style="margin:0;padding:0;background:#f4f4f4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0">
            <tr><td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
                
                <!-- Header -->
                <tr><td style="background:#111111;padding:28px 40px;text-align:center">
                  <p style="margin:0;font-size:22px;font-weight:900;letter-spacing:0.15em;color:#ffffff;text-transform:uppercase">WEEKDAYZZ</p>
                  <p style="margin:6px 0 0;font-size:11px;color:#aaaaaa;letter-spacing:0.2em;text-transform:uppercase">Built for the always-online generation</p>
                </td></tr>

                <!-- Hero Banner -->
                <tr><td style="background:#111111;padding:0 40px 28px;text-align:center">
                  <p style="margin:0;font-size:38px">✅</p>
                  <h1 style="margin:8px 0 4px;font-size:26px;font-weight:900;color:#ffffff;letter-spacing:-0.5px">Order Confirmed!</h1>
                  <p style="margin:0;font-size:14px;color:#aaaaaa">We've received your order and are getting it ready.</p>
                </td></tr>

                <!-- Order Summary -->
                <tr><td style="padding:32px 40px">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:16px;background:#f9f9f9;border:1px solid #eeeeee;border-radius:6px">
                        <table width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.1em;font-weight:600">Order ID</td>
                            <td align="right" style="font-size:15px;font-weight:900;color:#111;letter-spacing:0.05em">#${safeOrderId}</td>
                          </tr>
                          <tr><td colspan="2" style="height:10px"></td></tr>
                          <tr>
                            <td style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.1em;font-weight:600">Amount Paid</td>
                            <td align="right" style="font-size:15px;font-weight:900;color:#111">${formatRupees(totalCents)}</td>
                          </tr>
                          <tr><td colspan="2" style="height:10px"></td></tr>
                          <tr>
                            <td style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.1em;font-weight:600">Delivery</td>
                            <td align="right" style="font-size:13px;font-weight:700;color:#16a34a">${safeDeliveryStatus}</td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td></tr>

                <!-- Track Your Order Button -->
                <tr><td style="padding:0 40px 32px;text-align:center">
                  <p style="margin:0 0 16px;font-size:14px;color:#555">You'll receive another email when your order ships with a tracking link. Until then, you can track status from your account.</p>
                  <a href="${trackOrderUrl}" target="_blank" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-size:13px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;padding:14px 36px;border-radius:4px">
                    Track Your Order →
                  </a>
                </td></tr>

                <!-- Divider -->
                <tr><td style="padding:0 40px"><hr style="border:none;border-top:1px solid #eeeeee;margin:0"></td></tr>

                <!-- Footer -->
                <tr><td style="padding:24px 40px;text-align:center">
                  <p style="margin:0 0 6px;font-size:12px;color:#888">Questions? Reply to this email or reach us at <a href="mailto:support@weekdayzz.in" style="color:#111;font-weight:600">support@weekdayzz.in</a></p>
                  <p style="margin:0;font-size:11px;color:#aaa">© ${new Date().getFullYear()} Weekdayzz · Lucknow, India</p>
                </td></tr>

              </table>
            </td></tr>
          </table>
        </body>
      </html>
    `,
  });
}


export async function sendShipped(
  to: string,
  orderId: string,
  trackingId: string
): Promise<void> {
  const safeOrderId = escapeHtml(orderId.slice(0, 8).toUpperCase());
  const safeTrackingId = escapeHtml(trackingId);
  const trackingUrl = getDtdcTrackingUrl(trackingId);

  await sendEmail({
    to,
    subject: `Your order shipped — Track #${safeTrackingId}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h1 style="font-size:28px;margin-bottom:8px">It's on its way 📦</h1>
        <p>Order <strong>#${safeOrderId}</strong> has shipped via DTDC Express.</p>
        <p>Tracking ID: <strong>${safeTrackingId}</strong></p>
        <p style="margin:16px 0;">
          <a href="${trackingUrl}" target="_blank" style="background-color:#000;color:#fff;padding:12px 24px;text-decoration:none;font-weight:bold;display:inline-block;">Track on DTDC</a>
        </p>
        <p style="color:#888">Should arrive in 5–7 business days.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="font-size:12px;color:#888">Weekdayzz · Built for the always-online generation</p>
      </div>
    `,
  });
}

export async function sendDelivered(
  to: string,
  orderId: string
): Promise<void> {
  const safeOrderId = escapeHtml(orderId.slice(0, 8).toUpperCase());
  await sendEmail({
    to,
    subject: `Delivered! Order #${safeOrderId}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h1 style="font-size:28px;margin-bottom:8px">Delivered 🎉</h1>
        <p>Order <strong>#${safeOrderId}</strong> has been delivered. Hope you love it!</p>
        <p>Drop a review — it means the world to us.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="font-size:12px;color:#888">Weekdayzz · Built for the always-online generation</p>
      </div>
    `,
  });
}
