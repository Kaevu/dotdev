export const prerender = false;

import type { APIRoute } from "astro";
import { getEnv, tokenOk, jsonError } from "../../../lib/bookmarks/util";
import {
  KINDS,
  MAX_TAGS_PER_BOOKMARK,
  tagMenuForPrompt,
  sanitizeTags,
  isKind,
  type Kind,
} from "../../../lib/bookmarks/taxonomy";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 1_000_000;
const LLM_TIMEOUT_MS = 60_000;
const MAX_TEXT_FOR_LLM = 6_000;

type Extracted = {
  title: string;
  siteName: string;
  description: string;
  text: string;
  wordCount: number;
};

/* ------------------------------ html helpers ------------------------------ */

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code: string) => {
    if (code[0] === "#") {
      const num =
        code[1] === "x" || code[1] === "X"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(num) && num > 0 && num < 0x110000
        ? String.fromCodePoint(num)
        : m;
    }
    const named: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    };
    return named[code] ?? m;
  });
}

function metaAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

function firstMeta(html: string, keys: string[]): string {
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const a = metaAttrs(m[0]);
    const key = (a.property ?? a.name ?? "").toLowerCase();
    if (keys.includes(key) && a.content) return decodeEntities(a.content.trim());
  }
  return "";
}

function htmlTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1].replace(/\s+/g, " ").trim()) : "";
}

function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(
    /<(script|style|noscript|template|svg|iframe|head|nav|footer|form)[\s\S]*?<\/\1>/gi,
    " "
  );
  s = s.replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t\f\v]+/g, " ");
  s = s.replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();
  return s;
}

function extract(html: string, url: URL): Extracted {
  const title =
    firstMeta(html, ["og:title", "twitter:title"]) ||
    htmlTitle(html) ||
    url.hostname;
  const siteName =
    firstMeta(html, ["og:site_name", "application-name"]) ||
    url.hostname.replace(/^www\./, "");
  const description = firstMeta(html, [
    "og:description",
    "twitter:description",
    "description",
  ]);
  const text = htmlToText(html);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return { title, siteName, description, text, wordCount };
}

/* ------------------------------ heuristics -------------------------------- */

const KEYWORD_TAGS: Array<[RegExp, string]> = [
  [/database|sql|postgres|query optim|relational model|b-?tree/i, "cs/databases"],
  [/compiler|parser|llvm|interpreter|register allocation|type check/i, "cs/compilers"],
  [/distributed|consensus|raft|paxos|replication|cap theorem/i, "cs/distributed"],
  [/operating system|kernel|scheduler|virtual memory|page table/i, "cs/os"],
  [/tcp|congestion|routing|networking/i, "cs/networking"],
  [/gpu|cuda|simd|vectoriz|parallel comput/i, "cs/parallel"],
  [/security|cryptograph|vulnerab|exploit|\bcve\b/i, "cs/security"],
  [/neural|transformer|attention|llm|gpt|language model|deep learning|machine learning/i, "ml/llms"],
  [/reinforcement|reward model|policy gradient/i, "ml/rl"],
  [/convolution|image classif|computer vision|diffusion model/i, "ml/vision"],
  [/category theory|monad|functor|topos/i, "math/logic"],
  [/probabilit|bayesian|\bstatistics\b/i, "math/probability"],
  [/linear algebra|eigen|matrix/i, "math/linear-algebra"],
  [/proof assistant|\blean\b|\bcoq\b|formal verif|type theory/i, "cs/theory"],
  [/complexity|np-?hard|turing|computab/i, "cs/theory"],
  [/quant|portfolio|hedge fund|option pric/i, "finance/quant"],
  [/market|trading|econom/i, "finance/markets"],
];

