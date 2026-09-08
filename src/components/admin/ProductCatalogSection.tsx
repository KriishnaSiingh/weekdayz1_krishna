import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Search, Filter, Edit, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { MultiImageUploader } from "@/components/ui/MultiImageUploader";

import {
  createProduct,
  updateProduct,
  deleteProduct,
  listAdminProducts,
  getCategorySuggestions,
} from "@/lib/admin.functions";
import { formatPrice } from "@/lib/format";
import { AdminProduct, CategoryDropdown } from "./shared";

export default function ProductCatalogSection() {
  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteProduct);
  const updateFn = useServerFn(updateProduct);

  const { data: products, isLoading } = useQuery({
    queryKey: ["admin-products"],
    queryFn: () => listAdminProducts(),
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<AdminProduct | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Product removed");
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      updateFn({ data: { id, is_active } }),
    onSuccess: () => {
      toast.success("Product status updated");
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const filteredProducts = (products ?? []).filter((p) => {
    const matchesSearch =
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.slug.toLowerCase().includes(search.toLowerCase()) ||
      (p.category ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesCategory =
      categoryFilter === "all" || p.category?.toLowerCase() === categoryFilter.toLowerCase();
    return matchesSearch && matchesCategory;
  });

  const categories = Array.from(new Set((products ?? []).map((p) => p.category?.toLowerCase()).filter(Boolean)));

  return (
    <section className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">T-Shirt & Apparel Catalog</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Manage products, inventory, and Amazon/Flipkart image galleries</p>
        </div>

        <button
          onClick={() => {
            setEditingProduct(null);
            setModalOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 bg-accent text-accent-foreground px-5 py-2.5 text-xs uppercase tracking-widest font-bold shadow hover:bg-accent/90 transition-colors"
        >
          <Plus className="h-4 w-4" /> Add T-Shirt / Product
        </button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3 border border-border bg-card p-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, slug or category…"
            className="w-full pl-9 pr-4 py-1.5 bg-background border border-border text-sm"
          />
        </div>
        <div className="flex items-center gap-2 sm:w-56">
          <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full bg-background border border-border px-3 py-1.5 text-sm uppercase tracking-wider"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Catalog Table */}
      <div className="border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-widest text-muted-foreground border-b border-border bg-secondary/20">
            <tr>
              <th className="text-left px-4 py-3">Product</th>
              <th className="text-left px-4 py-3">Category</th>
              <th className="text-left px-4 py-3">Price</th>
              <th className="text-left px-4 py-3">Stock</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Loading catalog…
                </td>
              </tr>
            ) : filteredProducts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  No products found. Click "+ Add T-Shirt / Product" to create your first item.
                </td>
              </tr>
            ) : (
              filteredProducts.map((p) => (
                <tr key={p.id} className="hover:bg-secondary/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-14 bg-muted border border-border overflow-hidden flex-shrink-0 relative">
                        {p.image_urls?.[0] ? (
                          <img src={p.image_urls[0]} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No img</div>
                        )}
                        {p.image_urls && p.image_urls.length > 1 && (
                          <span className="absolute bottom-0 right-0 bg-black/80 text-white text-[9px] px-1 font-bold">
                            +{p.image_urls.length - 1}
                          </span>
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-sm leading-snug">{p.title}</p>
                        <p className="text-xs font-mono text-muted-foreground mt-0.5">/{p.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-block border border-border px-2.5 py-1 text-xs uppercase tracking-wider font-mono">
                      {p.category || "tee"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {p.compare_at_price_cents && p.compare_at_price_cents > p.price_cents ? (
                      <div className="space-y-0.5">
                        <div className="font-semibold text-emerald-600">
                          {formatPrice(p.price_cents)}
                          <span className="ml-2 inline-block bg-emerald-500/15 text-emerald-700 text-[10px] font-black px-1.5 py-0.5 align-middle">
                            {Math.round(((p.compare_at_price_cents - p.price_cents) / p.compare_at_price_cents) * 100)}% OFF
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground line-through">
                          MRP {formatPrice(p.compare_at_price_cents)}
                        </div>
                      </div>
                    ) : (
                      <span className="font-semibold">{formatPrice(p.price_cents)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`font-mono font-semibold ${
                        p.inventory_count <= 0
                          ? "text-destructive font-bold"
                          : p.inventory_count < 10
                          ? "text-amber-500"
                          : "text-foreground"
                      }`}
                    >
                      {p.inventory_count <= 0 ? "0 (Out of Stock)" : `${p.inventory_count} units`}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActiveMutation.mutate({ id: p.id, is_active: !p.is_active })}
                      className={`text-xs uppercase tracking-widest font-bold px-2.5 py-1 border transition-colors ${
                        p.is_active
                          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                          : "border-border bg-secondary/50 text-muted-foreground"
                      }`}
                    >
                      {p.is_active ? "Active" : "Draft"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setEditingProduct(p);
                          setModalOpen(true);
                        }}
                        className="p-1.5 hover:bg-secondary border border-border text-xs uppercase tracking-widest inline-flex items-center gap-1"
                        title="Edit product"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Are you sure you want to delete "${p.title}"?`)) {
                            deleteMutation.mutate(p.id);
                          }
                        }}
                        className="p-1.5 hover:bg-destructive/20 border border-destructive/40 text-destructive text-xs uppercase tracking-widest inline-flex items-center gap-1"
                        title="Delete product"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Product Modal */}
      <AnimatePresence>
        {modalOpen && (
          <ProductFormModal
            initialProduct={editingProduct}
            onClose={() => {
              setModalOpen(false);
              setEditingProduct(null);
            }}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

function ProductFormModal({
  initialProduct,
  onClose,
}: {
  initialProduct: AdminProduct | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const createFn = useServerFn(createProduct);
  const updateFn = useServerFn(updateProduct);
  const { data: categorySuggestions } = useQuery({
    queryKey: ["category-suggestions"],
    queryFn: () => getCategorySuggestions(),
  });

  const presetCategories = ["hoodie", "tshirt", "shirt", "pant", "cargo"];
  const allCategoryList = Array.from(
    new Set([...presetCategories, ...(categorySuggestions ?? [])])
  );

  const isEditing = Boolean(initialProduct);

  const [form, setForm] = useState({
    title: initialProduct?.title ?? "",
    slug: initialProduct?.slug ?? "",
    description: initialProduct?.description ?? "",
    price: initialProduct ? (initialProduct.price_cents / 100).toString() : "1899",
    compareAtPrice: initialProduct?.compare_at_price_cents
      ? (initialProduct.compare_at_price_cents / 100).toString()
      : "",
    inventory: initialProduct ? initialProduct.inventory_count.toString() : "100",
    categorySelect: initialProduct?.category && allCategoryList.includes(initialProduct.category.toLowerCase())
      ? initialProduct.category.toLowerCase()
      : initialProduct?.category
      ? "other"
      : "tshirt",
    customCategory: initialProduct?.category && !allCategoryList.includes(initialProduct.category.toLowerCase())
      ? initialProduct.category
      : "",
    sizes: initialProduct?.sizes?.join(", ") ?? "S, M, L, XL, XXL",
    colors: initialProduct?.colors?.join(", ") ?? "",
  });

  const [imageUrls, setImageUrls] = useState<string[]>(initialProduct?.image_urls ?? []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const finalCategory =
        form.categorySelect === "other"
          ? form.customCategory.trim().toLowerCase()
          : form.categorySelect;

      if (!finalCategory) throw new Error("Please select or enter a product category");
      if (!form.title.trim()) throw new Error("Title is required");

      let slug = (form.slug.trim() || form.title.trim())
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      if (!slug) {
        slug = `${finalCategory.replace(/[^a-z0-9]+/g, "") || "product"}-${Date.now().toString(36)}`;
      }

      const numPrice = Number(form.price);
      if (isNaN(numPrice) || numPrice < 0) throw new Error("Please enter a valid sale price");
      const numInventory = Number(form.inventory);
      if (isNaN(numInventory) || numInventory < 0) throw new Error("Please enter a valid stock inventory count");

      const compareAtRaw = form.compareAtPrice.trim();
      const compareAtCents = compareAtRaw === "" ? null : Math.round(Number(compareAtRaw) * 100);
      const finalCompareAt =
        compareAtCents !== null && compareAtCents > 0 && compareAtCents > Math.round(numPrice * 100)
          ? compareAtCents
          : null;

      const payload = {
        slug,
        title: form.title.trim(),
        description: form.description.trim(),
        price_cents: Math.round(numPrice * 100),
        compare_at_price_cents: finalCompareAt,
        inventory_count: Math.round(numInventory),
        image_urls: imageUrls,
        sizes: form.sizes.split(",").map((s: string) => s.trim()).filter(Boolean),
        colors: form.colors.split(",").map((c: string) => c.trim()).filter(Boolean),
        category: finalCategory,
      };

      if (isEditing && initialProduct) {
        return updateFn({ data: { id: initialProduct.id, ...payload } });
      } else {
        return createFn({ data: payload });
      }
    },
    onSuccess: () => {
      toast.success(isEditing ? "Product updated successfully" : "Product created successfully");
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["category-suggestions"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save product"),
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border w-full max-w-3xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
          <div>
            <span className="text-xs uppercase tracking-widest text-accent font-semibold">
              {isEditing ? "Edit Product" : "Amazon / Flipkart Style Entry"}
            </span>
            <h2 className="text-xl font-bold">{isEditing ? `Edit "${initialProduct?.title}"` : "Add New T-Shirt / Product"}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-secondary">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
          className="p-6 space-y-6"
        >
          {/* Multi-Photo Amazon/Flipkart Uploader Section */}
          <div className="border border-border bg-background/50 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs uppercase tracking-widest font-bold text-accent">
                Product Image Gallery (Upload 4–8 Photos)
              </label>
              <span className="text-xs text-muted-foreground">First image is Main Cover</span>
            </div>
            <MultiImageUploader
              initialUrls={imageUrls}
              onUrlsChange={setImageUrls}
              maxFiles={8}
            />
          </div>

          {/* Form Fields */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Title *</label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. WEEKDAYZZ OVERSIZED HEAVYWEIGHT TEE"
                className="mt-1 w-full bg-background border border-border px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Slug (Optional)</label>
              <input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="weekdayz-oversized-heavyweight-tee"
                className="mt-1 w-full bg-background border border-border px-3 py-2 text-sm font-mono"
              />
            </div>

            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Category *</label>
              <CategoryDropdown
                value={form.categorySelect}
                onChange={(val) => setForm({ ...form, categorySelect: val })}
                presetCategories={presetCategories}
                allCategories={allCategoryList}
              />
            </div>

            {form.categorySelect === "other" && (
              <div>
                <label className="text-xs uppercase tracking-widest text-accent font-semibold">
                  Type Custom Category Name *
                </label>
                <input
                  value={form.customCategory}
                  onChange={(e) => setForm({ ...form, customCategory: e.target.value })}
                  placeholder="e.g. Oversized Jacket, F1 Capsule, Crop Top"
                  className="mt-1 w-full bg-accent/5 border border-accent px-3 py-2 text-sm font-semibold uppercase tracking-wider"
                  required
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Will be saved in database for future suggestions.
                </p>
              </div>
            )}

            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Sale Price (₹) *</label>
              <input
                type="number"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className="mt-1 w-full bg-background border border-border px-3 py-2 text-sm font-mono"
                required
              />
              <p className="text-[11px] text-muted-foreground mt-1">The price customers actually pay.</p>
            </div>

            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                Actual Price / MRP (₹)
              </label>
              <input
                type="number"
                value={form.compareAtPrice}
                onChange={(e) => setForm({ ...form, compareAtPrice: e.target.value })}
                placeholder="Optional — shown crossed-out as MRP"
                className="mt-1 w-full bg-background border border-border px-3 py-2 text-sm font-mono"
                min={0}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Higher than sale price → displayed as strikethrough MRP. Leave blank for no MRP.
              </p>
            </div>

            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Stock Inventory *</label>
              <input
                type="number"
                value={form.inventory}
                onChange={(e) => setForm({ ...form, inventory: e.target.value })}
                className="mt-1 w-full bg-background border border-border px-3 py-2 text-sm font-mono"
                required
              />
            </div>

            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Available Sizes (Comma Separated)</label>
              <input
                value={form.sizes}
                onChange={(e) => setForm({ ...form, sizes: e.target.value })}
                placeholder="S, M, L, XL, XXL"
                className="mt-1 w-full bg-background border border-border px-3 py-2 text-sm font-mono"
              />
            </div>

            <div className="sm:col-span-2 space-y-2 border border-border p-3.5 bg-background/50">
              <div className="flex items-center justify-between">
                <label className="text-xs uppercase tracking-widest text-foreground font-bold">
                  Available Color Variants (Type any custom color)
                </label>
                <span className="text-[10px] text-muted-foreground">Type any custom colors or click quick presets</span>
              </div>

              <input
                value={form.colors}
                onChange={(e) => setForm({ ...form, colors: e.target.value })}
                placeholder="e.g. Black, White, Crimson Red, Navy Blue, Sage Green (Comma separated)"
                className="w-full bg-background border border-border px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
              />

              {/* Active Colors Pills */}
              {form.colors.split(",").map((c: string) => c.trim()).filter(Boolean).length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Active:</span>
                  {form.colors
                    .split(",")
                    .map((c: string) => c.trim())
                    .filter(Boolean)
                    .map((c: string, idx: number) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-foreground text-background font-semibold uppercase tracking-wider"
                      >
                        {c}
                        <button
                          type="button"
                          onClick={() => {
                            const list = form.colors.split(",").map((x: string) => x.trim()).filter(Boolean);
                            const updated = list.filter((_: string, i: number) => i !== idx);
                            setForm({ ...form, colors: updated.join(", ") });
                          }}
                          className="hover:text-destructive transition-colors ml-0.5"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                </div>
              )}

              {/* Quick Add Presets */}
              <div className="pt-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5 font-semibold">
                  Quick Add Presets:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "Black",
                    "White",
                    "Red",
                    "Navy Blue",
                    "Olive Green",
                    "Cream",
                    "Charcoal",
                    "Beige",
                    "Pink",
                    "Gold",
                    "Maroon",
                    "Lavender",
                    "Brown",
                  ].map((preset) => {
                    const currentList = form.colors.split(",").map((x: string) => x.trim().toLowerCase());
                    const isAdded = currentList.includes(preset.toLowerCase());
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          const list = form.colors.split(",").map((x: string) => x.trim()).filter(Boolean);
                          if (isAdded) {
                            const updated = list.filter((x: string) => x.toLowerCase() !== preset.toLowerCase());
                            setForm({ ...form, colors: updated.join(", ") });
                          } else {
                            const updated = [...list, preset];
                            setForm({ ...form, colors: updated.join(", ") });
                          }
                        }}
                        className={`px-2.5 py-1 text-[11px] font-mono border transition-all ${
                          isAdded
                            ? "border-accent bg-accent/10 text-accent font-bold"
                            : "border-border hover:border-foreground text-muted-foreground"
                        }`}
                      >
                        {isAdded ? `✓ ${preset}` : `+ ${preset}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                placeholder="Heavyweight 240 GSM 100% Terry Cotton Tee with high-density print."
                className="mt-1 w-full bg-background border border-border px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-border flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-xs uppercase tracking-widest border border-border hover:bg-secondary font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="bg-accent text-accent-foreground px-6 py-2.5 text-xs uppercase tracking-widest font-bold disabled:opacity-50"
            >
              {saveMutation.isPending ? "Saving Product…" : isEditing ? "Save Changes" : "Publish Product"}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
