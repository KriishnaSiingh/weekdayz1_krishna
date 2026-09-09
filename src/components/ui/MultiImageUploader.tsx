import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, X, CheckCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { uploadProductImage } from "@/lib/admin.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

/**
 * Compresses an image before upload using the Canvas API.
 * - Resizes to max 1400×1400 (preserving aspect ratio) — enough for crisp product zoom
 * - Re-encodes as WebP @ 82% quality (~30–40% smaller than raw JPEG, no visible loss)
 * - Falls back to JPEG if WebP is unsupported (very rare)
 */
async function compressImage(file: File): Promise<{ blob: Blob; filename: string; contentType: string }> {
  const MAX_SIDE = 1400;
  const QUALITY = 0.82;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;
      if (width > MAX_SIDE || height > MAX_SIDE) {
        if (width > height) {
          height = Math.round((height * MAX_SIDE) / width);
          width = MAX_SIDE;
        } else {
          width = Math.round((width * MAX_SIDE) / height);
          height = MAX_SIDE;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);

      // Try WebP first — best compression with no visible loss
      canvas.toBlob(
        (blob) => {
          if (blob) {
            const baseName = file.name.replace(/\.[^.]+$/, "");
            resolve({ blob, filename: `${baseName}.webp`, contentType: "image/webp" });
          } else {
            // Fallback to JPEG if WebP toBlob fails
            canvas.toBlob(
              (jpegBlob) => {
                if (jpegBlob) {
                  const baseName = file.name.replace(/\.[^.]+$/, "");
                  resolve({ blob: jpegBlob, filename: `${baseName}.jpg`, contentType: "image/jpeg" });
                } else {
                  reject(new Error("Image compression failed"));
                }
              },
              "image/jpeg",
              QUALITY
            );
          }
        },
        "image/webp",
        QUALITY
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image for compression"));
    };
    img.src = objectUrl;
  });
}

interface UploadedImage {
  id: string;
  file?: File;
  preview: string;
  status: "uploading" | "done" | "error";
  publicUrl?: string;
}

interface MultiImageUploaderProps {
  onUrlsChange: (urls: string[]) => void;
  initialUrls?: string[];
  maxFiles?: number;
}

