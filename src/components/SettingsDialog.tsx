import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { Plus, Trash2, CheckCircle2, AlertCircle } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useStore } from "../lib/store";
import type { LlmProvider, ProviderKind, Settings } from "../lib/types";
import { Button, Dialog, Field, Input, Select, Switch } from "./ui";

export const PROVIDER_KINDS: {
  id: ProviderKind;
  label: string;
  hint: string;
  models: string[];
  needsKey: boolean;
  cli?: "claude" | "codex";
}[] = [
  {
    id: "anthropic",
    label: "Anthropic API",
    hint: "Claude via an API key from console.anthropic.com",
    models: ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"],
    needsKey: true,
  },
  {
    id: "claude_cli",
    label: "Claude Code (subscription)",
    hint: "Uses the `claude` CLI you are already logged into. Tools are exposed to it over MCP.",
    models: ["", "opus", "sonnet"],
    needsKey: false,
    cli: "claude",
  },
  {
    id: "openai",
    label: "OpenAI API",
    hint: "GPT models via an API key from platform.openai.com",
    models: ["gpt-5", "gpt-5-mini", "gpt-4.1", "o3"],
    needsKey: true,
  },
  {
    id: "codex_cli",
    label: "Codex CLI (ChatGPT subscription)",
    hint: "Uses the `codex` CLI you are logged into with ChatGPT. Tools are exposed to it over MCP.",
    models: ["", "gpt-5-codex", "gpt-5"],
    needsKey: false,
    cli: "codex",
  },
  {
    id: "openai_compatible",
    label: "OpenAI-compatible endpoint",
    hint: "Ollama, OpenRouter, Groq, Mistral, DeepSeek, xAI, LM Studio… anything speaking /chat/completions",
    models: ["llama3.1", "qwen2.5-coder", "deepseek-chat", "mistral-large-latest"],
    needsKey: false,
  },
];

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const settings = useStore((s) => s.settings);
  const save = useStore((s) => s.saveSettings);
  const toast = useStore((s) => s.toast);
  const [draft, setDraft] = useState<Settings>(settings);
  const [tab, setTab] = useState<"general" | "ai" | "about">("general");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [hasKey, setHasKey] = useState<Record<string, boolean>>({});
  const [clis, setClis] = useState<{ claude: string | null; codex: string | null } | null>(null);
  const [info, setInfo] = useState<{
    version: string;
    data_dir: string;
    mcp_port: number | null;
    secret_storage: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setKeys({});
    void api
      .detectClis()
      .then(setClis)
      .catch(() => {});
    void api
      .appInfo()
      .then(setInfo)
      .catch(() => {});
    void Promise.all(
      settings.providers.map(async (p) => [p.id, await api.hasProviderKey(p.id).catch(() => false)] as const),
    ).then((r) => setHasKey(Object.fromEntries(r)));
  }, [open, settings]);

  const update = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));
  const updateProvider = (id: string, patch: Partial<LlmProvider>) =>
    update({ providers: draft.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const addProvider = (kind: ProviderKind) => {
    const k = PROVIDER_KINDS.find((x) => x.id === kind)!;
    const p: LlmProvider = {
      id: crypto.randomUUID(),
      name: k.label,
      kind,
      model: kind === "claude_cli" || kind === "codex_cli" ? "" : k.models[0],
      base_url: kind === "openai_compatible" ? "http://localhost:11434/v1" : null,
      command: null,
      extra_headers: {},
    };
    update({ providers: [...draft.providers, p], default_provider: draft.default_provider ?? p.id });
  };

  const commit = async () => {
    try {
      await save(draft);
      for (const [id, key] of Object.entries(keys)) {
        if (key) await api.setProviderKey(id, key);
      }
      toast("Settings saved", "success");
      onOpenChange(false);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={commit}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex gap-5 min-h-[380px]">
        <nav className="flex w-36 shrink-0 flex-col gap-0.5" aria-label="Settings sections">
          {(["general", "ai", "about"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-current={tab === t}
              className={clsx(
                "rounded-md px-2.5 py-1.5 text-left text-[13px]",
                tab === t ? "bg-active" : "hover:bg-hover text-muted",
              )}
            >
              {t === "general" ? "General" : t === "ai" ? "AI providers" : "About"}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {tab === "general" && (
            <>
              <Field label="Theme">
                <Select
                  value={draft.theme ?? "system"}
                  onChange={(e) => update({ theme: e.target.value as Settings["theme"] })}
                  className="w-48"
                >
                  <option value="system">Follow system</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </Select>
              </Field>
              <Field
                label="Default row limit for queries"
                hint="Results are truncated past this many rows; use LIMIT for more control."
              >
                <Input
                  type="number"
                  className="w-48"
                  value={draft.row_limit}
                  onChange={(e) => update({ row_limit: Math.max(1, Number(e.target.value) || 1000) })}
                />
              </Field>
              <Field label="Editor font size">
                <Input
                  type="number"
                  className="w-48"
                  value={draft.editor_font_size ?? 13}
                  onChange={(e) =>
                    update({ editor_font_size: Math.min(24, Math.max(10, Number(e.target.value) || 13)) })
                  }
                />
              </Field>
            </>
          )}
          {tab === "ai" && (
            <>
              <Switch
                checked={draft.agent_allow_writes}
                onChange={(v) => update({ agent_allow_writes: v })}
                label="Allow the agent to run write statements"
                description="Each write still requires your approval in the chat. Read-only connections always refuse."
              />
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted">Providers</span>
                <span className="flex-1" />
                <Select
                  value=""
                  onChange={(e) => e.target.value && addProvider(e.target.value as ProviderKind)}
                  aria-label="Add provider"
                  className="h-7 text-xs"
                >
                  <option value="">+ Add provider…</option>
                  {PROVIDER_KINDS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              </div>
              {draft.providers.length === 0 && (
                <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted">
                  Add a provider to enable the assistant. You can use an API key, or your existing Claude Code / Codex
                  login.
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {PROVIDER_KINDS.map((k) => (
                      <Button key={k.id} size="sm" onClick={() => addProvider(k.id)}>
                        <Plus size={12} /> {k.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {draft.providers.map((p) => {
                const kind = PROVIDER_KINDS.find((k) => k.id === p.kind)!;
                const cliPath = kind.cli ? clis?.[kind.cli] : undefined;
                return (
                  <div key={p.id} className="rounded-lg border border-border p-3 flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Input
                        value={p.name}
                        onChange={(e) => updateProvider(p.id, { name: e.target.value })}
                        className="h-7 w-56 font-medium"
                        aria-label="Provider name"
                      />
                      <span className="text-xs text-muted">{kind.label}</span>
                      <span className="flex-1" />
                      <label className="flex items-center gap-1.5 text-xs text-muted">
                        <input
                          type="radio"
                          name="default-provider"
                          checked={draft.default_provider === p.id}
                          onChange={() => update({ default_provider: p.id })}
                        />{" "}
                        default
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove provider"
                        onClick={() =>
                          update({
                            providers: draft.providers.filter((x) => x.id !== p.id),
                            default_provider: draft.default_provider === p.id ? null : draft.default_provider,
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                    <p className="text-xs text-faint -mt-1">{kind.hint}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={kind.cli ? "Model (blank = CLI default)" : "Model"}>
                        <Input
                          list={`models-${p.id}`}
                          value={p.model}
                          onChange={(e) => updateProvider(p.id, { model: e.target.value })}
                          className="font-mono"
                        />
                        <datalist id={`models-${p.id}`}>
                          {kind.models.filter(Boolean).map((m) => (
                            <option key={m} value={m} />
                          ))}
                        </datalist>
                      </Field>
                      {(p.kind === "openai_compatible" || p.kind === "anthropic" || p.kind === "openai") && (
                        <Field
                          label="Base URL"
                          hint={
                            p.kind === "openai_compatible"
                              ? "e.g. http://localhost:11434/v1 or https://openrouter.ai/api/v1"
                              : "leave blank for the official endpoint"
                          }
                        >
                          <Input
                            value={p.base_url ?? ""}
                            onChange={(e) => updateProvider(p.id, { base_url: e.target.value || null })}
                            className="font-mono"
                          />
                        </Field>
                      )}
                      {(kind.needsKey || p.kind === "openai_compatible") && (
                        <Field
                          label={hasKey[p.id] ? "API key (saved — enter to replace)" : "API key"}
                          hint={p.kind === "openai_compatible" ? "optional for local servers" : undefined}
                        >
                          <Input
                            type="password"
                            value={keys[p.id] ?? ""}
                            onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}
                            placeholder={hasKey[p.id] ? "••••••••" : "sk-…"}
                            autoComplete="off"
                          />
                        </Field>
                      )}
                      {kind.cli && (
                        <Field label="CLI path override" hint="blank = find on PATH">
                          <Input
                            value={p.command ?? ""}
                            onChange={(e) => updateProvider(p.id, { command: e.target.value || null })}
                            placeholder={cliPath ?? `${kind.cli} not found on PATH`}
                            className="font-mono"
                          />
                        </Field>
                      )}
                    </div>
                    {kind.cli && clis && (
                      <div
                        className={clsx("flex items-center gap-1.5 text-xs", cliPath ? "text-success" : "text-warning")}
                      >
                        {cliPath ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                        {cliPath
                          ? `Found ${kind.cli} at ${cliPath}`
                          : `${kind.cli} CLI not found. Install it and log in, or set the path above.`}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
          {tab === "about" && info && (
            <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-xs selectable">
              <dt className="text-muted">Version</dt>
              <dd>{info.version}</dd>
              <dt className="text-muted">Data directory</dt>
              <dd className="font-mono break-all">{info.data_dir}</dd>
              <dt className="text-muted">Secret storage</dt>
              <dd>{info.secret_storage === "keychain" ? "OS keychain" : "Local file (no keychain found)"}</dd>
              <dt className="text-muted">MCP endpoint</dt>
              <dd className="font-mono">
                {info.mcp_port ? `http://127.0.0.1:${info.mcp_port}/mcp/<session>` : "not running"}
              </dd>
            </dl>
          )}
        </div>
      </div>
    </Dialog>
  );
}
