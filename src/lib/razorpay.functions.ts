import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import Razorpay from "razorpay";
import crypto from "crypto";
import { checkRateLimit } from "./rate-limiter";

function getRazorpayInstance() {
  // Only read server-side env vars — never VITE_ prefixed vars which would leak into the client bundle
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("Missing Razorpay API credentials.");
  }

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
}

const CreateRazorpayOrderSchema = z.object({
  amount_cents: z.number().int().positive().max(100000000), // Max ₹10,00,000 safety boundary
  items: z
    .array(
      z.object({
        product_id: z.string().uuid().nullable().optional(),
        quantity: z.number().int().positive().max(100),
        unit_price_cents: z.number().int().nonnegative(),
      })
    )
    .optional(),
});

/**
 * Returns the Razorpay publishable key_id to the authenticated frontend.
 * This keeps the key out of the JS bundle while still being available at runtime.
 */
export const getPaymentConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    if (!keyId) {
      throw new Error("Payment service is not configured.");
    }
    return { keyId };
  });

/**
 * Creates a Razorpay Order on the backend with rate-limiting & price verification.
 */
export const createRazorpayOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => CreateRazorpayOrderSchema.parse(data))
  .handler(async ({ data, context }) => {
    // 1. Rate Limiting: Max 100 order initiation attempts per 60 seconds per user
    checkRateLimit(
      `razorpay_order_${context.userId}`,
      100,
      60 * 1000,
      "Too many payment initialization attempts. Please wait a minute before trying again."
    );

    // 2. Server-side price validation if items are passed
    if (data.items && data.items.length > 0) {
      const dbProductIds = data.items.map((i) => i.product_id).filter(Boolean) as string[];
      if (dbProductIds.length > 0) {
        const { data: dbProds } = await context.supabase
          .from("products")
          .select("id, price_cents")
          .in("id", dbProductIds);
        
        const priceMap = new Map((dbProds ?? []).map((p) => [p.id, p.price_cents]));

        for (const item of data.items) {
          if (item.product_id && priceMap.has(item.product_id)) {
            const expectedPrice = priceMap.get(item.product_id)!;
            if (item.unit_price_cents !== expectedPrice) {
              throw new Error("Security Alert: Product price discrepancy detected. Payment initialization rejected.");
            }
          }
        }
      }
    }

    try {
      const razorpay = getRazorpayInstance();
      const options = {
        amount: data.amount_cents, // Razorpay amount in paise
        currency: "INR",
        receipt: `receipt_${crypto.randomUUID().slice(0, 10)}`,
        notes: {
          userId: context.userId,
          orderData: JSON.stringify({
            total_cents: data.amount_cents,
            items: data.items,
          }),
        },
      };

      const order = await razorpay.orders.create(options);
      return {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
      };
    } catch (error) {
      console.error("Razorpay order creation failed:", error);
      throw new Error(error instanceof Error ? error.message : "Failed to initiate Razorpay order");
    }
  });

/**
 * Verifies Razorpay payment signature authenticity using timing-safe comparison.
 */
export function verifySignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): boolean {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    throw new Error("Missing RAZORPAY_KEY_SECRET environment variable");
  }

  const generatedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(generatedSignature, "utf-8"),
      Buffer.from(razorpaySignature, "utf-8")
    );
  } catch (_) {
    return false;
  }
}

/**
 * Verifies a Razorpay Webhook signature.
 * @param body Raw request body string
 * @param signature Signature from X-Razorpay-Signature header
 */
export function verifyWebhookSignature(body: string, signature: string): boolean {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("Missing RAZORPAY_WEBHOOK_SECRET environment variable");
  }

  const hmac = crypto.createHmac("sha256", webhookSecret);
  hmac.update(body);
  const expectedSignature = hmac.digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "utf-8"),
      Buffer.from(signature, "utf-8")
    );
  } catch (_) {
    return false;
  }
}
