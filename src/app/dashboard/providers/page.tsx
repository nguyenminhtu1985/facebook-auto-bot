"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PencilSimpleLine,
  Plugs,
  CheckCircle,
  WarningCircle,
  ArrowUp,
  ArrowDown,
  ArrowSquareOut,
  Flask,
} from "@phosphor-icons/react/dist/ssr";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

interface Provider {
  id: string;
  label: string;
  kind: "text" | "image";
  cost: "free" | "free-tier" | "paid";
  keyless: boolean;
  keyUrl: string | null;
  blurb: string;
  defaultModel: string | null;
  hasKey: boolean;
  keyFromEnv: boolean;
  model: string | null;
  enabled: boolean;
  priority: number;
  lastTestedAt: string | null;
  lastStatus: "ok" | "failed" | null;
  lastError: string | null;
}

const COST_LABEL: Record<Provider["cost"], string> = {
  free: "Free, no key",
  "free-tier": "Free tier, key needed",
  paid: "Paid",
};

const COST_STYLE: Record<Provider["cost"], string> = {
  free: "bg-success/10 text-success",
  "free-tier": "bg-primary/10 text-primary",
  paid: "bg-surface-2 text-muted-foreground",
};

export default function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  const [modelDraft, setModelDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [results, setResults] = useState<
    Record<string, { ok: boolean; detail: string; models?: string[] }>
  >({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/providers");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load the provider list.");
      setProviders(data.providers ?? []);
      setUpgradeMessage(data.ready === false ? data.message : null);
      setModelDraft(
        Object.fromEntries((data.providers ?? []).map((p: Provider) => [p.id, p.model ?? ""]))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the provider list.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function update(id: string, patch: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/providers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't save that.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setBusyId(null);
    }
  }

  async function test(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/providers/${id}/test`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test failed.");
      setResults((r) => ({ ...r, [id]: data }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function move(id: string, direction: -1 | 1) {
    const sameKind = providers.filter((p) => p.kind === providers.find((x) => x.id === id)!.kind);
    const index = sameKind.findIndex((p) => p.id === id);
    const swapWith = sameKind[index + direction];
    if (!swapWith) return;
    // Swapping the two priorities is enough — the list is only ever sorted by
    // this number, so no renumbering of the rest is needed.
    await update(id, { priority: swapWith.priority });
    await update(swapWith.id, { priority: sameKind[index].priority });
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (upgradeMessage) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="border-warning/40 bg-warning/5">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
              <WarningCircle size={22} weight="bold" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-foreground">
                One database step to manage providers here
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your database was created before this screen existed. Open Supabase, go to{" "}
                <strong>SQL Editor → New query</strong>, paste the whole of{" "}
                <code className="rounded bg-surface-2 px-1 text-xs">supabase/schema.sql</code> again
                and click <strong>Run</strong>. It is safe to re-run.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Until then, keys set as environment variables keep working exactly as before.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const groups: { kind: "text" | "image"; title: string; note: string }[] = [
    {
      kind: "text",
      title: "Writing the post",
      note: "Tried from the top down until one answers. If all of them fail, the app falls back to a plain template and says so.",
    },
    {
      kind: "image",
      title: "Finding the picture",
      note: "AI images are generated; stock photos are searched. Which one is used comes from the image source in Settings.",
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Plugs size={22} />
          </div>
          <div>
            <h2 className="font-heading font-bold text-foreground">The services this app uses</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Everything below is optional except having at least one writer. Add your own keys to
              use your own accounts — keys are stored in your database, used only on the server, and
              never sent back to this page.
            </p>
          </div>
        </div>
      </Card>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive"
        >
          <WarningCircle size={18} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {groups.map((group) => {
        const list = providers.filter((p) => p.kind === group.kind);
        return (
          <section key={group.kind}>
            <h3 className="font-heading font-bold text-foreground">{group.title}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">{group.note}</p>

            <div className="mt-3 space-y-3">
              {list.map((p, index) => {
                const result = results[p.id];
                const active = p.enabled && (p.keyless || p.hasKey);
                return (
                  <Card key={p.id} className={cn(!p.enabled && "opacity-70")}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-semibold text-foreground">{p.label}</h4>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              COST_STYLE[p.cost]
                            )}
                          >
                            {COST_LABEL[p.cost]}
                          </span>
                          {active ? (
                            <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                              {index === 0 ? "Active · tried first" : "Active"}
                            </span>
                          ) : (
                            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                              {p.enabled ? "Needs a key" : "Off"}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{p.blurb}</p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Move ${p.label} earlier`}
                          disabled={index === 0 || busyId !== null}
                          onClick={() => move(p.id, -1)}
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${p.label} later`}
                          disabled={index === list.length - 1 || busyId !== null}
                          onClick={() => move(p.id, 1)}
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ArrowDown size={15} />
                        </button>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={p.enabled}
                          aria-label={`${p.enabled ? "Turn off" : "Turn on"} ${p.label}`}
                          disabled={busyId === p.id}
                          onClick={() => update(p.id, { enabled: !p.enabled })}
                          className={cn(
                            "relative ml-1 h-6 w-10 shrink-0 cursor-pointer rounded-full transition",
                            p.enabled ? "bg-primary" : "bg-surface-2"
                          )}
                        >
                          <span
                            className={cn(
                              "absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-[left]",
                              p.enabled ? "left-5" : "left-1"
                            )}
                          />
                        </button>
                      </div>
                    </div>

                    {!p.keyless && (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground">
                            API key
                          </label>
                          <div className="mt-1 flex gap-2">
                            <input
                              type="password"
                              value={keyDraft[p.id] ?? ""}
                              onChange={(e) =>
                                setKeyDraft((d) => ({ ...d, [p.id]: e.target.value }))
                              }
                              placeholder={
                                p.hasKey
                                  ? p.keyFromEnv
                                    ? "set as an environment variable"
                                    : "•••• saved — type to replace"
                                  : "paste your key"
                              }
                              className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                            />
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busyId === p.id || !(keyDraft[p.id] ?? "").trim()}
                              onClick={() => {
                                update(p.id, { apiKey: keyDraft[p.id] });
                                setKeyDraft((d) => ({ ...d, [p.id]: "" }));
                              }}
                            >
                              Save
                            </Button>
                          </div>
                          {p.keyUrl && (
                            <a
                              href={p.keyUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                            >
                              Get a key <ArrowSquareOut size={11} />
                            </a>
                          )}
                          {p.hasKey && !p.keyFromEnv && (
                            <button
                              type="button"
                              onClick={() => update(p.id, { apiKey: "" })}
                              className="ml-3 mt-1 cursor-pointer text-xs text-muted-foreground hover:text-destructive"
                            >
                              Remove key
                            </button>
                          )}
                        </div>

                        {p.kind === "text" && (
                          <div>
                            <label className="text-xs font-semibold text-muted-foreground">
                              Model
                            </label>
                            <div className="mt-1 flex gap-2">
                              <input
                                value={modelDraft[p.id] ?? ""}
                                onChange={(e) =>
                                  setModelDraft((d) => ({ ...d, [p.id]: e.target.value }))
                                }
                                placeholder={p.defaultModel ?? ""}
                                className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 font-mono text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                              />
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busyId === p.id || (modelDraft[p.id] ?? "") === (p.model ?? "")}
                                onClick={() => update(p.id, { model: modelDraft[p.id] })}
                              >
                                Save
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId === p.id}
                        onClick={() => test(p.id)}
                      >
                        <Flask size={14} />
                        {busyId === p.id ? "Testing…" : "Test"}
                      </Button>

                      {(result || p.lastStatus) && (
                        <span
                          className={cn(
                            "flex items-center gap-1.5 text-xs",
                            (result?.ok ?? p.lastStatus === "ok")
                              ? "text-success"
                              : "text-destructive"
                          )}
                        >
                          {(result?.ok ?? p.lastStatus === "ok") ? (
                            <CheckCircle size={14} />
                          ) : (
                            <WarningCircle size={14} />
                          )}
                          {result?.detail ?? p.lastError ?? "Working"}
                        </span>
                      )}
                    </div>

                    {result?.models && result.models.length > 0 && (
                      <div className="mt-3 border-t border-border pt-3">
                        <p className="text-xs font-semibold text-muted-foreground">
                          Models your key can use — click one to select it
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {result.models.map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => {
                                setModelDraft((d) => ({ ...d, [p.id]: m }));
                                update(p.id, { model: m });
                              }}
                              className={cn(
                                "cursor-pointer rounded-full border px-2.5 py-1 font-mono text-[11px] transition",
                                m === p.model
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                              )}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}

      <Card className="bg-surface-2/50">
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <PencilSimpleLine size={16} className="mt-0.5 shrink-0" />
          Keys set as environment variables in Vercel still work and show as{" "}
          <em>set as an environment variable</em>. Saving a key here takes precedence over one, and
          needs no redeploy.
        </p>
      </Card>
    </div>
  );
}
