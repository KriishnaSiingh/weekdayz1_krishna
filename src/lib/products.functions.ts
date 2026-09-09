import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { getFallbackProductBySlug, getFallbackProducts, fetchStorageCustomProducts } from "@/lib/fallback-data";
import { getPublicClient } from "@/lib/supabase-server";

export const listProducts = createServerFn({ method: "GET" }).handler(async () => {
  const storageProductsPromise = fetchStorageCustomProducts();
  try {
    const supabase = getPublicClient();
    const [{ data, error }] = await Promise.all([
      supabase
        .from("products")
        .select("id, slug, title, description, price_cents, compare_at_price_cents, inventory_count, image_urls, sizes, colors, category")
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
      storageProductsPromise,
    ]);
    if (error) throw new Error(error.message);
    
    const dbProducts = (data ?? []).map((p) => {
      if (!p.image_urls || p.image_urls.length === 0 || (p.image_urls.length === 1 && !p.image_urls[0])) {
        const fallback = getFallbackProductBySlug(p.slug);
        if (fallback && fallback.image_urls && fallback.image_urls.length > 0) {
          return { ...p, image_urls: fallback.image_urls };
        }
      }
      return p;
    });

    // If database returned products, return them directly
    if (dbProducts.length > 0) {
      return dbProducts;
    }

    return getFallbackProducts();
  } catch (error) {
    console.warn("Falling back to local product data:", error);
    return getFallbackProducts();
  }
});

export const getProductBySlug = createServerFn({ method: "GET" })
  .validator((data) => z.object({ slug: z.string() }).parse(data))
  .handler(async ({ data }) => {
    const rawSlug = data.slug;
    const decodedSlug = decodeURIComponent(rawSlug).trim();
    const cleanSlug = decodedSlug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    const storageProductsPromise = fetchStorageCustomProducts();

    // Helper: enrich product with fallback images if DB images are missing
    const enrichImages = (product: any) => {
      if (!product.image_urls || product.image_urls.length === 0 || (product.image_urls.length === 1 && !product.image_urls[0])) {
        const fallback = getFallbackProductBySlug(product.slug) ?? getFallbackProductBySlug(cleanSlug) ?? getFallbackProductBySlug(rawSlug);
        if (fallback && fallback.image_urls && fallback.image_urls.length > 0) {
          return { ...product, image_urls: fallback.image_urls };
        }
      }
      return product;
    };

    try {
      const supabase = getPublicClient();

      // Strategy 1: Try exact slug match first (most reliable)
      const { data: exactMatch, error: exactErr } = await supabase
        .from("products")
        .select("id, slug, title, description, price_cents, compare_at_price_cents, inventory_count, image_urls, sizes, colors, category")
        .eq("slug", cleanSlug)
        .eq("is_active", true)
        .maybeSingle();

      if (!exactErr && exactMatch) {
        if (!exactMatch.image_urls?.length) await storageProductsPromise;
        return enrichImages(exactMatch);
      }

      // Strategy 2: Try raw slug (may differ from cleanSlug)
      if (rawSlug !== cleanSlug) {
        const { data: rawMatch, error: rawErr } = await supabase
          .from("products")
          .select("id, slug, title, description, price_cents, compare_at_price_cents, inventory_count, image_urls, sizes, colors, category")
          .eq("slug", rawSlug)
          .eq("is_active", true)
          .maybeSingle();

        if (!rawErr && rawMatch) {
          if (!rawMatch.image_urls?.length) await storageProductsPromise;
          return enrichImages(rawMatch);
        }
      }

      // Strategy 3: Try by product ID (handles links that use ID instead of slug)
      const { data: idMatch, error: idErr } = await supabase
        .from("products")
        .select("id, slug, title, description, price_cents, compare_at_price_cents, inventory_count, image_urls, sizes, colors, category")
        .eq("id", rawSlug)
        .eq("is_active", true)
        .maybeSingle();

      if (!idErr && idMatch) {
        if (!idMatch.image_urls?.length) await storageProductsPromise;
        return enrichImages(idMatch);
      }

      // Strategy 4: Case-insensitive slug match
      const { data: ilikeMatch, error: ilikeErr } = await supabase
        .from("products")
        .select("id, slug, title, description, price_cents, compare_at_price_cents, inventory_count, image_urls, sizes, colors, category")
        .ilike("slug", cleanSlug)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (!ilikeErr && ilikeMatch) {
        if (!ilikeMatch.image_urls?.length) await storageProductsPromise;
        return enrichImages(ilikeMatch);
      }
    } catch (_) {}

    // Final fallback: check in-memory / storage-backed fallback products
    await storageProductsPromise;
    const fallbacks = getFallbackProducts();
    const found = fallbacks.find(
      (p) =>
        p.id === rawSlug ||
        p.id === cleanSlug ||
        p.id.toLowerCase() === rawSlug.toLowerCase() ||
        p.slug === rawSlug ||
        p.slug === cleanSlug ||
        p.slug.toLowerCase() === rawSlug.toLowerCase() ||
        p.slug.toLowerCase() === cleanSlug ||
        p.slug.toLowerCase().replace(/[^a-z0-9]+/g, "-") === cleanSlug ||
        p.slug.toLowerCase().replace(/-/g, " ") === decodedSlug.toLowerCase().replace(/-/g, " ")
    );

    if (found) return found;
    throw new Error("Product not found");
  });

