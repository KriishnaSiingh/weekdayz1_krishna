import { createFileRoute, notFound, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useSuspenseQuery, queryOptions, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShoppingBag, Zap, Check, Star, Trash2, ShieldCheck, Truck, RotateCcw, Ruler, X, Maximize2, ChevronLeft, ChevronRight, ArrowRight, Heart } from "lucide-react";
import { getProductBySlug, listProducts } from "@/lib/products.functions";
import { getFallbackProducts } from "@/lib/fallback-data";
import { getProductReviews, submitReview, deleteReview, canUserReviewProduct } from "@/lib/reviews.functions";
import { toggleWishlist, getWishlistIds } from "@/lib/wishlist.functions";
import { useCart } from "@/lib/cart-store";
import { formatPrice } from "@/lib/format";
import { useCurrencyStore } from "@/lib/currency-store";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

const productQ = (slug: string) =>
  queryOptions({
    queryKey: ["product", slug],
    queryFn: () => getProductBySlug({ data: { slug } }),
  });

export const Route = createFileRoute("/product/$slug")({
  validateSearch: (search: Record<string, unknown>): { color?: string } => {
    return {
      color: typeof search.color === "string" ? search.color : undefined,
    };
  },
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug.replace(/-/g, " ")} — Weekdayzz` },
      { name: "description", content: "Shop the latest drop from Weekdayzz." },
      { property: "og:title", content: `${params.slug.replace(/-/g, " ")} — Weekdayzz` },
    ],
  }),
  loader: async ({ params, context }) => {
    try {
      await context.queryClient.ensureQueryData(productQ(params.slug));
    } catch {
      throw notFound();
    }
  },
  notFoundComponent: () => (
    <div className="py-32 text-center">
      <h1 className="text-display text-5xl">Product not found</h1>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="py-32 text-center">
      <p className="text-destructive">{error.message}</p>
    </div>
  ),
  component: ProductPageWrapper,
});

function ProductPageWrapper() {
  const { slug } = Route.useParams();
  const { color: searchColor } = Route.useSearch();
  // Key forces full remount when slug or color changes, ensuring useState picks up new initial values
  return <ProductPageInner key={`${slug}-${searchColor ?? "default"}`} />;
}

function ProductPageInner() {
  const { slug } = Route.useParams();
  const { color: searchColor } = Route.useSearch();
  const { data: product } = useSuspenseQuery(productQ(slug));
  const availableColors = product.colors && product.colors.length > 0 ? product.colors : [];

  // Pure function — no dependency on React state
  const findImageIndexForColor = (colorName: string): number => {
    const lower = colorName.trim().toLowerCase();

    // 1. Direct keyword match in image URLs (skip size charts)
    for (let i = 0; i < product.image_urls.length; i++) {
      const url = product.image_urls[i].toLowerCase();
      if (url.includes("size-chart") || url.includes("sizechart")) continue;

      if (lower.includes("white") && lower.includes("black")) {
        if (url.includes("couple") || url.includes("both") || url.includes("set")) return i;
      } else if (lower.includes("white")) {
        if (url.includes("white") || url.includes("yapper")) return i;
      } else if (lower.includes("black")) {
        if (url.includes("black") || url.includes("listener")) return i;
      } else if (url.includes(lower)) {
        return i;
      }
    }

    // 2. Positional fallback among non-size-chart images
    const nonSizeChartImages = product.image_urls.filter((url: string) => {
      const l = url.toLowerCase();
      return !l.includes("size-chart") && !l.includes("sizechart");
    });
    if (nonSizeChartImages.length > 0) {
      const colorPos = availableColors.indexOf(colorName);
      if (colorPos >= 0 && colorPos < nonSizeChartImages.length) {
        return product.image_urls.indexOf(nonSizeChartImages[colorPos]);
      }
      return product.image_urls.indexOf(nonSizeChartImages[0]);
    }

    return 0;
  };

  // Derive initial color & image index from the URL search param
  const initialColor = (() => {
    if (searchColor) {
      const match = availableColors.find(
        (c: string) => c.toLowerCase() === searchColor.toLowerCase()
      );
      if (match) return match;
    }
    return availableColors[0] ?? "";
  })();

  const initialImgIdx = initialColor ? findImageIndexForColor(initialColor) : 0;
  const isRequestedColorUnavailable = Boolean(
    searchColor && !availableColors.some((c: string) => c.toLowerCase() === searchColor.toLowerCase())
  );

  const [size, setSize] = useState(product.sizes[1] ?? product.sizes[0]);
  const [color, setColor] = useState(initialColor);
  const [imgIdx, setImgIdx] = useState(initialImgIdx);
  const [zoom, setZoom] = useState({ x: 50, y: 50, active: false });
  const [showSizeChart, setShowSizeChart] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  // Couple variant: separate config for male & female
  const isCouple = product.category?.toLowerCase().includes("couple") ||
    product.title?.toLowerCase().includes("couple") ||
    availableColors.some((c: string) => c.toLowerCase().includes("couple"));
  const [maleSize, setMaleSize] = useState(product.sizes[1] ?? product.sizes[0]);
  const [maleColor, setMaleColor] = useState<"White" | "Black">("White");
  const [femaleSize, setFemaleSize] = useState(product.sizes[0]);
  const [femaleColor, setFemaleColor] = useState<"White" | "Black">("White");
  const [openAccordion, setOpenAccordion] = useState<string | null>(null);

  // Sync when searchColor changes (e.g. user edits URL bar or navigates back)
  useEffect(() => {
    if (searchColor) {
      const match = availableColors.find(
        (c: string) => c.toLowerCase() === searchColor.toLowerCase()
      );
      if (match) {
        setColor(match);
        setImgIdx(findImageIndexForColor(match));
      }
    }
  }, [searchColor]);

  const navigate = useNavigate();
  const handleSelectColor = (selectedColor: string) => {
    setColor(selectedColor);
    const lowerColor = selectedColor.trim().toLowerCase();

    // 1. Check if a dedicated color variant product exists in catalog (e.g. calm-admi-and-kaleshi-aurat-tees-white)
    const allProducts = getFallbackProducts();
    const cleanSlug = slug.replace(/-(black|white|red|blue|cream|green|gold)$/i, "");
    const targetCandidateSlugs = [
      `${cleanSlug}-${lowerColor}`,
      `${slug}-${lowerColor}`,
    ];

    const matchedVariant = allProducts.find((p) => targetCandidateSlugs.includes(p.slug));
    if (matchedVariant && matchedVariant.slug !== slug) {
      navigate({ to: "/product/$slug", params: { slug: matchedVariant.slug } });
      return;
    }

    // 2. Otherwise update search parameter & image index
    const targetIdx = findImageIndexForColor(selectedColor);
    if (targetIdx !== -1) {
      setImgIdx(targetIdx);
    }
    navigate({
      to: "/product/$slug",
      params: { slug },
      search: { color: lowerColor },
      replace: true,
    });
  };

  const addItem = useCart((s) => s.addItem);
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

  const wishlistMutation = useMutation({
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

  const handleToggleWishlist = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!user) {
      toast.error("Please sign in to save items to your wishlist");
      navigate({ to: "/auth" });
      return;
    }
    wishlistMutation.mutate();
  };

  const getProductReviewsFn = useServerFn(getProductReviews);

  const { data: reviews, refetch: refetchReviews } = useQuery({
    queryKey: ["product-reviews", product.id],
    queryFn: () => getProductReviewsFn({ data: { product_id: product.id } }),
  });

  const avgRating = reviews?.length
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : 0;

  const existingUserReview = reviews?.find((r) => r.user_id === user?.id);

  const isOutOfStock = (product.inventory_count ?? 0) <= 0;

  const handleAdd = (express?: boolean) => {
    if (isOutOfStock) {
      toast.error("This item is currently out of stock");
      return;
    }
    if (!user) {
      toast.error("Please sign in to add items to your bag");
      navigate({ to: "/auth" });
      return;
    }
    if (!size) {
      toast.error("Pick a size");
      return;
    }
    if (availableColors.length > 0 && !color) {
      toast.error("Pick a color variant");
      return;
    }
    for (let q = 0; q < quantity; q++) {
      addItem({
        product_id: product.id,
        title: product.title,
        image: product.image_urls[0] ?? "",
        size: isCouple ? `M:${maleSize} F:${femaleSize}` : size,
        color: isCouple ? `M:${maleColor} F:${femaleColor}` : (color || undefined),
        unit_price_cents: product.price_cents,
      });
    }
    toast.success(`Added ${quantity} to bag`);
    if (express) navigate({ to: "/checkout" });
  };

  const handlePrevImg = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setImgIdx((prev) => (prev > 0 ? prev - 1 : product.image_urls.length - 1));
  };

  const handleNextImg = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setImgIdx((prev) => (prev < product.image_urls.length - 1 ? prev + 1 : 0));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!lightboxOpen) return;
      if (e.key === "Escape") setLightboxOpen(false);
      if (e.key === "ArrowLeft") handlePrevImg();
      if (e.key === "ArrowRight") handleNextImg();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxOpen, product.image_urls.length]);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 space-y-16">
      <div className="grid lg:grid-cols-2 gap-10">
        {/* Image gallery: responsive thumbnail rail + main image */}
        <div className="flex flex-col-reverse sm:grid sm:grid-cols-[72px_1fr] gap-3">
          {/* Thumbnail rail */}
          {product.image_urls.length > 1 && (
            <div className="flex flex-row sm:flex-col gap-2 overflow-x-auto sm:overflow-x-visible no-scrollbar pb-1 sm:pb-0">
              {product.image_urls.map((u: string, i: number) => (
                <button
                  key={i}
                  onClick={() => setImgIdx(i)}
                  className={`w-14 sm:w-auto shrink-0 aspect-[4/5] border-2 overflow-hidden transition-all bg-card ${
                    i === imgIdx ? "border-accent shadow-sm" : "border-transparent hover:border-border"
                  }`}
                >
                  <img src={u} alt="" className="w-full h-full object-contain p-0.5" />
                </button>
              ))}
            </div>
          )}
          {/* Main image with zoom & expand click */}
          <div
            className={`relative aspect-[4/5] bg-card overflow-hidden border border-border group ${
              product.image_urls.length <= 1 ? "col-span-2" : ""
            }`}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setZoom({
                x: ((e.clientX - r.left) / r.width) * 100,
                y: ((e.clientY - r.top) / r.height) * 100,
                active: true,
              });
            }}
            onMouseLeave={() => setZoom((z) => ({ ...z, active: false }))}
          >
            <img
              src={product.image_urls[imgIdx]}
              alt={product.title}
              onClick={() => setLightboxOpen(true)}
              className="w-full h-full object-contain p-2 transition-transform duration-200 cursor-zoom-in"
              style={{
                transformOrigin: `${zoom.x}% ${zoom.y}%`,
                transform: zoom.active ? "scale(1.8)" : "scale(1)",
              }}
            />

            {/* Wishlist Overlay Button */}
            <button
              type="button"
              onClick={handleToggleWishlist}
              disabled={wishlistMutation.isPending}
              className="absolute top-3 left-3 p-2 bg-background/80 backdrop-blur border border-border text-foreground hover:text-accent hover:border-accent transition-colors z-20 shadow-sm"
              title={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
              aria-label={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
            >
              <Heart className={`h-4 w-4 transition-colors ${isWishlisted ? "fill-accent text-accent" : ""}`} />
            </button>

            {/* Expand / Fullscreen Button */}
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              className="absolute top-3 right-3 px-3 py-1.5 bg-background/90 backdrop-blur border border-border text-foreground hover:bg-foreground hover:text-background transition-all shadow-sm z-10 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider rounded-none"
              title="Click to view image in full screen"
            >
              <Maximize2 className="h-3.5 w-3.5" /> View Image
            </button>
          </div>
        </div>

          <div className="lg:pl-8 flex flex-col justify-center">
            <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground">{product.category}</span>
            <h1 className="text-display text-4xl sm:text-6xl mt-2">{product.title}</h1>

            <div className="flex items-center gap-3 mt-4 flex-wrap">
              {product.compare_at_price_cents && product.compare_at_price_cents > product.price_cents && (
                <>
                  <p className="text-2xl font-black">{formatPrice(product.price_cents)}</p>
                  <p className="text-sm font-medium text-muted-foreground line-through">MRP {formatPrice(product.compare_at_price_cents)}</p>
                  <span className="text-[10px] font-black bg-emerald-500/15 text-emerald-700 px-2 py-1">
                    {Math.round(((product.compare_at_price_cents - product.price_cents) / product.compare_at_price_cents) * 100)}% OFF
                  </span>
                </>
              )}
              {(!product.compare_at_price_cents || product.compare_at_price_cents <= product.price_cents) && (
                <p className="text-2xl font-black">{formatPrice(product.price_cents)}</p>
              )}
              {reviews && reviews.length > 0 && (
                <a href="#reviews" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <div className="flex text-amber-400">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star
                        key={s}
                        className={`h-3.5 w-3.5 ${s <= Math.round(avgRating) ? "fill-amber-400 text-amber-400" : "text-border"}`}
                      />
                    ))}
                  </div>
                  <span className="font-semibold text-foreground">{avgRating.toFixed(1)}</span>
                  <span>({reviews.length})</span>
                </a>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Inclusive of all taxes · Free shipping on orders ₹999+</p>

          {/* Color selector */}
          {availableColors.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs uppercase tracking-widest font-semibold">Color Variant</h3>
                <span className="text-xs font-mono text-accent font-semibold uppercase">{color}</span>
              </div>

              {isRequestedColorUnavailable && (
                <div className="mb-3 px-3 py-2 text-xs font-semibold bg-amber-500/10 border border-amber-500/30 text-amber-600 rounded">
                  Color variant &quot;{searchColor}&quot; is not available for this item. Displaying published options below.
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {availableColors.map((c: string) => {
                  const isSelected = color === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => handleSelectColor(c)}
                      className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border transition-all cursor-pointer ${
                        isSelected
                          ? "bg-foreground text-background border-foreground shadow-md ring-1 ring-foreground"
                          : "border-border hover:border-foreground text-muted-foreground hover:text-foreground bg-card"
                      }`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Couple Dual-Variant Controls */}
          {isCouple && (
            <div className="mt-6 space-y-5 p-4 bg-secondary/40 border border-border">
              <div className="text-xs font-black uppercase tracking-widest border-b border-border pb-2">COUPLE CONFIGURATION</div>

              {/* Male */}
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">His Size</div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {["S", "M", "L", "XL", "XXL"].map((s) => (
                    <button key={s} onClick={() => setMaleSize(s)}
                      className={`min-w-10 py-2 text-xs font-bold border ${ maleSize === s ? "bg-foreground text-background border-foreground" : "border-border hover:border-foreground"}`}>
                      {s}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  {(["White", "Black"] as const).map((c) => (
                    <button key={c} onClick={() => setMaleColor(c)}
                      className={`px-3 py-1.5 text-xs font-bold border transition-all ${ maleColor === c ? "bg-foreground text-background border-foreground" : "border-border"}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Female */}
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Her Size</div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {["S", "M", "L", "XL", "XXL"].map((s) => (
                    <button key={s} onClick={() => setFemaleSize(s)}
                      className={`min-w-10 py-2 text-xs font-bold border ${ femaleSize === s ? "bg-foreground text-background border-foreground" : "border-border hover:border-foreground"}`}>
                      {s}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  {(["White", "Black"] as const).map((c) => (
                    <button key={c} onClick={() => setFemaleColor(c)}
                      className={`px-3 py-1.5 text-xs font-bold border transition-all ${ femaleColor === c ? "bg-foreground text-background border-foreground" : "border-border"}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Standard Size selector (non-couple) */}
          {!isCouple && (<div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h3 className="text-xs uppercase tracking-widest font-semibold">Size</h3>
                <button
                  type="button"
                  onClick={() => setShowSizeChart(true)}
                  className="inline-flex items-center gap-1 text-xs text-foreground hover:underline font-medium"
                >
                  <Ruler className="h-3.5 w-3.5" /> Size Guide
                </button>
              </div>
              <span className={`text-xs uppercase tracking-widest ${isOutOfStock ? "text-destructive font-bold" : product.inventory_count < 10 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                {isOutOfStock ? "OUT OF STOCK" : product.inventory_count < 10 ? `Only ${product.inventory_count} left` : `${product.inventory_count} in stock`}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {product.sizes.map((s: string) => (
                <button
                  key={s}
                  disabled={isOutOfStock}
                  onClick={() => setSize(s)}
                  className={`min-w-14 py-3 text-sm font-semibold border ${
                    isOutOfStock
                      ? "opacity-50 cursor-not-allowed border-border"
                      : size === s
                      ? "bg-foreground text-background border-foreground"
                      : "border-border hover:border-foreground"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>)}

          {/* Size Chart Modal */}
          {showSizeChart && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
              <div className="relative w-full max-w-xl bg-card border border-border p-6 rounded-lg shadow-2xl max-h-[90vh] overflow-y-auto space-y-5">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div>
                    <h3 className="text-lg font-bold text-foreground">Weekdayzz Size Guide</h3>
                    <p className="text-xs text-muted-foreground">Oversized Fit Measurements (in inches)</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSizeChart(false)}
                    className="p-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 text-foreground">
                        <th className="p-2.5 font-bold uppercase tracking-wider">Size</th>
                        <th className="p-2.5 font-bold uppercase tracking-wider">Chest (Inches)</th>
                        <th className="p-2.5 font-bold uppercase tracking-wider">Length (Inches)</th>
                        <th className="p-2.5 font-bold uppercase tracking-wider">Sleeve (Inches)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border text-muted-foreground">
                      <tr className="hover:bg-muted/30">
                        <td className="p-2.5 font-bold text-foreground">S</td>
                        <td className="p-2.5">41"</td>
                        <td className="p-2.5">28"</td>
                        <td className="p-2.5">9"</td>
                      </tr>
                      <tr className="hover:bg-muted/30">
                        <td className="p-2.5 font-bold text-foreground">M</td>
                        <td className="p-2.5">43"</td>
                        <td className="p-2.5">29"</td>
                        <td className="p-2.5">9.5"</td>
                      </tr>
                      <tr className="hover:bg-muted/30">
                        <td className="p-2.5 font-bold text-foreground">L</td>
                        <td className="p-2.5">45"</td>
                        <td className="p-2.5">30"</td>
                        <td className="p-2.5">10"</td>
                      </tr>
                      <tr className="hover:bg-muted/30">
                        <td className="p-2.5 font-bold text-foreground">XL</td>
                        <td className="p-2.5">47"</td>
                        <td className="p-2.5">31"</td>
                        <td className="p-2.5">10.5"</td>
                      </tr>
                      <tr className="hover:bg-muted/30">
                        <td className="p-2.5 font-bold text-foreground">XXL</td>
                        <td className="p-2.5">49"</td>
                        <td className="p-2.5">32"</td>
                        <td className="p-2.5">11"</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="border-t border-border pt-4">
                  <h4 className="text-xs font-semibold text-foreground mb-2">Size Chart Slide Graphic</h4>
                  <img
                    src="/products/size-chart-oversized.png"
                    alt="Weekdayzz Oversized Fit Size Chart"
                    className="w-full rounded border border-border"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Fullscreen Image Lightbox Modal */}
          {lightboxOpen && (
            <div
              className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
              onClick={() => setLightboxOpen(false)}
            >
              <div
                className="relative max-w-5xl max-h-[95vh] w-full flex flex-col items-center justify-center"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Top Header */}
                <div className="w-full flex items-center justify-between text-white pb-3 border-b border-white/10 mb-4 px-2">
                  <span className="text-xs font-mono tracking-widest text-muted-foreground uppercase">
                    {product.title} — Slide {imgIdx + 1} of {product.image_urls.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLightboxOpen(false)}
                    className="p-1.5 hover:bg-white/20 rounded text-white transition-colors"
                    title="Close (Esc)"
                  >
                    <X className="h-6 w-6" />
                  </button>
                </div>

                {/* Main Expanded Image */}
                <div className="relative flex items-center justify-center w-full max-h-[75vh] overflow-hidden">
                  <img
                    src={product.image_urls[imgIdx]}
                    alt={product.title}
                    className="max-h-[75vh] max-w-full object-contain shadow-2xl rounded"
                  />

                  {/* Prev / Next Arrows */}
                  {product.image_urls.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={handlePrevImg}
                        className="absolute left-2 p-3 bg-black/70 hover:bg-black/90 border border-white/20 text-white rounded-full transition-all shadow-lg hover:scale-110 cursor-pointer"
                        title="Previous image"
                      >
                        <ChevronLeft className="h-6 w-6" />
                      </button>
                      <button
                        type="button"
                        onClick={handleNextImg}
                        className="absolute right-2 p-3 bg-black/70 hover:bg-black/90 border border-white/20 text-white rounded-full transition-all shadow-lg hover:scale-110 cursor-pointer"
                        title="Next image"
                      >
                        <ChevronRight className="h-6 w-6" />
                      </button>
                    </>
                  )}
                </div>

                {/* Thumbnail Strip */}
                {product.image_urls.length > 1 && (
                  <div className="flex gap-2 mt-4 overflow-x-auto max-w-full py-1 px-2">
                    {product.image_urls.map((u: string, i: number) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setImgIdx(i)}
                        className={`h-16 w-14 border-2 rounded overflow-hidden flex-shrink-0 transition-all cursor-pointer ${
                          i === imgIdx ? "border-accent scale-105" : "border-white/20 opacity-60 hover:opacity-100"
                        }`}
                      >
                        <img src={u} alt="" className="w-full h-full object-contain bg-black/40 p-0.5" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quantity Selector */}
          <div className="mt-6">
            <h3 className="text-xs uppercase tracking-widest font-semibold mb-3">Quantity</h3>
            <div className="flex items-center gap-0 border border-border w-fit">
              <button
                type="button"
                disabled={isOutOfStock || quantity <= 1}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="h-10 w-10 flex items-center justify-center text-lg font-bold hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Decrease quantity"
              >−</button>
              <span className="h-10 w-12 flex items-center justify-center text-sm font-bold border-x border-border">
                {isOutOfStock ? 0 : quantity}
              </span>
              <button
                type="button"
                disabled={isOutOfStock || quantity >= product.inventory_count}
                onClick={() => setQuantity((q) => Math.min(product.inventory_count, q + 1))}
                className="h-10 w-10 flex items-center justify-center text-lg font-bold hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Increase quantity"
              >+</button>
            </div>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => handleAdd(false)}
              disabled={isOutOfStock}
              className={`flex-1 flex items-center justify-center gap-2 px-6 py-4 text-sm uppercase tracking-widest font-semibold transition ${
                isOutOfStock
                  ? "bg-muted text-muted-foreground cursor-not-allowed border border-border opacity-70"
                  : "bg-foreground text-background hover:opacity-85"
              }`}
            >
              <ShoppingBag className="h-4 w-4" /> {isOutOfStock ? "Out of Stock" : "Add to Cart"}
            </button>
            <button
              onClick={() => handleAdd(true)}
              disabled={isOutOfStock}
              className={`flex-1 flex items-center justify-center gap-2 px-6 py-4 text-sm uppercase tracking-widest font-semibold transition ${
                isOutOfStock
                  ? "bg-muted/50 text-muted-foreground cursor-not-allowed border border-border opacity-70"
                  : "bg-accent text-accent-foreground hover:bg-accent/90"
              }`}
            >
              <Zap className="h-4 w-4" /> {isOutOfStock ? "Out of Stock" : "Buy Now"}
            </button>
            <button
              type="button"
              onClick={handleToggleWishlist}
              disabled={wishlistMutation.isPending}
              className={`flex items-center justify-center gap-2 px-6 py-4 text-sm uppercase tracking-widest font-semibold border transition ${
                isWishlisted
                  ? "bg-accent/10 border-accent text-accent hover:bg-accent/20"
                  : "bg-card border-border text-foreground hover:border-foreground"
              }`}
              title={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
            >
              <Heart className={`h-4 w-4 transition-colors ${isWishlisted ? "fill-accent text-accent" : ""}`} />
              <span>{isWishlisted ? "Wishlisted" : "Wishlist"}</span>
            </button>
          </div>

          {/* Trust badges */}
          <div className="mt-6 grid grid-cols-3 gap-3 border-t border-border pt-5">
            <div className="flex flex-col items-center gap-2 text-center">
              <Truck className="h-5 w-5 text-foreground" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground leading-tight">Free ship ₹999+</span>
            </div>
            <div className="flex flex-col items-center gap-2 text-center">
              <RotateCcw className="h-5 w-5 text-foreground" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground leading-tight">15-day returns</span>
            </div>
            <div className="flex flex-col items-center gap-2 text-center">
              <ShieldCheck className="h-5 w-5 text-foreground" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground leading-tight">Secure checkout</span>
            </div>
          </div>

          {/* Accordions */}
          {([
            { id: "offers", title: "Offers & Discounts", content: "• Use code FIRST10 for 10% off your first order.\n• Buy 2 and save 10% automatically.\n• Free shipping on orders above ₹999.\n• COD available across India." },
            { id: "desc", title: "Description", content: product.description ?? "Premium quality garment crafted with 240+ GSM heavyweight cotton. Boxy oversized fit with drop shoulders. Pre-shrunk and bio-washed for long-lasting comfort." },
            { id: "care", title: "Care Instructions", content: "• Machine wash cold at 30°C with similar colors.\n• Do not bleach.\n• Tumble dry on low heat.\n• Iron inside out at medium heat.\n• Do not dry clean." },
            { id: "shipping", title: "Shipping", content: "• Standard delivery: 2–4 business days (Metro cities).\n• Remote areas: 4–7 business days.\n• Free shipping on orders above ₹999.\n• Express delivery available at checkout.\n• Cash on Delivery (COD) available." },
            { id: "payment", title: "Payment", content: "• UPI: Google Pay, PhonePe, Paytm.\n• Cards: Visa, Mastercard, Rupay.\n• Net Banking.\n• Cash on Delivery (COD) — OTP verified.\n• 100% secured by Razorpay SSL encryption." },
          ]).map(({ id, title, content }) => (
            <div key={id} className="border-b border-border">
              <button
                onClick={() => setOpenAccordion(openAccordion === id ? null : id)}
                className="w-full flex items-center justify-between py-4 text-sm font-semibold text-left hover:text-foreground/70 transition-colors"
              >
                {title}
                <span className="text-lg font-light ml-2">{openAccordion === id ? "−" : "+"}</span>
              </button>
              {openAccordion === id && (
                <div className="pb-4 text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                  {content}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Reviews Section */}
      <div id="reviews" className="border-t border-border pt-12">
        <div className="grid md:grid-cols-[320px_1fr] gap-10">
          <div>
            <h2 className="text-display text-2xl mb-4">Customer Reviews</h2>
            {reviews && reviews.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-baseline gap-3">
                  <div className="text-5xl font-semibold">{avgRating.toFixed(1)}</div>
                  <div>
                    <div className="flex text-accent">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={`h-4 w-4 ${s <= Math.round(avgRating) ? "fill-accent text-accent" : "text-border"}`}
                        />
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">Based on {reviews.length} {reviews.length === 1 ? "review" : "reviews"}</div>
                  </div>
                </div>

                {/* Rating Distribution Breakdown */}
                <div className="space-y-1.5 pt-2 border-t border-border">
                  {[5, 4, 3, 2, 1].map((star) => {
                    const count = reviews.filter((r) => r.rating === star).length;
                    const pct = reviews.length ? Math.round((count / reviews.length) * 100) : 0;
                    return (
                      <div key={star} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="w-6 font-mono text-right">{star} ★</span>
                        <div className="flex-1 h-2 bg-muted overflow-hidden border border-border">
                          <div className="h-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-8 font-mono text-right text-[10px]">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No reviews yet for this product. Be the first to share your thoughts!</p>
            )}

            <ReviewForm
              productId={product.id}
              existingReview={existingUserReview}
              onSubmitted={() => refetchReviews()}
            />
          </div>

          <div className="space-y-4">
            {reviews?.map((r) => (
              <div key={r.id} className="border border-border p-5 bg-card space-y-2">
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                        {r.profiles?.full_name ?? "Verified Buyer"}
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-accent uppercase tracking-widest font-semibold bg-accent/10 px-1.5 py-0.5 border border-accent/30">
                        <ShieldCheck className="h-3 w-3" /> Verified
                      </span>
                    </div>
                    <div className="flex text-accent mt-1.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={`h-3.5 w-3.5 ${s <= r.rating ? "fill-accent text-accent" : "text-border"}`}
                        />
                      ))}
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {new Date(r.created_at).toLocaleDateString()}
                  </span>
                </div>
                {r.body && <p className="text-sm text-muted-foreground leading-relaxed pt-1">{r.body}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* You May Also Like Section */}
      <YouMayAlsoLikeSection currentProductId={product.id} category={product.category} />
    </div>
  );
}

function ReviewForm({
  productId,
  existingReview,
  onSubmitted,
}: {
  productId: string;
  existingReview?: { rating: number; body: string };
  onSubmitted: () => void;
}) {
  const { user } = useAuth();
  const [rating, setRating] = useState(existingReview?.rating ?? 5);
  const [body, setBody] = useState(existingReview?.body ?? "");
  const [hoverRating, setHoverRating] = useState<number | null>(null);

  useEffect(() => {
    if (existingReview) {
      setRating(existingReview.rating);
      setBody(existingReview.body);
    }
  }, [existingReview]);

  const canUserReviewFn = useServerFn(canUserReviewProduct);
  const submitReviewFn = useServerFn(submitReview);
  const deleteReviewFn = useServerFn(deleteReview);

  const { data: canReviewData, isLoading: checkingPurchase } = useQuery({
    queryKey: ["can-review-product", productId, user?.id],
    queryFn: () => canUserReviewFn({ data: { product_id: productId } }),
    enabled: !!user && !existingReview,
  });

  const submitMutation = useMutation({
    mutationFn: () => submitReviewFn({ data: { product_id: productId, rating, body } }),
    onSuccess: () => {
      toast.success(existingReview ? "Review updated!" : "Review posted!");
      onSubmitted();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to save review");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteReviewFn({ data: { product_id: productId } }),
    onSuccess: () => {
      toast.success("Review deleted");
      setRating(5);
      setBody("");
      onSubmitted();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete review");
    },
  });

  if (!user) {
    return (
      <div className="mt-6 p-5 border border-dashed border-border text-center bg-card">
        <p className="text-xs text-muted-foreground mb-3 font-medium">Please sign in to rate and review items you've purchased.</p>
        <Link to="/auth" className="inline-block bg-accent text-accent-foreground px-5 py-2.5 text-xs uppercase tracking-widest font-semibold">
          Sign In To Review
        </Link>
      </div>
    );
  }

  if (checkingPurchase) {
    return (
      <div className="mt-6 p-4 border border-border text-center text-xs text-muted-foreground">
        Checking purchase verification...
      </div>
    );
  }

  const canReview = Boolean(existingReview) || (canReviewData?.canReview ?? false);

  if (!canReview) {
    return (
      <div className="mt-6 p-5 border border-border text-center bg-card space-y-2">
        <div className="flex justify-center text-muted-foreground">
          <ShoppingBag className="h-6 w-6" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wider text-foreground">Verified Buyers Only</p>
        <p className="text-xs text-muted-foreground max-w-xs mx-auto">
          You can only review products you have purchased. Buy this product to share your feedback!
        </p>
      </div>
    );
  }

  const handleSub = (e: React.FormEvent) => {
    e.preventDefault();
    submitMutation.mutate();
  };

  return (
    <form onSubmit={handleSub} className="mt-6 border border-border p-5 bg-card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-widest font-semibold text-foreground">
          {existingReview ? "Edit your review" : "Rate & review this item"}
        </h3>
        {existingReview && (
          <button
            type="button"
            onClick={() => {
              if (confirm("Are you sure you want to delete your review?")) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
            className="text-xs text-destructive hover:underline flex items-center gap-1 uppercase tracking-widest font-semibold disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        )}
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground block mb-1">Overall Rating</label>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setRating(s)}
              onMouseEnter={() => setHoverRating(s)}
              onMouseLeave={() => setHoverRating(null)}
              className="p-0.5 hover:scale-110 transition-transform"
            >
              <Star
                className={`h-6 w-6 ${
                  s <= (hoverRating ?? rating) ? "fill-accent text-accent" : "text-border"
                }`}
              />
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground block mb-1">Your Review</label>
        <textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Share details about the fit, quality, or style..."
          className="w-full bg-background border border-border px-3 py-2 text-xs focus:outline-none focus:border-accent"
        />
      </div>

      <button
        type="submit"
        disabled={submitMutation.isPending}
        className="w-full bg-accent text-accent-foreground text-xs uppercase tracking-widest font-semibold py-3 hover:bg-accent/90 disabled:opacity-50 transition"
      >
        {submitMutation.isPending ? "Saving..." : existingReview ? "Update Review" : "Submit Review"}
      </button>
    </form>
  );
}

function YouMayAlsoLikeSection({ currentProductId, category }: { currentProductId: string; category: string }) {
  const listProductsFn = useServerFn(listProducts);
  const { data: allProducts = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => listProductsFn(),
    staleTime: 60_000,
  });

  const related = useMemo(() => {
    const others = allProducts.filter((p) => p.id !== currentProductId);
    const sameCat = others.filter((p) => p.category === category);
    const pool = sameCat.length >= 4 ? sameCat : [...sameCat, ...others.filter((p) => p.category !== category)];
    return pool.slice(0, 4);
  }, [allProducts, currentProductId, category]);

  if (related.length === 0) return null;

  return (
    <section className="border-t border-border pt-14 mt-16 pb-6">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-display text-2xl md:text-3xl font-bold tracking-tight text-foreground">
          You May Also Like
        </h2>
        <Link
          to="/shop"
          className="text-xs font-bold uppercase tracking-widest text-foreground hover:opacity-70 transition-opacity flex items-center gap-1.5"
        >
          View All <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        {related.map((p) => (
          <Link
            key={p.id}
            to="/product/$slug"
            params={{ slug: p.slug }}
            className="group block rounded-2xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
          >
            {/* Image Container */}
            <div className="relative aspect-[3/4] w-full overflow-hidden bg-secondary">
              <img
                src={p.image_urls[0]}
                alt={p.title}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            </div>

            {/* Content Bar matching attached design */}
            <div className="p-4 flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-foreground truncate group-hover:text-foreground/70 transition-colors">
                  {p.title}
                </h3>
                <p className="text-xs font-semibold text-muted-foreground mt-0.5">
                  {p.compare_at_price_cents && p.compare_at_price_cents > p.price_cents ? (
                    <>
                      <span className="text-emerald-600 font-bold">{formatPrice(p.price_cents)}</span>
                      <span className="ml-1.5 line-through opacity-70">{formatPrice(p.compare_at_price_cents)}</span>
                    </>
                  ) : (
                    formatPrice(p.price_cents)
                  )}
                </p>
              </div>
              <button
                type="button"
                aria-label="Wishlist"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toast.success("Added to wishlist");
                }}
                className="p-1.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <Heart className="h-4 w-4" />
              </button>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
