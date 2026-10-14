/**
 * Les fournisseurs d'IA et la traduction entre leur format et le nôtre.
 * L'historique de conversation est gardé dans le format natif du fournisseur (les blocs renvoyés
 * par l'API — réflexion, signatures… — doivent lui être renvoyés tels quels).
 */

export type ProviderId = "gemini" | "anthropic" | "openai" | "compatible";

export interface ProviderInfo {
  label: string;
  hint: string;
  keyUrl?: string;
  keyPlaceholder: string;
  /** Peut transcrire la voix avec la même clé. */
  voice: boolean;
  /** Ne garde que les modèles de conversation. */
  filter: (id: string) => boolean;
  pickDefault: (models: string[]) => string | undefined;
}

/** Tri « version la plus récente d'abord » (gemini-3.0 avant gemini-2.5). */
const newestFirst = (a: string, b: string) => b.localeCompare(a, "en", { numeric: true });
const stable = (id: string) => !/(preview|exp|latest)/.test(id);

/** Gamme de prix d'un modèle : 0 = le moins cher. Les modèles inconnus passent après. */
function costRank(provider: ProviderId, id: string) {
  const m = id.toLowerCase();
  switch (provider) {
    case "anthropic":
      return m.includes("haiku") ? 0 : m.includes("sonnet") ? 1 : m.includes("opus") ? 2 : 3;
    case "openai":
      if (m.includes("nano")) return 0;
      if (m.includes("mini")) return 1;
      if (/^o\d/.test(m)) return m.includes("pro") ? 5 : 3;
      return m.includes("pro") ? 4 : 2;
    case "gemini":
      return m.includes("flash-lite") ? 0 : m.includes("flash") ? 1 : m.includes("pro") ? 2 : 3;
    default:
      return 0;
  }
}

/** Du moins cher au plus cher ; dans une même gamme, versions stables et récentes d'abord. */
export function sortByCost(provider: ProviderId, models: string[]) {
  return [...models].sort(
    (a, b) =>
      costRank(provider, a) - costRank(provider, b) ||
      Number(stable(b)) - Number(stable(a)) ||
      newestFirst(a, b),
  );
}

/**
 * Modèles Gemini qui ont le plus de chances d'avoir un quota gratuit, du meilleur au moins bon :
 * les « gemini-X.Y-flash » classiques d'abord, puis « flash-lite », puis les alias « latest ».
 * Les variantes spéciales (omni, live, image, preview…) n'ont souvent pas d'offre gratuite.
 */
export function geminiFreeCandidates(models: string[]) {
  const special = /(omni|live|image|tts|audio|thinking|exp|preview|robotics|embedding)/;
  const plain = models.filter((m) => /^gemini-\d+(\.\d+)?-flash$/.test(m)).sort(newestFirst);
  const lite = models.filter((m) => /^gemini-\d+(\.\d+)?-flash-lite$/.test(m)).sort(newestFirst);
  const latest = models.filter((m) => /^gemini-flash(-lite)?-latest$/.test(m));
  const others = models.filter((m) => m.includes("flash") && !special.test(m)).sort(newestFirst);
  return [...new Set([...plain, ...lite, ...latest, ...others])];
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gemini: {
    label: "Gemini",
    hint: "Gratuit : crée une clé sur Google AI Studio, sans carte bancaire.",
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza…",
    voice: true,
    filter: (id) => id.startsWith("gemini") && !/(embedding|tts|image|live|aqa|audio|robotics)/.test(id),
    // Gratuit : le moins cher parmi les modèles qui ont un quota gratuit (flash-lite, puis flash).
    pickDefault: (models) => sortByCost("gemini", geminiFreeCandidates(models))[0] ?? models[0],
  },
  anthropic: {
    label: "Claude",
    hint: "Clé API Anthropic (facturée à l'usage).",
    keyUrl: "https://platform.claude.com/settings/keys",
    keyPlaceholder: "sk-ant-…",
    voice: false,
    filter: (id) => id.startsWith("claude"),
    // Toujours le moins cher par défaut (Haiku) : on peut monter en gamme ensuite.
    pickDefault: (models) => sortByCost("anthropic", models)[0],
  },
  openai: {
    label: "OpenAI",
    hint: "Clé API OpenAI (facturée à l'usage).",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    voice: true,
    filter: (id) =>
      /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|transcribe|tts|image|search|embedding|instruct)/.test(id),
    pickDefault: (models) => sortByCost("openai", models.filter((m) => m.startsWith("gpt")))[0] ?? sortByCost("openai", models)[0],
  },
  compatible: {
    label: "Compatible OpenAI",
    hint: "OpenRouter, Groq, Mistral, Ollama ou LM Studio en local…",
    keyPlaceholder: "Clé (vide pour un serveur local)",
    voice: false,
    filter: () => true,
    pickDefault: (models) => models[0],
  },
};