function guessKind(url: URL, html: string): Kind {
  const u = url.href.toLowerCase();
  const h = url.hostname.replace(/^www\./, "");
  if (/youtube\.com|youtu\.be|vimeo\.com|twitch\.tv/.test(h)) return "video";
  const ogType = firstMeta(html, ["og:type"]).toLowerCase();
  if (ogType === "video") return "video";
  if (/\.pdf($|[?#])/.test(u) || /arxiv\.org/.test(h)) return "paper";
  if (/github\.com|gitlab\.com/.test(h)) return "site";
  if (ogType === "article") return "article";
  if (ogType === "profile" || ogType === "website") return "site";
  return "article";
}

function guessTags(text: string): string[] | null {
  const hits: string[] = [];
  for (const [re, tag] of KEYWORD_TAGS) {
    if (re.test(text) && !hits.includes(tag)) hits.push(tag);
    if (hits.length >= 3) break;
  }
  return sanitizeTags(hits);
}

function extractiveSummary(ex: Extracted): string {
  if (ex.description) return ex.description;
  const sentences = ex.text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 40)
    .slice(0, 3)
    .join(" ");
  return sentences || ex.text.slice(0, 280) || ex.title;
}

/* ------------------------------ llm call ---------------------------------- */

const DEFAULT_MODEL = "openrouter/free";

/**
 * Models the deployed key is allowed to use (OpenRouter guardrails).
 * The auto-router goes first -- it fails over across the free pool
 * server-side, so single-model delistings can't break us. Pinned
 * models follow in observed-reliability order.
 */
const MODEL_CHAIN: Array<{ id: string; structured: boolean }> = [
  { id: "openrouter/free", structured: false },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", structured: false },
  { id: "liquid/lfm-2.5-2.6b:free", structured: true },
  { id: "mistralai/mistral-nemo", structured: true },
];

/** Model IDs that must not receive response_format (unsupported or varies). */
const NO_STRUCTURED = new Set(["openrouter/free"]);

/** Strict JSON schema for the summary payload (structured outputs). */
const SUMMARY_SCHEMA = {
  name: "bookmark_summary",
  strict: true,
  schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      kind: { type: "string", enum: [...KINDS] },
      tags: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: MAX_TAGS_PER_BOOKMARK,
      },
    },
    required: ["title", "summary", "kind", "tags"],
    additionalProperties: false,
  },
};

type LlmResult = {
  title: string;
  summary: string;
  kind: Kind;
  tags: string[];
};

type Attempt = { model: string; ok: boolean; error?: string; tries?: number };

const MAX_RETRIES_PER_MODEL = 1;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60000;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

/** Overridable for local testing against a stub server. */
function openRouterBase(env: Record<string, unknown>): string {
  const base = env.OPENROUTER_BASE_URL as string | undefined;
  return (base ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * How long to wait before retrying a rate/capacity error. Prefers the
 * server's hint: Retry-After (honored up to 120s), then X-RateLimit-Reset,
 * then capped exponential backoff (free-tier 429s often carry no Retry-After).
 */
function retryDelayMs(res: Response, retryIndex: number): number {
  const HINT_CAP_MS = 120_000;
  const ra = res.headers.get("retry-after");
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, HINT_CAP_MS);
    const date = Date.parse(ra);
    if (Number.isFinite(date)) {
      const d = date - Date.now();
      if (d > 0) return Math.min(d, HINT_CAP_MS);
    }
  }
  const reset = res.headers.get("x-ratelimit-reset");
  if (reset) {
    let t = Number(reset);
    if (Number.isFinite(t) && t > 0) {
      if (t < 1e12) t *= 1000; // seconds -> ms
      const d = t - Date.now();
      if (d > 0) return Math.min(d, HINT_CAP_MS);
    }
  }
  const exp = Math.min(RETRY_BASE_MS * 2 ** retryIndex, RETRY_MAX_MS);
  return exp + Math.floor(Math.random() * 1000);
}

