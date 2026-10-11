import { supabaseAdmin } from "@/lib/supabase/server";
import { byId, PROVIDERS, type ProviderId, type ProviderSpec } from "@/lib/ai/catalogue";
import { env } from "@/lib/env";

/**
 * Stored credentials for the services in the catalogue.
 *
 * Installs made before this screen existed have no table, and some configured
 * their keys as environment variables. Both keep working: a missing table
 * reads as "nothing configured", and an environment variable is used when the
 * database has no key for that provider.
 */

export class ProvidersTableMissingError extends Error {
  constructor() {
    super(
      "Your database has no ai_providers table yet. Run supabase/schema.sql again in the Supabase SQL editor — it is safe to re-run and only adds what is missing."
    );
  }
}

const MISSING_TABLE = new Set(["PGRST205", "42P01"]);

function raise(error: { code?: string; message: string } | null, action: string): void {
  if (!error) return;
  if (error.code && MISSING_TABLE.has(error.code)) throw new ProvidersTableMissingError();
  throw new Error(`Failed to ${action}: ${error.message}`);
}

export interface StoredProvider {
  id: ProviderId;
  api_key: string | null;
  model: string | null;
  enabled: boolean;
  priority: number;
  last_tested_at: string | null;
  last_status: "ok" | "failed" | null;
  last_error: string | null;
}

/** A catalogue entry joined with whatever the owner has configured for it. */
export interface ResolvedProvider {
  spec: ProviderSpec;
  apiKey: string | null;
  /** True when the key came from an environment variable rather than Settings. */
  keyFromEnv: boolean;
  model: string | null;
  enabled: boolean;
  priority: number;
  lastTestedAt: string | null;
  lastStatus: "ok" | "failed" | null;
  lastError: string | null;
}

function envKeyFor(spec: ProviderSpec): string {
  switch (spec.envVar) {
    case "GROQ_API_KEY":
      return env.groqApiKey;
    case "GEMINI_API_KEY":
      return env.geminiApiKey;
    case "PEXELS_API_KEY":
      return env.pexelsApiKey;
    default:
      return "";
  }
}

async function readRows(): Promise<StoredProvider[]> {
  try {
    const { data, error } = await supabaseAdmin().from("ai_providers").select("*");
    raise(error, "read providers");
    return (data ?? []) as StoredProvider[];
  } catch (err) {
    if (err instanceof ProvidersTableMissingError) return [];
    throw err;
  }
}

/** Every catalogue entry, with its stored configuration merged in. */
export async function resolveProviders(): Promise<ResolvedProvider[]> {
  const rows = new Map((await readRows()).map((r) => [r.id, r]));

  return PROVIDERS.map((spec) => {
    const row = rows.get(spec.id);
    const envKey = envKeyFor(spec);
    const storedKey = row?.api_key?.trim() || "";

    return {
      spec,
      apiKey: storedKey || envKey || null,
      keyFromEnv: !storedKey && Boolean(envKey),
      model: row?.model?.trim() || spec.defaultModel || null,
      enabled: row?.enabled ?? true,
      priority: row?.priority ?? spec.defaultPriority,
      lastTestedAt: row?.last_tested_at ?? null,
      lastStatus: row?.last_status ?? null,
      lastError: row?.last_error ?? null,
    };
  }).sort((a, b) => a.priority - b.priority);
}

/** Only those that can actually run: enabled, and keyed unless keyless. */
export async function usableProviders(kind: "text" | "image"): Promise<ResolvedProvider[]> {
  const all = await resolveProviders();
  return all.filter(
    (p) => p.spec.kind === kind && p.enabled && (p.spec.keyless || Boolean(p.apiKey))
  );
}

export async function findProvider(id: string): Promise<ResolvedProvider | null> {
  if (!byId(id)) return null;
  return (await resolveProviders()).find((p) => p.spec.id === id) ?? null;
}

export async function saveProvider(
  id: ProviderId,
  patch: { api_key?: string | null; model?: string | null; enabled?: boolean; priority?: number }
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("ai_providers")
    .upsert({ id, ...patch, updated_at: new Date().toISOString() }, { onConflict: "id" });
  raise(error, "save provider");
}

export async function recordTest(
  id: ProviderId,
  status: "ok" | "failed",
  error: string | null
): Promise<void> {
  const { error: dbError } = await supabaseAdmin().from("ai_providers").upsert(
    {
      id,
      last_tested_at: new Date().toISOString(),
      last_status: status,
      last_error: error,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  raise(dbError, "record a provider test");
}
