import { supabase } from "@/integrations/supabase/client";

export const AVATAR_BUCKET = "avatars";
const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

/** Square-crops and shrinks a picture to a fast-loading 512px JPEG. */
async function toSquareJpeg(file: File, size = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no_canvas");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error("encode_failed"))), "image/jpeg", 0.88));
}

/** Uploads a new profile picture to the caller's own folder and saves its link on the profile. */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo (JPG, PNG or WebP).");
  if (file.size > 15 * 1024 * 1024) throw new Error("That photo is too large. Pick one under 15 MB.");
  const blob = await toSquareJpeg(file);
  const path = `${userId}/avatar-${Date.now()}.jpg`;
  const up = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
  if (up.error) throw new Error("Upload failed. Check your connection and try again.");
  // The workspace keeps storage private, so profiles carry a long-lived protected link.
  const signed = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, TEN_YEARS);
  if (signed.error || !signed.data?.signedUrl) throw new Error("Upload failed. Please try again.");
  const { error } = await supabase.from("profiles").update({ avatar_url: signed.data.signedUrl }).eq("id", userId);
  if (error) throw new Error("Your picture uploaded but couldn't be saved. Try again.");
  return signed.data.signedUrl;
}
