export type ImageSource = "ai" | "stock";
export type ImageSourcePref = "ai" | "stock" | "mixed";
export type PostStatus = "draft" | "scheduled" | "posted" | "failed";

/**
 * Where autopilot gets its subjects. "mine" rotates through the owner's own
 * topic list and only borrows trending ideas while that list is empty.
 */
export type TopicSource = "mine" | "trending" | "mixed";

export interface Topic {
  id: string;
  text: string;
  enabled: boolean;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
}

export interface AppSettings {
  id: 1;
  /** Meta app credentials, normally entered in Settings rather than env vars. */
  facebook_app_id: string | null;
  facebook_app_secret: string | null;
  /**
   * Facebook Login for Business "login configuration" id. Apps created with the
   * Page-management use case get Login for Business, where config_id replaces
   * scope — the permissions come from the saved configuration instead of the
   * URL. Null means the app uses classic Facebook Login and scopes.
   */
  facebook_config_id: string | null;
  /** Long-lived user token — lists Pages and mints Page tokens, never posts. */
  facebook_user_token: string | null;
  facebook_token_expires_at: string | null;
  facebook_user_name: string | null;
  default_page_id: string | null;
  default_page_name: string | null;
  /** Page tokens derived from a long-lived user token do not expire. */
  default_page_token: string | null;
  /**
   * Instagram professional account linked to the selected Page. Publishing
   * goes through the Page token, so Instagram needs no token of its own.
   * Absent on databases created before Instagram support.
   */
  instagram_user_id?: string | null;
  instagram_username?: string | null;
  post_to_facebook?: boolean;
  post_to_instagram?: boolean;
  image_source: ImageSourcePref;
  utm_suffix: string;
  auto_post_enabled: boolean;
  posts_per_day: number;
  posting_hours: number[];
  timezone: string;
  last_auto_post_at: string | null;
  /** Absent on databases created before topics existed; treat as "mine". */
  topic_source?: TopicSource;
  updated_at: string;
}

export interface Post {
  id: string;
  topic: string;
  title: string;
  description: string;
  hashtags: string[];
  image_url: string;
  image_source: ImageSource;
  link_url: string | null;
  page_id: string | null;
  page_name: string | null;
  status: PostStatus;
  scheduled_at: string | null;
  posted_at: string | null;
  facebook_post_id: string | null;
  instagram_post_id?: string | null;
  instagram_permalink?: string | null;
  error_message: string | null;
  created_at: string;
}

export interface PageCache {
  page_id: string;
  name: string;
  category: string | null;
  instagram_username?: string | null;
  fetched_at: string;
}

/** Which service actually wrote the copy. "template" means every configured
 *  provider was unreachable and the deterministic fallback was used. */
export type ContentProvider =
  | "groq"
  | "gemini"
  | "anthropic"
  | "openai"
  | "pollinations"
  | "template";

export interface GeneratedContent {
  title: string;
  description: string;
  hashtags: string[];
  provider?: ContentProvider;
  /** First provider failure, surfaced so a degraded draft can explain itself. */
  providerError?: string;
}

/**
 * Public URL of a published post. Facebook returns `post_id` as
 * `<page-id>_<post-id>`, and that composite is itself addressable.
 */
export const facebookPostUrl = (postId: string) => `https://www.facebook.com/${postId}`;

/**
 * Links to a published post, one per destination it reached. Instagram only
 * appears once Meta has returned a permalink — a media id alone cannot be
 * turned into a URL.
 */
export function postLinks(
  post: Pick<Post, "facebook_post_id" | "instagram_permalink">
): { label: string; url: string }[] {
  const links: { label: string; url: string }[] = [];
  if (post.facebook_post_id) links.push({ label: "Facebook", url: facebookPostUrl(post.facebook_post_id) });
  if (post.instagram_permalink) links.push({ label: "Instagram", url: post.instagram_permalink });
  return links;
}

/** Where a post went. Both can be on at once. */
export type PostTarget = "facebook" | "instagram";

export function selectedTargets(
  s: Pick<AppSettings, "post_to_facebook" | "post_to_instagram">
): PostTarget[] {
  const targets: PostTarget[] = [];
  // Undefined on databases older than Instagram support, where Facebook was
  // the only destination.
  if (s.post_to_facebook !== false) targets.push("facebook");
  if (s.post_to_instagram === true) targets.push("instagram");
  return targets;
}

export const isFacebookConnected = (s: Pick<AppSettings, "facebook_user_token">) =>
  Boolean(s.facebook_user_token);

/**
 * Facebook takes one `message` per post, so the separately-edited parts are
 * composed here — one place, shared by the publisher and the preview.
 */
export function composeMessage(
  post: Pick<Post, "title" | "description" | "hashtags" | "link_url">,
  utmSuffix = ""
): string {
  const tags = post.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ");
  return [post.title, post.description, post.link_url ?? "", tags, utmSuffix]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}