export function MultiImageUploader({
  onUrlsChange,
  initialUrls = [],
  maxFiles = 8,
}: MultiImageUploaderProps) {
  const uploadProductImageFn = useServerFn(uploadProductImage);
  const [images, setImages] = useState<UploadedImage[]>(() =>
    initialUrls.map((url) => ({
      id: crypto.randomUUID(),
      preview: url,
      status: "done" as const,
      publicUrl: url,
    }))
  );

  const notifyChange = useCallback(
    (imgs: UploadedImage[]) => {
      const urls = imgs
        .filter((i) => i.status === "done" && i.publicUrl)
        .map((i) => i.publicUrl!);
      onUrlsChange(urls);
    },
    [onUrlsChange]
  );

  const uploadFile = useCallback(
    async (img: UploadedImage) => {
      if (!img.file) return;

      // Compress before upload: resize to max 1400px, re-encode as WebP @ 82% quality
      let blob: Blob = img.file;
      let filename = img.file.name;
      let contentType = img.file.type;
      try {
        const compressed = await compressImage(img.file);
        blob = compressed.blob;
        filename = compressed.filename;
        contentType = compressed.contentType;
      } catch (_) {
        // If compression fails for any reason, fall back to the original file
      }

      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result as string;

        try {
          const res = await uploadProductImageFn({
            data: {
              base64: base64Data,
              filename,
              contentType,
            },
          });

          if (res?.url) {
            setImages((prev) => {
              const next = prev.map((i) =>
                i.id === img.id
                  ? { ...i, status: "done" as const, publicUrl: res.url, preview: res.url }
                  : i
              );
              notifyChange(next);
              return next;
            });
            return;
          }
        } catch (_) {}

        try {
          const ext = filename.split(".").pop() ?? "webp";
          const path = `products/${crypto.randomUUID()}.${ext}`;
          const { error } = await supabase.storage
            .from("product-images")
            .upload(path, blob, { upsert: false, contentType });

          if (!error) {
            const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
            const publicUrl = urlData.publicUrl;
            setImages((prev) => {
              const next = prev.map((i) =>
                i.id === img.id
                  ? { ...i, status: "done" as const, publicUrl, preview: publicUrl }
                  : i
              );
              notifyChange(next);
              return next;
            });
            return;
          }
        } catch (_) {}

        // Fallback: use base64 data URL if Supabase storage is unconfigured or blocked by RLS
        setImages((prev) => {
          const next = prev.map((i) =>
            i.id === img.id
              ? { ...i, status: "done" as const, publicUrl: base64Data, preview: base64Data }
              : i
          );
          notifyChange(next);
          return next;
        });
      };
      reader.readAsDataURL(blob);
    },
    [notifyChange, uploadProductImageFn]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const newImgs: UploadedImage[] = acceptedFiles.slice(0, maxFiles - images.length).map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        preview: URL.createObjectURL(f),
        status: "uploading" as const,
      }));
      setImages((prev) => [...prev, ...newImgs]);
      newImgs.forEach((img) => uploadFile(img));
    },
    [images.length, maxFiles, uploadFile]
  );

  const remove = (id: string) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img?.preview && img.file) URL.revokeObjectURL(img.preview);
      const next = prev.filter((i) => i.id !== id);
      notifyChange(next);
      return next;
    });
  };

  const setPrimary = (index: number) => {
    if (index === 0) return;
    setImages((prev) => {
      const copy = [...prev];
      const [chosen] = copy.splice(index, 1);
      copy.unshift(chosen);
      notifyChange(copy);
      return copy;
    });
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
    multiple: true,
    disabled: images.length >= maxFiles,
  });

  return (
    <div className="space-y-3">
      {images.length < maxFiles && (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
            isDragActive ? "border-accent bg-accent/5" : "border-border hover:border-accent/60"
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="h-5 w-5 mx-auto mb-2 text-accent" />
          <p className="text-sm font-semibold">
            {isDragActive ? "Drop images here" : "Drag & drop or click to upload photos"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Amazon / Flipkart style gallery · Max 8 photos (PNG/JPG/WEBP)
          </p>
        </div>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <AnimatePresence>
            {images.map((img, idx) => (
              <motion.div
                key={img.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="relative aspect-square border border-border bg-black/40 overflow-hidden group"
              >
                <img src={img.preview || img.publicUrl} alt="" className="w-full h-full object-contain p-1" />

                {/* Cover Photo Badge */}
                {idx === 0 && (
                  <span className="absolute top-1.5 left-1.5 bg-accent text-accent-foreground text-[9px] uppercase font-bold tracking-widest px-1.5 py-0.5 shadow">
                    Primary Cover
                  </span>
                )}

                {img.status === "uploading" && (
                  <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1">
                    <Loader2 className="h-5 w-5 text-accent animate-spin" />
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-white">Uploading…</span>
                  </div>
                )}

                {img.status === "done" && idx !== 0 && (
                  <button
                    type="button"
                    onClick={() => setPrimary(idx)}
                    className="absolute top-1.5 left-1.5 bg-background/90 text-foreground text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    Make Cover
                  </button>
                )}

                {img.status === "done" && (
                  <div className="absolute top-1.5 right-7">
                    <CheckCircle className="h-4 w-4 text-emerald-400 drop-shadow" />
                  </div>
                )}

                {img.status === "error" && (
                  <div className="absolute inset-0 bg-destructive/40 flex items-center justify-center">
                    <span className="text-xs text-white font-semibold">Error</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => remove(img.id)}
                  className="absolute top-1 right-1 p-1 bg-black/70 text-white hover:bg-destructive transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
