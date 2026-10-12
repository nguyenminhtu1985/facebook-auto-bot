import { randomUUID } from "crypto";
import { findProvider } from "@/lib/db/providers";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { ImageSource, ImageSourcePref } from "@/lib/types";
import { getSettings } from "@/lib/db/settings";
import { GRAPH_BASE } from "@/lib/facebook/oauth";
const STORAGE_BUCKET = "post-images";

// Square reads well in the Facebook feed on both mobile and desktop, and
// avoids the centre-crop that wide images get in the timeline.
const WIDTH = 1200;
const HEIGHT = 1200;

export function resolveImageSource(pref: ImageSourcePref): ImageSource {
  if (pref === "mixed") return Math.random() < 0.5 ? "ai" : "stock";
  return pref;
}
/** Folder in the post-images bucket holding the owner's own photos. */
const LIBRARY_FOLDER = "library";

/**
 * Picks a random photo the owner uploaded to the `library/` folder of the
 * post-images bucket (Supabase Dashboard → Storage), or synced from the
 * Facebook Page with the "Sync photos from Page" button.
 */
async function pickLibraryImage(): Promise<{ url: string; source: ImageSource }> {
  const db = supabaseAdmin();
  const { data, error } = await db.storage.from(STORAGE_BUCKET).list(LIBRARY_FOLDER, { limit: 1000 });
  if (error) throw new Error(`Photo library list failed: ${error.message}`);
  const files = (data ?? []).filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f.name));
  if (files.length === 0) {
    throw new Error("Photo library is empty — sync photos from your Page or upload some to the library/ folder first");
  }
  const chosen = files[Math.floor(Math.random() * files.length)];
  const { data: urlData } = db.storage.from(STORAGE_BUCKET).getPublicUrl(`${LIBRARY_FOLDER}/${chosen.name}`);
  return { url: urlData.publicUrl, source: "library" };
}

/**
 * Downloads the default Page's own photos via the Graph API and stores them
 * in the `library/` folder, skipping ones already imported. Returns counts.
 */
export async function syncPhotosFromPage(): Promise<{ imported: number; skipped: number }> {
  const settings = await getSettings();
  const pageId = settings.default_page_id;
  const token = settings.default_page_token;
  if (!pageId || !token) throw new Error("Connect a Facebook Page first");

  const db = supabaseAdmin();
  const { data: existing } = await db.storage.from(STORAGE_BUCKET).list(LIBRARY_FOLDER, { limit: 1000 });
  const seen = new Set((existing ?? []).map((f) => f.name));

  let imported = 0;
  let skipped = 0;
  let url: string | null =
    `${GRAPH_BASE}/${pageId}/photos?` +
    new URLSearchParams({ fields: "images", limit: "50", access_token: token });
  while (url && imported + skipped < 200) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Facebook photos API returned ${res.status}`);
    const data = await res.json();
    for (const photo of data.data ?? []) {
      const images = [...(photo.images ?? [])].sort(
        (a: { width: number }, b: { width: number }) => b.width - a.width
      );
      if (!images.length) continue;
      const name = `${photo.id}.jpg`;
      if (seen.has(name)) {
        skipped++;
        continue;
      }
      try {
        const imgRes = await fetch(images[0].source, { signal: AbortSignal.timeout(30_000) });
        if (!imgRes.ok) continue;
        const bytes = new Uint8Array(await imgRes.arrayBuffer());
        const { error } = await db.storage
          .from(STORAGE_BUCKET)
          .upload(`${LIBRARY_FOLDER}/${name}`, bytes, { contentType: "image/jpeg", upsert: false });
        if (!error) {
          imported++;
          seen.add(name);
        }
      } catch {
        // Skip one bad photo, keep going with the rest.
      }
    }
    url = data.paging?.next ?? null;
  }
  return { imported, skipped };
}

/**
 * Topics phrased as listicles ("easy weeknight dinner ideas") make the model
 * return a grid of thumbnails, which reads as a stock collage in the feed.
 * Steering it toward one photographed subject fixes that.
 */
const PHOTO_STYLE =
  "single subject, professional photograph, natural light, shallow depth of field, high detail, no text, no watermark, no collage, no grid";

async function fetchAiImageBytes(prompt: string): Promise<Blob> {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    `${prompt}, ${PHOTO_STYLE}`
  )}?width=${WIDTH}&height=${HEIGHT}&nologo=true&seed=${Math.floor(Math.random() * 1_000_000)}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Pollinations image API ${res.status}`);
  return res.blob();
}

async function fetchStockImageBytes(query: string): Promise<Blob> {
  const pexels = await findProvider("pexels");
  const key = pexels?.enabled ? pexels.apiKey : null;
  if (!key) throw new Error("No Pexels key is set up on the Providers screen");

  const searchUrl = `https://api.pexels.com/v1/search?${new URLSearchParams({
    query,
    orientation: "square",
    per_page: "10",
  })}`;
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: key },
    signal: AbortSignal.timeout(15_000),
  });
  if (!searchRes.ok) throw new Error(`Pexels search failed (${searchRes.status})`);
  const data = await searchRes.json();
  const photos: Array<{ src: { large2x: string; large: string } }> = data.photos ?? [];
  if (photos.length === 0) throw new Error("No stock photos found for this topic");

  const chosen = photos[Math.floor(Math.random() * photos.length)];
  const imageRes = await fetch(chosen.src.large2x ?? chosen.src.large, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!imageRes.ok) throw new Error("Failed to download chosen stock photo");
  return imageRes.blob();
}

/**
 * Generates or sources a post image, then re-hosts it in our own Supabase
 * Storage bucket rather than linking the free provider's URL directly. Both
 * free providers are best-effort community services with no uptime guarantee —
 * re-hosting means a post's image keeps working forever, and Facebook's own
 * fetcher (which downloads the image itself at publish time) always sees a
 * stable, fast, first-party URL.
 */
export async function generateImage(
  prompt: string,
  pref: ImageSourcePref
): Promise<{ url: string; source: ImageSource }> {
  const source = resolveImageSource(pref);
// Owner's photo library: no generation, just pick a random uploaded photo.
if (source === "library") {
  return pickLibraryImage();
}

  let blob: Blob;
  try {
    blob = source === "ai" ? await fetchAiImageBytes(prompt) : await fetchStockImageBytes(prompt);
  } catch (err) {
    // Fall back to the other free source rather than failing the whole generation.
    const fallbackSource: ImageSource = source === "ai" ? "stock" : "ai";
    try {
      blob =
        fallbackSource === "ai"
          ? await fetchAiImageBytes(prompt)
          : await fetchStockImageBytes(prompt);
      return await upload(blob, fallbackSource);
    } catch {
      throw err instanceof Error ? err : new Error("Image generation failed");
    }
  }

  return upload(blob, source);
}

async function upload(blob: Blob, source: ImageSource): Promise<{ url: string; source: ImageSource }> {
  const db = supabaseAdmin();
  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.jpg`;
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const { error } = await db.storage.from(STORAGE_BUCKET).upload(path, bytes, {
    contentType: blob.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = db.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, source };
}
