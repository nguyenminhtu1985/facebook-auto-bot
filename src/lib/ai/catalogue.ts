/**
 * Every outside service this app can use to write a post or find an image.
 *
 * The catalogue is code and the credentials are data: this file says what
 * exists, what it costs and where to get a key, while the database holds the
 * key, the chosen model and the order. That split is what lets the Providers
 * screen show the whole picture — including services with no key yet — instead
 * of a list of environment variables nobody can see.
 */

export type ProviderId =
  | "groq"
  | "gemini"
  | "anthropic"
  | "openai"
  | "pollinations"
  | "pollinations-image"
  | "pexels";

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  /** What it is used for. */
  kind: "text" | "image";
  cost: "free" | "free-tier" | "paid";
  /** Works with no key at all. */
  keyless?: boolean;
  /** Where to get a key, for the link on the Providers screen. */
  keyUrl?: string;
  /** Used when the owner has not chosen one. */
  defaultModel?: string;
  /** Lower runs first. */
  defaultPriority: number;
  blurb: string;
  /** Environment variable honoured for installs configured before this screen. */
  envVar?: string;
}

export const PROVIDERS: ProviderSpec[] = [
  {
    id: "groq",
    label: "Groq",
    kind: "text",
    cost: "free-tier",
    keyUrl: "https://console.groq.com/keys",
    defaultModel: "openai/gpt-oss-120b",
    defaultPriority: 10,
    blurb: "Fast and free to a generous limit. The best first choice for writing posts.",
    envVar: "GROQ_API_KEY",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "text",
    cost: "free-tier",
    keyUrl: "https://aistudio.google.com/apikey",
    defaultModel: "gemini-2.0-flash",
    defaultPriority: 20,
    blurb: "Free tier from Google AI Studio. A good second opinion when Groq is busy.",
    envVar: "GEMINI_API_KEY",
  },
  {
    id: "anthropic",
    label: "Claude",
    kind: "text",
    cost: "paid",
    keyUrl: "https://console.anthropic.com/settings/keys",
    defaultModel: "claude-opus-5-5",
    defaultPriority: 30,
    blurb: "Paid, and the strongest writer of the four. Worth it if copy quality matters most.",
  },
  {
    id: "openai",
    label: "ChatGPT (OpenAI)",
    kind: "text",
    cost: "paid",
    keyUrl: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-4o-mini",
    defaultPriority: 40,
    blurb: "Paid. Use the Test button to see which models your key can reach.",
  },
  {
    id: "pollinations",
    label: "Pollinations",
    kind: "text",
    cost: "free",
    keyless: true,
    defaultPriority: 90,
    blurb:
      "No key, no signup — but it now turns away anonymous callers, so treat it as a last resort rather than a plan.",
  },
  {
    id: "pollinations-image",
    label: "Pollinations images",
    kind: "image",
    cost: "free",
    keyless: true,
    defaultPriority: 10,
    blurb: "Generates the picture for each post. Free, no key, and currently working well.",
  },
  {
    id: "pexels",
    label: "Pexels",
    kind: "image",
    cost: "free-tier",
    keyUrl: "https://www.pexels.com/api/",
    defaultPriority: 20,
    blurb: "Free stock photos instead of generated ones. Only needed for the stock image source.",
    envVar: "PEXELS_API_KEY",
  },
];

export const byId = (id: string): ProviderSpec | undefined =>
  PROVIDERS.find((p) => p.id === id);

export const textProviders = () => PROVIDERS.filter((p) => p.kind === "text");