/** Backup parser for models that ignore response_format. */
function extractJson(s: string): Record<string, unknown> | null {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : s;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function attemptModel(
  apiKey: string,
  baseUrl: string,
  model: string,
  url: URL,
  ex: Extracted,
  opts: { structured: boolean } = { structured: true }
): Promise<{
  parsed: Record<string, unknown> | null;
  servedModel?: string;
  error?: string;
  tries: number;
}> {
  const system = [
    "You summarize web pages for a personal bookmarks list. Reply with ONLY a JSON object, no markdown fences, with keys:",
    '"title": best human-readable title of the page,',
    '"summary": 2-3 sentence factual summary of what the page contains,',
    '"kind": one of ' + KINDS.map((k) => JSON.stringify(k)).join(" | ") + ",",
    '"tags": array of 1-3 hierarchical tag paths.',
    "Tag grammar: the first segment MUST be one of cs, ml, math, finance, other.",
    "Optional second and third segments are lowercase kebab-case subtopics, e.g. cs/theory/compilers or ml/llms.",
    "Prefer the curated menu:",
    tagMenuForPrompt(),
    "The first tag must be the bare top level (e.g. \"cs\"). At most " + 3 + " tags total.",
  ].join("\n");

  const user = [
    `URL: ${url.href}`,
    `SITE: ${ex.siteName}`,
    `PAGE TITLE: ${ex.title}`,
    `PAGE DESCRIPTION: ${ex.description || "(none)"}`,
    `CONTENT:`,
    ex.text.slice(0, MAX_TEXT_FOR_LLM),
  ].join("\n");

  const started = Date.now();
  const elapsed = () => `${Date.now() - started}ms`;
  const maxTries = 1 + MAX_RETRIES_PER_MODEL;

  for (let i = 0; i < maxTries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "http-referer": "https://kaevu.dev",
          "x-title": "kaevu.dev bookmarks",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 600,
          ...(opts.structured
            ? { response_format: { type: "json_schema", json_schema: SUMMARY_SCHEMA } }
            : {}),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (RETRYABLE_STATUS.has(res.status)) {
        let snippet = "";
        try {
          snippet = (await res.text()).slice(0, 200);
        } catch {
          /* ignore */
        }
        console.warn(
          `[summarize] ${model} -> HTTP ${res.status} (try ${i + 1}/${maxTries}, ${elapsed()}) ${snippet}`
        );
        if (i < maxTries - 1) {
          const wait = retryDelayMs(res, i);
          console.warn(`[summarize] ${model} -> retrying in ${wait}ms`);
          await sleep(wait);
          continue;
        }
        return { parsed: null, error: `http_${res.status}`, tries: i + 1 };
      }
      if (!res.ok) {
        let snippet = "";
        try {
          snippet = (await res.text()).slice(0, 200);
        } catch {
          /* ignore */
        }
        console.warn(`[summarize] ${model} -> HTTP ${res.status} (${elapsed()}) ${snippet}`);
        return { parsed: null, error: `http_${res.status}`, tries: i + 1 };
      }
      const data: any = await res.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;
      if (!content) {
        console.warn(`[summarize] ${model} -> empty content (${elapsed()})`);
        return { parsed: null, error: "empty_content", tries: i + 1 };
      }
      const parsed = extractJson(content);
      if (!parsed) {
        console.warn(
          `[summarize] ${model} -> unparseable JSON (${elapsed()}): ${content.slice(0, 200)}`
        );
        return { parsed: null, error: "bad_json", tries: i + 1 };
      }
      const servedModel =
        typeof data?.model === "string" ? (data.model as string) : undefined;
      console.warn(
        `[summarize] ${model} -> ok (${elapsed()})` +
          (servedModel && servedModel !== model ? ` served by ${servedModel}` : "")
      );
      return { parsed, servedModel, tries: i + 1 };
    } catch (e) {
      const reason =
        e instanceof Error && e.name === "AbortError" ? "timeout" : "network_error";
      console.warn(`[summarize] ${model} -> ${reason} (${elapsed()})`);
      return { parsed: null, error: reason, tries: i + 1 };
    } finally {
      clearTimeout(timer);
    }
  }
  return { parsed: null, error: "unknown", tries: maxTries };
}

/**
 * Coerce one model response, filling invalid fields from the heuristics
 * instead of discarding the whole LLM result. Only a missing summary
 * is fatal (it's the one thing only the LLM can provide).
 */
function coerceLlm(
  parsed: Record<string, unknown>,
  ex: Extracted,
  fallbackKind: Kind,
  fallbackTags: string[]
): LlmResult | null {
  const summary =
    typeof parsed.summary === "string"
      ? parsed.summary.trim().slice(0, 1200)
      : "";
  if (!summary) return null;
  const rawTitle =
    typeof parsed.title === "string" && parsed.title.trim()
      ? parsed.title.trim()
      : ex.title;
  return {
    title: rawTitle.slice(0, 300),
    summary,
    kind: isKind(parsed.kind) ? parsed.kind : fallbackKind,
    tags: sanitizeTags(parsed.tags) ?? fallbackTags,
  };
}

