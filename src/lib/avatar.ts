import { supabase } from "@/integrations/supabase/client";

export const AVATAR_BUCKET = "avatars";
export const AVATAR_MAX_BYTES = 300 * 1024;
const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Square-crops a photo and compresses it below 300 KB (WebP when supported, else JPEG). */
export async function compressAvatar(file: File, size = 512): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo (JPG, PNG or WebP).");
  if (file.size > 20 * 1024 * 1024) throw new Error("That photo is too large. Pick one under 20 MB.");
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("That photo couldn't be read. Try another one."); });
  const side = Math.min(bitmap.width, bitmap.height);
  let edge = size;
  for (let attempt = 0; attempt < 3; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = edge; canvas.height = edge;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser can't edit photos.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, edge, edge);
    for (const quality of [0.85, 0.72, 0.6, 0.45]) {
      const webp = await encode(canvas, "image/webp", quality);
      const blob = webp?.type === "image/webp" ? webp : await encode(canvas, "image/jpeg", quality);
      if (blob && blob.size <= AVATAR_MAX_BYTES) { bitmap.close(); return blob; }
    }
    edge = Math.round(edge * 0.75);
  }
  bitmap.close();
  throw new Error("Couldn't shrink that photo. Try another one.");
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(blob);
  });
}

/** Uploads a compressed picture to the member's own folder and saves its link on the profile. */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const blob = await compressAvatar(file);
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const up = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
  if (up.error) throw new Error("Upload failed. Check your connection and try again.");
  // Storage stays private in this workspace, so profiles carry a long-lived protected link.
  const signed = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, TEN_YEARS);
  if (signed.error || !signed.data?.signedUrl) throw new Error("Upload failed. Please try again.");
  const { error } = await supabase.from("profiles").update({ avatar_url: signed.data.signedUrl }).eq("id", userId);
  if (error) throw new Error("Your picture uploaded but couldn't be saved. Try again.");
  return signed.data.signedUrl;
}

/** Guests: a small compressed copy kept on this device only. */
export async function localAvatar(file: File): Promise<string> {
  return blobToDataUrl(await compressAvatar(file, 256));
}
