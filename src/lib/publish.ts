import { publishPhoto as publishToFacebook, NoPageSelectedError } from "@/lib/facebook/client";
import {
  publishPhoto as publishToInstagram,
  InstagramNotLinkedError,
} from "@/lib/instagram/client";
import { getPost, updatePostRecord } from "@/lib/db/posts";
import { getSettings } from "@/lib/db/settings";
import { composeMessage, selectedTargets } from "@/lib/types";
import type { Post } from "@/lib/types";

/**
 * Publishes one queued post to every destination that is switched on, and
 * records the outcome. Shared by the "post now" route and the cron worker, so
 * there is exactly one place that decides where a post goes.
 *
 * Destinations are attempted independently: if a post reaches Instagram but
 * Facebook rejects it, that is a published post with a warning attached, not a
 * failure. Only a post that reached nowhere is marked failed.
 */
export async function publishPostNow(postId: string): Promise<Post> {
  const post = await getPost(postId);
  if (!post) throw new Error("Post not found.");

  const settings = await getSettings();

  // A post carries the Page it was written for, but the token lives in
  // settings, so a Page that is no longer the selected one cannot be posted to.
  const pageId = post.page_id ?? settings.default_page_id;
  const pageToken =
    post.page_id && post.page_id !== settings.default_page_id ? null : settings.default_page_token;

  if (!pageId || !pageToken) {
    return updatePostRecord(postId, {
      status: "failed",
      error_message: new NoPageSelectedError().message,
    });
  }

  const targets = selectedTargets(settings);
  if (targets.length === 0) {
    return updatePostRecord(postId, {
      status: "failed",
      error_message:
        "No destination is switched on. Turn on Facebook, Instagram, or both in Settings.",
    });
  }

  const caption = composeMessage(post, settings.utm_suffix);
  const patch: Partial<Post> = {};
  const failures: string[] = [];
  let published = false;

  if (targets.includes("facebook")) {
    try {
      const result = await publishToFacebook({
        pageId,
        pageToken,
        message: caption,
        imageUrl: post.image_url,
      });
      patch.facebook_post_id = result.id;
      published = true;
    } catch (err) {
      failures.push(`Facebook: ${explain(err, "facebook")}`);
    }
  }

  if (targets.includes("instagram")) {
    try {
      if (!settings.instagram_user_id) throw new InstagramNotLinkedError();
      const result = await publishToInstagram({
        igUserId: settings.instagram_user_id,
        pageToken,
        imageUrl: post.image_url,
        caption,
      });
      patch.instagram_post_id = result.id;
      patch.instagram_permalink = result.permalink;
      published = true;
    } catch (err) {
      failures.push(`Instagram: ${explain(err, "instagram")}`);
    }
  }

  return updatePostRecord(postId, {
    ...patch,
    status: published ? "posted" : "failed",
    ...(published ? { posted_at: new Date().toISOString() } : {}),
    error_message: failures.length > 0 ? failures.join(" · ") : null,
  });
}

/**
 * Meta reports a token missing a permission as a bare "(#200) Permissions
 * error", which names neither the permission nor where to add it.
 */
function explain(err: unknown, target: "facebook" | "instagram"): string {
  const message = err instanceof Error ? err.message : "Unknown error while posting.";
  if (!/\(#200\)|permissions? error/i.test(message)) return message;

  const needed =
    target === "facebook"
      ? "pages_manage_posts"
      : "instagram_basic and instagram_content_publish";

  return (
    `rejected for missing permissions. The connected token needs ${needed}. ` +
    "Add it to your Meta app — and to the Login for Business configuration if you " +
    "use one — then disconnect and connect again so a new token is issued."
  );
}