async function llmSummarizeChain(
  apiKey: string,
  baseUrl: string,
  primary: string,
  url: URL,
  ex: Extracted,
  fallbackKind: Kind,
  fallbackTags: string[]
): Promise<{
  result: LlmResult | null;
  attempts: Attempt[];
  model: string | null;
}> {
  const models = [
    { id: primary, structured: !NO_STRUCTURED.has(primary) },
    ...MODEL_CHAIN.filter((m) => m.id !== primary),
  ];
  const attempts: Attempt[] = [];
  for (const { id, structured } of models) {
    const { parsed, servedModel, error, tries } = await attemptModel(
      apiKey,
      baseUrl,
      id,
      url,
      ex,
      { structured }
    );
    if (!parsed) {
      attempts.push({ model: id, ok: false, error, tries });
      continue;
    }
    const result = coerceLlm(parsed, ex, fallbackKind, fallbackTags);
    if (!result) {
      console.warn(`[summarize] ${id} -> empty summary, trying next model`);
      attempts.push({ model: id, ok: false, error: "no_summary", tries });
      continue;
    }
    attempts.push({ model: id, ok: true, tries });
    return { result, attempts, model: servedModel ?? id };
  }
  return { result: null, attempts, model: null };
}

/* ------------------------------ route ------------------------------------- */

export const POST: APIRoute = async ({ locals, request }) => {
  const env = getEnv(locals);
  if (!tokenOk(request, env)) {
    return jsonError(401, "Unauthorized", "missing or bad x-bookmark-token header");
  }

  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Bad request", "expected JSON body { url }");
  }
  const rawUrl = (body.url ?? "").trim();
  let url: URL;
  try {
    url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    return jsonError(400, "Bad request", "url must be a valid http(s) URL");
  }

  // Fetch the page (timeout + size cap)
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let html = "";
  try {
    const res = await fetch(url.href, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; kaevu.dev-bookmark-bot; +https://kaevu.dev)",
        accept: "text/html,application/xhtml+xml,application/pdf;q=0.4,*/*;q=0.2",
      },
    });
    if (!res.ok) {
      return jsonError(
        422,
        "Fetch failed",
        `upstream responded ${res.status} ${res.statusText}`
      );
    }
    const reader = res.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (received > MAX_HTML_BYTES) {
          ctrl.abort();
          break;
        }
      }
    }
  } catch {
    return jsonError(422, "Fetch failed", "could not download the page (timeout or blocked)");
  } finally {
    clearTimeout(timer);
  }

  const ex = extract(html, url);
  const fallbackKind = guessKind(url, html);
  const fallbackTags = guessTags(ex.text + " " + ex.title) ?? ["other"];
  const fallbackSummary = extractiveSummary(ex);
  const fallback =
    ex.wordCount < 120
      ? null
      : {
          title: ex.title.slice(0, 300),
          summary: fallbackSummary.slice(0, 1200),
          kind: fallbackKind,
          tags: fallbackTags,
        };

  // Try the LLM whenever a key is configured -- even for short pages.
  // Only the extractive fallback stays gated on word count.
  const apiKey = env.OPENROUTER_API_KEY as string | undefined;
  const primary =
    (env.OPENROUTER_MODEL as string | undefined) || DEFAULT_MODEL;
  let llm: LlmResult | null = null;
  let llmModel: string | null = null;
  let attempts: Attempt[] = [];
  if (apiKey) {
    const chain = await llmSummarizeChain(
      apiKey,
      openRouterBase(env),
      primary,
      url,
      ex,
      fallbackKind,
      fallbackTags
    );
    llm = chain.result;
    llmModel = chain.model;
    attempts = chain.attempts;
  }

  const result = llm ?? fallback;
  if (!result) {
    return jsonError(
      422,
      "Nothing to summarize",
      "page had no extractable text (likely a PDF, paywall, or JS-only app)"
    );
  }

  const words = ex.wordCount;
  const readingMinutes = words >= 120 ? Math.max(1, Math.round(words / 200)) : null;
  const fallbackReason = llm
    ? null
    : !apiKey
      ? "no_api_key"
      : `llm_failed:${attempts.map((a) => a.error ?? "ok").join("+")}`;

  return new Response(
    JSON.stringify({
      url: url.href,
      title: result.title,
      source: ex.siteName,
      summary: result.summary,
      tags: result.tags,
      kind: result.kind,
      reading_minutes: result.kind === "video" ? null : readingMinutes,
      model: llmModel,
      fallback: !llm,
      fallback_reason: fallbackReason,
      word_count: words,
      debug: {
        hasKey: !!apiKey,
        primary,
        attempts,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
