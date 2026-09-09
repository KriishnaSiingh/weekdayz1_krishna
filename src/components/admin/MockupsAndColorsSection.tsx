import React, { useEffect, useState } from "react";
import {
  fetchLocalMockupColors,
  saveLocalMockupColors,
  getMockupSettingsServer,
  saveMockupSettingsServer,
  MockupColor,
  DEFAULT_MOCKUP_COLORS,
} from "@/lib/mockups";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  Plus,
  Trash2,
  Edit2,
  Eye,
  EyeOff,
  Check,
  RotateCcw,
  Sparkles,
  Layers,
  Palette,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useDropzone } from "react-dropzone";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

function compressDataUrl(dataUrl: string, maxDim = 1400, quality = 0.82): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(dataUrl);
        ctx.drawImage(img, 0, 0, w, h);
        // Use WebP for best compression; fall back to JPEG
        const webp = canvas.toDataURL("image/webp", quality);
        resolve(webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** Compress a File to a WebP Blob (falls back to JPEG). Used before Supabase storage uploads. */
function compressFileToBlob(file: File, maxDim = 1400, quality = 0.82): Promise<{ blob: Blob; ext: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve({ blob, ext: "webp", contentType: "image/webp" });
          else {
            canvas.toBlob(
              (jpegBlob) => {
                if (jpegBlob) resolve({ blob: jpegBlob, ext: "jpg", contentType: "image/jpeg" });
                else reject(new Error("Compression failed"));
              },
              "image/jpeg",
              quality
            );
          }
        },
        "image/webp",
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Image load failed")); };
    img.src = objectUrl;
  });
}


