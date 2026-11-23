import { supabase } from "@/integrations/supabase/client";

/**
 * Uploads a file to a private bucket with real progress events.
 * Uses a one-time signed upload link (folder rules are checked when it's created),
 * then streams the file with XHR so the UI can show a live progress bar.
 */
export async function uploadWithProgress(bucket: string, path: string, blob: Blob, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  const signed = await supabase.storage.from(bucket).createSignedUploadUrl(path);
  if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error("upload_link_failed");
  const url = signed.data.signedUrl;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", blob.type || "application/octet-stream");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("x-upsert", "false");
    const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined;
    if (key) xhr.setRequestHeader("apikey", key);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload_failed_${xhr.status}`)));
    xhr.onerror = () => reject(new Error("upload_network_error"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
  onProgress(1);
}
