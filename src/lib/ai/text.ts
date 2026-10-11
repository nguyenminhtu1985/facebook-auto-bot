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

The three parts are joined into one caption, in that order, so they must read as
one post rather than three fragments.

Rules:
- title: the opening hook, <= 80 characters. Conversational, scroll-stopping, specific. At most one emoji. No hashtags.
- description: 2-4 short sentences, <= 400 characters, written to be read on a phone. Plain language, no marketing cliches. End with a question or a soft call to action that invites comments, since engagement drives Facebook reach.
- hashtags: 3 to 5 short, highly relevant hashtags, lowercase, no "#" symbol, no spaces. Facebook rewards a few precise tags, not a wall of them.
- Output ONLY the JSON object. No markdown fences, no commentary.`;

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
  const words = clean.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  return {
    title: `${clean} — worth a look today`,
    description: `We put together a few ideas around ${clean.toLowerCase()}. Simple things you can actually try this week. Which one would you start with?`,
    hashtags: [...new Set(words)].concat(["ideas"]).slice(0, 5),
  };
}

export async function generateContent(topic: string): Promise<GeneratedContent> {
  const providers = await usableProviders("text");

  if (providers.length === 0) {
    return {
      ...template(topic),
      provider: "template",
      providerError:
        "No AI writer is set up. Add a key on the Providers screen — Groq and Gemini are free.",
    };
  }

  const failures: string[] = [];
  for (const provider of providers) {
    try {
      const raw = await generateWith(provider, SYSTEM_PROMPT, `Topic: ${topic}`);
      return { ...parseContent(raw), provider: provider.spec.id as ContentProvider };
    } catch (err) {
      failures.push(`${provider.spec.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.warn("[generateContent] every provider failed:", failures.join(" | "));
  return { ...template(topic), provider: "template", providerError: failures[0] };
}