export default function MockupsAndColorsSection() {
  const [colors, setColors] = useState<MockupColor[]>([]);
  const [editingColor, setEditingColor] = useState<MockupColor | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [uploadingSide, setUploadingSide] = useState<"front" | "back" | "sleeve" | null>(null);

  const getSettingsServerFn = useServerFn(getMockupSettingsServer);
  const saveSettingsServerFn = useServerFn(saveMockupSettingsServer);

  useEffect(() => {
    setColors(fetchLocalMockupColors());
    getSettingsServerFn()
      .then((serverData) => {
        if (serverData && serverData.length > 0) {
          setColors(serverData);
          saveLocalMockupColors(serverData);
        }
      })
      .catch(() => {});
  }, []);

  const persist = async (next: MockupColor[]) => {
    setColors(next);
    saveLocalMockupColors(next);
    try {
      await saveSettingsServerFn({ data: next });
      toast.success("Mockup & color settings synced to server!");
    } catch (e: any) {
      toast.error(e?.message || "Saved locally; server sync pending.");
    }
  };

  const handleUploadMockup = async (file: File, side: "front" | "back" | "sleeve") => {
    if (!editingColor) return;
    setUploadingSide(side);
    try {
      // Compress to WebP before uploading — saves ~40% storage vs raw JPEG/PNG
      let blob: Blob = file;
      let ext = file.name.split(".").pop() || "jpg";
      let contentType = file.type;
      try {
        const compressed = await compressFileToBlob(file);
        blob = compressed.blob;
        ext = compressed.ext;
        contentType = compressed.contentType;
      } catch (_) {}

      const filename = `mockup_${editingColor.id || crypto.randomUUID()}_${side}_${Date.now()}.${ext}`;

      const { data, error } = await supabase.storage
        .from("product-images")
        .upload(filename, blob, { upsert: true, contentType });

      let publicUrl = "";
      if (!error && data) {
        const { data: pubData } = supabase.storage.from("product-images").getPublicUrl(data.path);
        publicUrl = pubData.publicUrl;
      } else {
        // Fallback to base64 data URL from the compressed blob
        const reader = new FileReader();
        publicUrl = await new Promise((resolve) => {
          reader.onload = async (e) => {
            const compressed = await compressDataUrl(e.target?.result as string);
            resolve(compressed);
          };
          reader.readAsDataURL(blob);
        });
      }

      if (side === "front") setEditingColor({ ...editingColor, frontMockup: publicUrl });
      else if (side === "back") setEditingColor({ ...editingColor, backMockup: publicUrl });
      else if (side === "sleeve") setEditingColor({ ...editingColor, sleeveMockup: publicUrl });

      toast.success(`${side.toUpperCase()} mockup image uploaded!`);
    } catch (e: any) {
      toast.error("Failed to upload mockup: " + e.message);
    } finally {
      setUploadingSide(null);
    }
  };

  const handleSaveColor = async () => {
    if (!editingColor) return;
    if (!editingColor.name.trim() || !editingColor.hex.trim()) {
      toast.error("Please enter a valid Color Name and HEX code.");
      return;
    }

    let next: MockupColor[];
    if (isNew) {
      next = [...colors, editingColor];
    } else {
      next = colors.map((c) => (c.id === editingColor.id ? editingColor : c));
    }

    await persist(next);
    setEditingColor(null);
    setIsNew(false);
  };

  const handleDeleteColor = async (id: string) => {
    if (colors.length <= 1) {
      toast.error("You must have at least one color option available.");
      return;
    }
    const next = colors.filter((c) => c.id !== id);
    await persist(next);
    toast.success("Color removed");
  };

  const handleToggleActive = async (id: string) => {
    const next = colors.map((c) => (c.id === id ? { ...c, isActive: !c.isActive } : c));
    await persist(next);
  };

  const handleResetDefaults = async () => {
    if (confirm("Reset all mockup colors back to system defaults?")) {
      await persist(DEFAULT_MOCKUP_COLORS);
      toast.success("Reset to default colors.");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <span className="text-xs font-bold uppercase tracking-[0.25em] text-accent">Product Studio Config</span>
          <h2 className="text-display text-3xl sm:text-4xl font-black mt-1">Mockup &amp; Color Management</h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Dynamically add colors and upload Front, Back, and Side Sleeve mockups for the "Create Your Own" studio.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleResetDefaults}
            className="inline-flex items-center gap-1.5 border border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider hover:bg-secondary transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Defaults
          </button>
          <button
            onClick={() => {
              setIsNew(true);
              setEditingColor({
                id: "color-" + crypto.randomUUID().slice(0, 8),
                name: "",
                hex: "#333333",
                frontMockup: "/products/tee-black.jpg",
                backMockup: "/products/tee-black.jpg",
                sleeveMockup: "/products/tee-black.jpg",
                isActive: true,
              });
            }}
            className="inline-flex items-center gap-2 bg-foreground text-background px-4 py-2 text-xs font-black uppercase tracking-wider hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" /> Add New Color
          </button>
        </div>
      </div>

      {/* Colors Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {colors.map((c) => (
          <div
            key={c.id}
            className={cn(
              "bg-card border rounded-2xl p-5 space-y-4 shadow-sm transition-all relative",
              c.isActive ? "border-border hover:border-foreground/40" : "border-dashed border-border/60 opacity-65",
            )}
          >
            {/* Header: Color Swatch + Name + Hex */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="h-9 w-9 rounded-full border-2 border-border shadow-inner flex-shrink-0"
                  style={{ backgroundColor: c.hex }}
                />
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider">{c.name}</h3>
                  <span className="text-xs text-muted-foreground font-mono">{c.hex}</span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleToggleActive(c.id)}
                  title={c.isActive ? "Deactivate" : "Activate"}
                  className="p-1.5 text-muted-foreground hover:text-foreground"
                >
                  {c.isActive ? <Eye className="h-4 w-4 text-emerald-600" /> : <EyeOff className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => {
                    setIsNew(false);
                    setEditingColor({ ...c });
                  }}
                  title="Edit Mockups & Color"
                  className="p-1.5 text-muted-foreground hover:text-foreground"
                >
                  <Edit2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDeleteColor(c.id)}
                  title="Delete Color"
                  className="p-1.5 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Mockup Previews for Front, Back, Sleeve */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
              {[
                { label: "Front", src: c.frontMockup },
                { label: "Back", src: c.backMockup },
                { label: "Sleeve", src: c.sleeveMockup },
              ].map((m) => (
                <div key={m.label} className="flex flex-col items-center gap-1 text-center">
                  <div className="w-full aspect-square rounded-lg overflow-hidden border border-border bg-secondary/30 p-1 flex items-center justify-center">
                    {m.src ? (
                      <img src={m.src} alt={m.label} className="w-full h-full object-contain" />
                    ) : (
                      <ImageIcon className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">{m.label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── EDIT / CREATE MODAL ── */}
      {editingColor && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-3xl max-w-xl w-full p-6 sm:p-8 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <h3 className="text-xl font-black">{isNew ? "Add New Garment Color" : "Edit Color & Mockups"}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Configure the color name, hex code, and view images for Front, Back, and Side Sleeve.
                </p>
              </div>
              <div
                className="h-8 w-8 rounded-full border-2 border-border shadow"
                style={{ backgroundColor: editingColor.hex }}
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-foreground">Color Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Forest Green"
                  value={editingColor.name}
                  onChange={(e) => setEditingColor({ ...editingColor, name: e.target.value })}
                  className="w-full border border-border bg-background px-3 py-2 text-xs font-semibold outline-none focus:border-foreground"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-foreground">HEX Value *</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={editingColor.hex}
                    onChange={(e) => setEditingColor({ ...editingColor, hex: e.target.value })}
                    className="h-9 w-10 border border-border rounded cursor-pointer p-0.5"
                  />
                  <input
                    type="text"
                    placeholder="#111111"
                    value={editingColor.hex}
                    onChange={(e) => setEditingColor({ ...editingColor, hex: e.target.value })}
                    className="w-full border border-border bg-background px-3 py-2 text-xs font-mono font-semibold outline-none focus:border-foreground"
                  />
                </div>
              </div>
            </div>

            {/* Mockup Uploads: Front, Back, Side Sleeve */}
            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-foreground block">
                Mockup Coverage: 3 Angles
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {(["front", "back", "sleeve"] as const).map((side) => {
                  const currentSrc =
                    side === "front"
                      ? editingColor.frontMockup
                      : side === "back"
                      ? editingColor.backMockup
                      : editingColor.sleeveMockup;

                  return (
                    <div key={side} className="border border-border p-3 rounded-xl bg-background text-center space-y-2">
                      <div className="text-xs font-black uppercase tracking-wider text-foreground">
                        {side === "sleeve" ? "Side Sleeve" : `${side.toUpperCase()} View`}
                      </div>

                      <div className="aspect-square w-full rounded-lg bg-secondary/40 border border-border overflow-hidden flex items-center justify-center relative group">
                        {currentSrc ? (
                          <img src={currentSrc} alt={side} className="w-full h-full object-contain p-1" />
                        ) : (
                          <ImageIcon className="h-6 w-6 text-muted-foreground" />
                        )}
                        {uploadingSide === side && (
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-[10px] text-white font-bold">
                            Uploading…
                          </div>
                        )}
                      </div>

                      <label className="cursor-pointer inline-flex items-center gap-1 bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 rounded text-[11px] font-bold uppercase tracking-wider transition-colors w-full justify-center">
                        <Upload className="h-3 w-3" />
                        <span>Upload {side}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleUploadMockup(file, side);
                          }}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => setEditingColor(null)}
                className="px-5 py-2.5 text-xs font-bold uppercase tracking-wider border border-border hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveColor}
                className="px-6 py-2.5 text-xs font-black uppercase tracking-widest bg-foreground text-background hover:opacity-90 transition-opacity shadow-lg"
              >
                Save Color &amp; Mockups
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
