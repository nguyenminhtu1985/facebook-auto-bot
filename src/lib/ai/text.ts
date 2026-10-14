import { usableProviders } from "@/lib/db/providers";

import { generateWith } from "@/lib/ai/providers";

import type { ContentProvider, GeneratedContent } from "@/lib/types";

/**
 * Facebook copy, written by whichever services the owner has set up on the
 * Providers screen, tried in the order they chose until one returns usable
 * JSON.
 *
 * If every one fails the caller still gets a postable draft from a
 * deterministic template, but the result says so via `provider`: silently
 * shipping template copy as if it were AI copy is worse than an honest
 * warning.
 */

const SYSTEM_PROMPT = `You are an expert Facebook Page copywriter. Given a topic, write a single
high-performing Facebook photo post in strict JSON with this exact shape and nothing else:
{"title": string, "description": string, "hashtags": string[]}
Business context (applies to every post):
- The Page sells "bánh gio" (also called bánh tro): a square, amber-translucent Vietnamese ash cake, eaten with "mật mía" (sugarcane molasses). It is NOT "bánh 
giầy", NOT "bánh chưng", NOT any other cake — never use those names.
- Price: 120k VND for 10 cakes including a box of mật mía. Delivery across Hanoi. Order via phone/Zalo 0359940126.
- Write in Vietnamese with correct diacritics. Always keep the product name exactly "bánh gio".
- Product facts (never contradict these): keep refrigerated, lasts 5-7 days; eaten cool/at room temperature with mật mía. If the cake goes hard, steam for 5 
minutes to soften — NEVER bake, fry or microwave. No preservatives.
Cuối mỗi bài viết, thêm 1 dòng riêng:
👉 Xem thêm & đặt hàng tại: https://tinyurl.com/banhgiovuong
Rules:
- title: the opening hook, <= 80 characters. Conversational, scroll-stopping, specific. At most one emoji. No hashtags. The title sets the ONE angle of this 
post.
- description: 2-4 short sentences, <= 400 characters, written to be read on a phone. CRITICAL: the description must expand on the exact angle in the title — 
same idea, more detail, never a generic product pitch. If the title is about amber translucency, the description talks about translucency (how to check it, why 
it matters), not about price or delivery. Plain language, no marketing cliches. End with a question or a soft call to action that invites comments, since 
engagement drives Facebook reach.
- Bad example: title "Màu hổ phách trong vắt — dấu hiệu bánh gio chuẩn" + description "Bánh gio nhà làm, ngon sạch, giá 120k/10 chiếc kèm hộp mật mía. Ship toàn
 Hà Nội." (description ignores the title's angle)
- Good example: title "Màu hổ phách trong vắt — dấu hiệu bánh gio chuẩn" + description "Gắp miếng bánh lên trước ánh sáng mà nhìn xuyên qua được là bánh chuẩn 
đấy ạ. Màu càng trong, bánh càng dẻo ngon. Nhà mình gói thủ công nên miếng nào cũng óng ánh thế này. Sếp đã thử soi bánh nhà mình chưa?"
- hashtags: 3 to 5 short, highly relevant hashtags, lowercase, no "#" symbol, no spaces. Facebook rewards a few precise tags, not a wall of them.
- Output ONLY the JSON object. No markdown fences, no commentary.`;

/** Dòng link landing — luôn chèn bằng code, không trông chờ AI tuân thủ. */
const LANDING_LINE = "👉 Xem thêm & đặt hàng tại: https://tinyurl.com/banhgiovuong";

/**
 * Đảm bảo description luôn có dòng link landing ở cuối.
 * Nếu AI (hoặc template) đã có thì giữ nguyên, chưa có thì chèn thêm.
 */
function withLandingLink(content: GeneratedContent): GeneratedContent {
  const desc = content.description ?? "";
  if (desc.includes("tinyurl.com/banhgiovuong")) return content;
  const sep = desc.endsWith("\n") ? "" : "\n";
  return { ...content, description: `${desc}${sep}${LANDING_LINE}` };
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object in response");
  return JSON.parse(text.slice(start, end + 1));
}

function parseContent(raw: string): GeneratedContent {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("Malformed generation payload");
  const o = parsed as Record<string, unknown>;
  if (
    typeof o.title !== "string" ||
    typeof o.description !== "string" ||
    !Array.isArray(o.hashtags) ||
    !o.hashtags.every((h) => typeof h === "string")
  ) {
    throw new Error("Malformed generation payload");
  }
  return {
    title: o.title.trim(),
    description: o.description.trim(),
    hashtags: (o.hashtags as string[]).map((h) => h.replace(/^#/, "").trim()).filter(Boolean),
  };
}

function template(topic: string): GeneratedContent {
  const clean = topic.trim();
  return {
    title: `${clean} — xem ngay`,
    description: `Bánh gio nhà làm, ngon sạch, giá 120k/10 chiếc kèm hộp mật mía. Ship toàn Hà Nội, đặt hàng qua 0359940126. Bạn đã thử chưa?`,
    hashtags: ["banhgio", "banhgiomatmia", "hanoi"],
  };
}

export async function generateContent(topic: string): Promise<GeneratedContent & { provider: ContentProvider; providerError?: string }> {
  const providers = await usableProviders("text");
  if (providers.length === 0) {
    return {
      ...withLandingLink(template(topic)),
      provider: "template",
      providerError:
        "No AI writer is set up. Add a key on the Providers screen — Groq and Gemini are free.",
    };
  }
  const failures: string[] = [];
  for (const provider of providers) {
    try {
      const raw = await generateWith(provider, SYSTEM_PROMPT, `Topic: ${topic}`);
      return { ...withLandingLink(parseContent(raw)), provider: provider.spec.id as ContentProvider };
    } catch (err) {
      failures.push(`${provider.spec.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.warn("[generateContent] every provider failed:", failures.join(" | "));
  return { ...withLandingLink(template(topic)), provider: "template", providerError: failures[0] };
}
