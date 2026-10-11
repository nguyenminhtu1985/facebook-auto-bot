import type { ResolvedProvider } from "@/lib/db/providers";

/**
 * One function per service, in the same shape, so the chain in text.ts does not
 * care which one it is talking to.
 *
 * Every call is a plain fetch on purpose. This file is provider-neutral by
 * design — pulling in a vendor SDK for one branch would make the others the
 * odd ones out, and add a dependency to a project whose point is that it runs
 * on free services with nothing installed.
 */

const TIMEOUT_MS = 20_000;

export class ProviderError extends Error {}

async function asJson(res: Response, label: string) {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ProviderError(`${label} returned a non-JSON response (${res.status})`);
  }

  const err = (body as { error?: { message?: string } | string })?.error;
  if (!res.ok || err) {
    const message = typeof err === "string" ? err : err?.message;
    throw new ProviderError(message ?? `${label} responded ${res.status}`);
  }
  return body as Record<string, unknown>;
}

/** OpenAI-compatible chat completions: Groq, OpenAI, and Pollinations. */
async function chatCompletion(
  url: string,
  label: string,
  model: string,
  apiKey: string | null,
  system: string,
  user: string
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0.9,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const body = await asJson(res, label);
  const content = (body as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]
    ?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new ProviderError(`${label} returned an empty completion`);
  }
  return content;
}

async function gemini(
  model: string,
  apiKey: string,
  system: string,
  user: string
): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0.9, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  );

  const body = await asJson(res, "Gemini");
  const content = (
    body as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] }
  ).candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof content !== "string" || !content.trim()) {
    throw new ProviderError("Gemini returned an empty completion");
  }
  return content;
}

async function anthropic(
  model: string,
  apiKey: string,
  system: string,
  user: string
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      // A caption is a few hundred characters; the headroom is for the
      // thinking that current Claude models do by default.
      max_tokens: 2048,
      // Thinking cannot be switched off on current models, so the cost is
      // kept down with the lowest effort instead — ample for one caption.
      output_config: { effort: "low" },
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const body = await asJson(res, "Claude");
  const blocks = (body as { content?: { type?: string; text?: string }[] }).content ?? [];
  const content = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  if (!content) throw new ProviderError("Claude returned an empty completion");
  return content;
}

/** Asks one provider to write a post. Returns the raw model output. */
export async function generateWith(
  provider: ResolvedProvider,
  system: string,
  user: string
): Promise<string> {
  const model = provider.model ?? provider.spec.defaultModel ?? "";
  const key = provider.apiKey;

  switch (provider.spec.id) {
    case "groq":
      return chatCompletion(
        "https://api.groq.com/openai/v1/chat/completions",
        "Groq",
        model,
        key,
        system,
        user
      );
    case "openai":
      return chatCompletion(
        "https://api.openai.com/v1/chat/completions",
        "OpenAI",
        model,
        key,
        system,
        user
      );
    case "pollinations":
      return chatCompletion(
        "https://text.pollinations.ai/openai",
        "Pollinations",
        model || "openai-fast",
        null,
        system,
        user
      );
    case "gemini":
      return gemini(model, key!, system, user);
    case "anthropic":
      return anthropic(model, key!, system, user);
    default:
      throw new ProviderError(`${provider.spec.label} cannot write posts.`);
  }
}

export interface TestResult {
  ok: boolean;
  detail: string;
  /** A few model names the key can reach, when the service will say. */
  models?: string[];
}

/**
 * Checks a key without spending a generation where possible: most of these
 * services list their models, which proves the key works and shows the owner
 * what to type in the model box.
 */
export async function testProvider(provider: ResolvedProvider): Promise<TestResult> {
  const { spec, apiKey, model } = provider;

  try {
    if (!spec.keyless && !apiKey) return { ok: false, detail: "No key saved yet." };

    switch (spec.id) {
      case "groq":
      case "openai": {
        const url =
          spec.id === "groq"
            ? "https://api.groq.com/openai/v1/models"
            : "https://api.openai.com/v1/models";
        const body = await asJson(
          await fetch(url, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          }),
          spec.label
        );
        const ids = ((body.data ?? []) as { id: string }[]).map((m) => m.id);
        const has = model ? ids.includes(model) : false;
        return {
          ok: true,
          detail: model
            ? has
              ? `Key works. "${model}" is available.`
              : `Key works, but "${model}" is not in this key's model list — pick one below.`
            : "Key works.",
          models: ids.filter((id) => /gpt|llama|qwen|gemma|kimi|mixtral|o\d/i.test(id)).slice(0, 12),
        };
      }

      case "gemini": {
        const body = await asJson(
          await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
            { signal: AbortSignal.timeout(TIMEOUT_MS) }
          ),
          "Gemini"
        );
        const ids = ((body.models ?? []) as { name: string }[]).map((m) =>
          m.name.replace(/^models\//, "")
        );
        return {
          ok: true,
          detail: "Key works.",
          models: ids.filter((id) => id.startsWith("gemini")).slice(0, 12),
        };
      }

      case "anthropic": {
        const body = await asJson(
          await fetch("https://api.anthropic.com/v1/models", {
            headers: { "x-api-key": apiKey!, "anthropic-version": "2023-06-01" },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          }),
          "Claude"
        );
        const ids = ((body.data ?? []) as { id: string }[]).map((m) => m.id);
        return { ok: true, detail: "Key works.", models: ids.slice(0, 12) };
      }

      case "pexels": {
        await asJson(
          await fetch("https://api.pexels.com/v1/search?query=test&per_page=1", {
            headers: { Authorization: apiKey! },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          }),
          "Pexels"
        );
        return { ok: true, detail: "Key works." };
      }

      case "pollinations": {
        // No key to check, so this is the only one worth a real generation.
        const text = await chatCompletion(
          "https://text.pollinations.ai/openai",
          "Pollinations",
          model || "openai-fast",
          null,
          "Reply with the single word OK.",
          "Say OK",
          );
        return { ok: true, detail: `Responded: ${text.trim().slice(0, 40)}` };
      }

      case "pollinations-image": {
        const res = await fetch(
          "https://image.pollinations.ai/prompt/a%20single%20red%20apple?width=256&height=256&nologo=true",
          { signal: AbortSignal.timeout(TIMEOUT_MS) }
        );
        if (!res.ok) throw new ProviderError(`Image service responded ${res.status}`);
        const type = res.headers.get("content-type") ?? "";
        if (!type.startsWith("image/")) throw new ProviderError(`Returned ${type || "no image"}`);
        return { ok: true, detail: "Generated a test image." };
      }
    }

    return { ok: false, detail: "Nothing to test." };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "Test failed." };
  }
}