export interface ToolDef {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Gemini : identifiant d'origine s'il y en avait un. */
  rawId?: string;
}

export interface Turn {
  text: string;
  calls: ToolCall[];
  /** Message assistant à ajouter tel quel à l'historique. */
  native: unknown;
  refused: boolean;
}

export interface ToolResult {
  call: ToolCall;
  result: string;
  error?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export function userMessage(p: ProviderId, text: string): unknown {
  return p === "gemini" ? { role: "user", parts: [{ text }] } : { role: "user", content: text };
}

export function buildBody(p: ProviderId, system: string, history: unknown[], tools: ToolDef[]): object {
  if (p === "anthropic") {
    return {
      max_tokens: 16000,
      system,
      messages: history,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      cache_control: { type: "ephemeral" },
    };
  }
  if (p === "gemini") {
    return {
      systemInstruction: { parts: [{ text: system }] },
      contents: history,
      tools: [
        {
          functionDeclarations: tools.map((t) =>
            // Gemini refuse un objet sans propriétés : on omet alors les paramètres.
            Object.keys(t.parameters.properties).length
              ? { name: t.name, description: t.description, parameters: t.parameters }
              : { name: t.name, description: t.description },
          ),
        },
      ],
    };
  }
  return {
    messages: [{ role: "system", content: system }, ...history],
    tools: tools.map((t) => ({ type: "function", function: t })),
  };
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw || "{}"));
  } catch {
    return {};
  }
}

export function parseResponse(p: ProviderId, res: any): Turn {
  if (p === "anthropic") {
    const content: any[] = res.content ?? [];
    return {
      text: content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim(),
      calls: content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, args: parseArgs(b.input) })),
      native: { role: "assistant", content },
      refused: res.stop_reason === "refusal",
    };
  }
  if (p === "gemini") {
    const cand = res.candidates?.[0];
    const content = cand?.content ?? { role: "model", parts: [] };
    const parts: any[] = content.parts ?? [];
    return {
      text: parts
        .filter((x) => typeof x.text === "string" && !x.thought)
        .map((x) => x.text)
        .join("")
        .trim(),
      calls: parts
        .filter((x) => x.functionCall)
        .map((x, i) => ({
          id: x.functionCall.id ?? `${x.functionCall.name}-${i}`,
          rawId: x.functionCall.id,
          name: x.functionCall.name,
          args: parseArgs(x.functionCall.args),
        })),
      native: { ...content, role: "model", parts },
      refused: !cand || cand.finishReason === "SAFETY" || !!res.promptFeedback?.blockReason,
    };
  }
  const msg = res.choices?.[0]?.message ?? {};
  const toolCalls: any[] = msg.tool_calls ?? [];
  return {
    text: (msg.content ?? "").trim(),
    calls: toolCalls.map((tc) => ({ id: tc.id, name: tc.function?.name, args: parseArgs(tc.function?.arguments) })),
    // Uniquement les champs standard : certains serveurs compatibles refusent le reste.
    native: { role: "assistant", content: msg.content ?? null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
    refused: res.choices?.[0]?.finish_reason === "content_filter",
  };
}

export function toolResultMessages(p: ProviderId, results: ToolResult[]): unknown[] {
  if (p === "anthropic") {
    // Tous les résultats dans un seul message.
    return [
      {
        role: "user",
        content: results.map((r) => ({
          type: "tool_result",
          tool_use_id: r.call.id,
          content: r.result,
          ...(r.error ? { is_error: true } : {}),
        })),
      },
    ];
  }
  if (p === "gemini") {
    return [
      {
        role: "user",
        parts: results.map((r) => ({
          functionResponse: {
            name: r.call.name,
            ...(r.call.rawId ? { id: r.call.rawId } : {}),
            response: r.error ? { error: r.result } : { result: r.result },
          },
        })),
      },
    ];
  }
  return results.map((r) => ({ role: "tool", tool_call_id: r.call.id, content: r.result }));
}
