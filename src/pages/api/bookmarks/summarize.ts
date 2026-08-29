export const prerender = false;

import type { APIRoute } from "astro";
import { getEnv, tokenOk, jsonError } from "../../../lib/bookmarks/util";
import {
  KINDS,
  tagMenuForPrompt,
  sanitizeTags,
  isKind,
  type Kind,
} from "../../../lib/bookmarks/taxonomy";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 1_000_000;
const LLM_TIMEOUT_MS = 30_000;
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

async function llmSummarize(
  apiKey: string,
  model: string,
  url: URL,
  ex: Extracted
): Promise<{ title: string; summary: string; kind: Kind; tags: string[] } | null> {
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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = extractJson(content);
    if (!parsed) return null;
    const kind = isKind(parsed.kind) ? parsed.kind : null;
    const tags = sanitizeTags(parsed.tags);
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    if (!kind || !tags || !summary) return null;
    return {
      title: title.slice(0, 300) || ex.title,
      summary: summary.slice(0, 1200),
      kind,
      tags,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

  // Try the LLM; fall back to extractive when unavailable
  const apiKey = env.OPENROUTER_API_KEY as string | undefined;
  const model =
    (env.OPENROUTER_MODEL as string | undefined) || "google/gemini-2.0-flash-001";
  const usedFallback = !apiKey || ex.wordCount < 120;
  const llm = usedFallback
    ? null
    : await llmSummarize(apiKey as string, model, url, ex);

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

  return new Response(
    JSON.stringify({
      url: url.href,
      title: result.title,
      source: ex.siteName,
      summary: result.summary,
      tags: result.tags,
      kind: result.kind,
      reading_minutes: result.kind === "video" ? null : readingMinutes,
      fallback: !llm,
      word_count: words,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
