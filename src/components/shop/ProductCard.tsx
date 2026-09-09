import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { formatPrice } from "@/lib/format";
import { useCurrencyStore } from "@/lib/currency-store";
import { useAuth } from "@/hooks/use-auth";
import { toggleWishlist, getWishlistIds } from "@/lib/wishlist.functions";
import { cn } from "@/lib/utils";

export type ProductCardData = {
  id: string;
  slug: string;
  title: string;
  price_cents: number;
  compare_at_price_cents?: number | null;
  image_urls: string[];
  category: string;
  inventory_count?: number;
};

export function ProductCard({ product }: { product: ProductCardData }) {
  const primary = product.image_urls[0] ?? "/products/tee-black.jpg";
  const secondaryCandidate = product.image_urls.find((u, i) => i > 0 && !u.includes("size-chart"));
  const secondary = secondaryCandidate && secondaryCandidate !== primary ? secondaryCandidate : null;

  const [hasSecondaryError, setHasSecondaryError] = useState(false);
  const [hasPrimaryError, setHasPrimaryError] = useState(false);

  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  
  // Reactively watch currency change
  useCurrencyStore((s) => s.currency);

  const toggleWishlistFn = useServerFn(toggleWishlist);
  const getWishlistIdsFn = useServerFn(getWishlistIds);

  const { data: wishlistIds } = useQuery({
    queryKey: ["wishlist-ids"],
    queryFn: () => getWishlistIdsFn(),
    enabled: !!user,
  });

  const isWishlisted = wishlistIds?.includes(product.id) ?? false;

  const m = useMutation({
    mutationFn: () => toggleWishlistFn({ data: { product_id: product.id } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["wishlist-ids"] });
      qc.invalidateQueries({ queryKey: ["wishlist"] });
      toast.success(res.wishlisted ? "Added to wishlist" : "Removed from wishlist");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to update wishlist");
    },
  });

  const handleHeartClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      toast.error("Please sign in to save items to your wishlist");
      navigate({ to: "/auth" });
      return;
    }
    m.mutate();
  };

  const isOutOfStock = product.inventory_count !== undefined && product.inventory_count <= 0;

  return (
    <Link to="/product/$slug" params={{ slug: product.slug }} className="group block relative">
      <div className="relative aspect-[4/5] overflow-hidden bg-muted">
        {secondary && !hasSecondaryError && (
          <img
            src={secondary}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            onError={() => setHasSecondaryError(true)}
            className="absolute inset-0 w-full h-full object-cover scale-105 group-hover:scale-100 transition-transform duration-500"
          />
        )}
        <motion.img
          src={hasPrimaryError ? "/products/tee-black.jpg" : primary}
          alt={product.title}
          loading="lazy"
          decoding="async"
          onError={() => setHasPrimaryError(true)}
          className="absolute inset-0 w-full h-full object-cover z-10"
          initial={{ opacity: 1 }}
          whileHover={secondary && !hasSecondaryError ? { opacity: 0, scale: 1.04 } : { scale: 1.04 }}
          transition={{ duration: 0.4 }}
        />
        {isOutOfStock ? (
          <div className="absolute top-3 left-3 px-2 py-1 bg-destructive text-destructive-foreground font-bold text-[10px] uppercase tracking-widest z-20 shadow-md">
            Out of Stock
          </div>
        ) : (
          <div className="absolute top-3 left-3 px-2 py-1 bg-background/80 backdrop-blur text-[10px] uppercase tracking-widest z-20">
            {product.category}
          </div>
        )}

        {/* Heart Icon Button */}
        <button
          onClick={handleHeartClick}
          className="absolute top-3 right-3 p-1.5 bg-background/80 backdrop-blur rounded-none border border-border text-foreground hover:text-accent hover:border-accent transition-colors z-20"
          aria-label={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
        >
          <motion.div whileTap={{ scale: 0.8 }}>
            <Heart
              className={cn("h-4 w-4 transition-colors", isWishlisted && "fill-accent text-accent")}
            />
          </motion.div>
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide group-hover:text-accent transition-colors line-clamp-1">
          {product.title}
        </h3>
        <div className="flex flex-col items-end leading-tight">
          {product.compare_at_price_cents && product.compare_at_price_cents > product.price_cents ? (
            <>
              <span className="text-sm font-semibold text-emerald-600">
                {formatPrice(product.price_cents)}
                <span className="ml-1.5 text-[10px] font-black bg-emerald-500/15 text-emerald-700 px-1.5 py-0.5 align-middle">
                  {Math.round(
                    ((product.compare_at_price_cents - product.price_cents) / product.compare_at_price_cents) * 100
                  )}% OFF
                </span>
              </span>
              <span className="text-[11px] text-muted-foreground line-through">
                {formatPrice(product.compare_at_price_cents)}
              </span>
            </>
          ) : (
            <span className="text-sm font-medium">{formatPrice(product.price_cents)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
