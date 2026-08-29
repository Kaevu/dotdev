export const TOP_TAGS = ["cs", "ml", "math", "finance", "other"] as const;
export type TopTag = (typeof TOP_TAGS)[number];

export const KINDS = ["article", "paper", "book", "site", "video"] as const;
export type Kind = (typeof KINDS)[number];

export const MAX_TAG_DEPTH = 3;
export const MAX_TAGS_PER_BOOKMARK = 3;

// Curated menu the summarizer should prefer. Leaf segments are freeform;
// mid segments may also be coined as long as they are kebab-case.
export const MID_LEVELS: Record<TopTag, string[]> = {
  cs: [
    "algorithms",
    "architecture",
    "compilers",
    "courses",
    "databases",
    "distributed",
    "graphics",
    "hardware",
    "languages",
    "networking",
    "os",
    "parallel",
    "security",
    "systems",
    "theory",
    "tools",
  ],
  ml: ["foundations", "llms", "rl", "vision"],
  math: ["analysis", "discrete", "linear-algebra", "logic", "probability"],
  finance: ["markets", "quant"],
  other: ["career", "papers", "tools"],
};

const SEG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-/]/g, "")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export type TagCheck =
  | { ok: true; tag: string; top: TopTag }
  | { ok: false; reason: string };

export function checkTag(raw: string): TagCheck {
  const tag = normalizeTag(raw);
  if (!tag) return { ok: false, reason: "empty tag" };
  const segs = tag.split("/");
  if (segs.length > MAX_TAG_DEPTH) {
    return { ok: false, reason: `${tag}: max ${MAX_TAG_DEPTH} levels` };
  }
  for (const s of segs) {
    if (!SEG_RE.test(s)) return { ok: false, reason: `${tag}: bad segment "${s}"` };
  }
  const top = segs[0] as TopTag;
  if (!TOP_TAGS.includes(top)) {
    return {
      ok: false,
      reason: `${tag}: first segment must be one of ${TOP_TAGS.join(", ")}`,
    };
  }
  return { ok: true, tag, top };
}

/**
 * Validate + dedupe a tag list coming from the LLM or the add form.
 * Returns the clean list (bare top tag first) or null if nothing valid.
 */
export function sanitizeTags(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const check = checkTag(item);
    if (check.ok && !out.includes(check.tag)) out.push(check.tag);
    if (out.length >= MAX_TAGS_PER_BOOKMARK) break;
  }
  if (!out.length) return null;
  // guarantee a bare top-level tag is present
  const tops = out.map((t) => t.split("/")[0]);
  const bareTop = out.find((t) => !t.includes("/"));
  if (!bareTop) out.unshift(tops[0]);
  return out;
}

export function topOf(tag: string): string {
  return tag.split("/")[0];
}

export function lastSeg(tag: string): string {
  return tag.split("/")[tag.split("/").length - 1];
}

export function isKind(v: unknown): v is Kind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

/** Render the curated taxonomy as menu text for the summarizer prompt. */
export function tagMenuForPrompt(): string {
  return TOP_TAGS.map(
    (top) => `- ${top}/... (${MID_LEVELS[top].join(", ")})`
  ).join("\n");
}
