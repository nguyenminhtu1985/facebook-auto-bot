import { GRAPH_BASE } from "@/lib/facebook/oauth";

/**
 * Instagram publishing, through the Facebook Login path.
 *
 * Two details shape everything here. Instagram has no token of its own on this
 * path — posting uses the access token of the Facebook Page the Instagram
 * professional account is linked to, against graph.facebook.com. And
 * publishing is two calls, not one: a container is created from a public image
 * URL, then published. Meta fetches that URL itself, which is why every
 * generated image is re-hosted on Supabase Storage as a public JPEG first;
 * Instagram accepts nothing else.
 */

export class InstagramNotLinkedError extends Error {
  constructor() {
    super(
      "No Instagram professional account is linked to this Facebook Page. Link one in the Instagram app (Settings → Account type and tools → Switch to professional account, then connect the Page), then press Refresh in Settings."
    );
  }
}

async function graph(
  path: string,
  params: Record<string, string>,
  init?: { method: "POST" }
) {
  const url = `${GRAPH_BASE}${path}`;
  const res = await fetch(init?.method === "POST" ? url : `${url}?${new URLSearchParams(params)}`, {
    ...(init?.method === "POST"
      ? {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(params),
        }
      : {}),
    signal: AbortSignal.timeout(30_000),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || body?.error) {
    const err = new Error(body?.error?.message ?? `Instagram API ${path} failed (${res.status})`);
    // Carried so the publish step can tell "not ready yet" apart from a real
    // failure without matching on message text.
    (err as Error & { code?: number }).code = body?.error?.code;
    throw err;
  }
  return body;
}

export interface LinkedAccount {
  id: string;
  username: string;
}

/** The Instagram professional account attached to a Page, if there is one. */
export async function fetchLinkedAccount(
  pageId: string,
  pageToken: string
): Promise<LinkedAccount | null> {
  const data = await graph(`/${pageId}`, {
    fields: "instagram_business_account{id,username}",
    access_token: pageToken,
  });
  const account = data.instagram_business_account;
  return account?.id ? { id: account.id, username: account.username ?? "" } : null;
}

export interface PublishInput {
  igUserId: string;
  pageToken: string;
  imageUrl: string;
  caption: string;
}

const NOT_READY = 9007;

/** Publishes one photo and returns its media id and permalink. */
export async function publishPhoto(
  input: PublishInput
): Promise<{ id: string; permalink: string | null }> {
  const container = await graph(
    `/${input.igUserId}/media`,
    {
      image_url: input.imageUrl,
      caption: input.caption,
      access_token: input.pageToken,
    },
    { method: "POST" }
  );

  // Meta downloads the image asynchronously, so the container is briefly not
  // publishable. Retrying beats polling the status endpoint: it is one call
  // instead of two in the common case, and the whole request has to finish
  // inside the serverless timeout.
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const published = await graph(
        `/${input.igUserId}/media_publish`,
        { creation_id: container.id, access_token: input.pageToken },
        { method: "POST" }
      );

      let permalink: string | null = null;
      try {
        const media = await graph(`/${published.id}`, {
          fields: "permalink",
          access_token: input.pageToken,
        });
        permalink = media.permalink ?? null;
      } catch {
        // The post exists; only the convenience link is missing.
      }

      return { id: published.id, permalink };
    } catch (err) {
      lastError = err;
      if ((err as { code?: number }).code !== NOT_READY) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Instagram did not finish processing the image in time.");
}

/** How many of the 24-hour publishing allowance is left, when Meta reports it. */
export async function remainingQuota(
  igUserId: string,
  pageToken: string
): Promise<{ used: number; limit: number } | null> {
  try {
    const data = await graph(`/${igUserId}/content_publishing_limit`, {
      fields: "config,quota_usage",
      access_token: pageToken,
    });
    const row = data.data?.[0];
    if (!row) return null;
    return { used: row.quota_usage ?? 0, limit: row.config?.quota_total ?? 100 };
  } catch {
    return null;
  }
}
