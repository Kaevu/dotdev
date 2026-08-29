export const prerender = false;

import type { APIRoute } from "astro";
import { getEnv, tokenOk, jsonError } from "../../lib/bookmarks/util";
import {
  sanitizeTags,
  isKind,
  MAX_TAGS_PER_BOOKMARK,
} from "../../lib/bookmarks/taxonomy";

type BookmarkRow = {
  id: number;
  url: string;
  title: string;
  source: string;
  summary: string;
  tags: string;
  kind: string;
  reading_minutes: number | null;
  saved_at: string;
};

const SELECT_COLS =
  "id, url, title, source, summary, tags, kind, reading_minutes, saved_at";

function getDb(locals: unknown): any | null {
  const env = getEnv(locals);
  return (env.DB as any) ?? null;
}

function parseRows(rows: BookmarkRow[]) {
  return rows.map((r) => {
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(r.tags);
      if (Array.isArray(parsed)) tags = parsed.filter((t) => typeof t === "string");
    } catch {
      /* ignore malformed */
    }
    return { ...r, tags };
  });
}

export const GET: APIRoute = async ({ locals }) => {
  const db = getDb(locals);
  if (!db) {
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const { results } = await db
      .prepare(
        `SELECT ${SELECT_COLS} FROM bookmarks ORDER BY saved_at DESC, id DESC`
      )
      .all();
    return new Response(JSON.stringify({ items: parseRows(results ?? []) }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("bookmarks GET error", e);
    return jsonError(500, "Database error");
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const env = getEnv(locals);
  if (!tokenOk(request, env)) {
    return jsonError(401, "Unauthorized", "missing or bad x-bookmark-token header");
  }
  const db = getDb(locals);
  if (!db) {
    return jsonError(500, "Not configured", "D1 binding DB is missing");
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Bad request", "expected JSON body");
  }

  // url
  let url: URL;
  try {
    url = new URL(String(body.url ?? "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    return jsonError(400, "Bad request", "url must be a valid http(s) URL");
  }

  // title / summary
  const title = String(body.title ?? "").trim().slice(0, 300);
  const summary = String(body.summary ?? "").trim().slice(0, 2000);
  if (!title) return jsonError(400, "Bad request", "title is required");

  // tags
  const tags = sanitizeTags(body.tags);
  if (!tags) {
    return jsonError(
      400,
      "Bad request",
      `tags must include at least one path rooted in cs|ml|math|finance|other (max ${MAX_TAGS_PER_BOOKMARK})`
    );
  }

  // kind
  const kind = isKind(body.kind) ? body.kind : "article";

  // reading_minutes
  let readingMinutes: number | null = null;
  const rm = Number(body.reading_minutes);
  if (Number.isFinite(rm) && rm > 0) readingMinutes = Math.min(Math.round(rm), 60000);

  const source =
    String(body.source ?? "").trim().slice(0, 120) ||
    url.hostname.replace(/^www\./, "");
  const savedAt = new Date().toISOString();

  try {
    await db
      .prepare(
        `INSERT OR REPLACE INTO bookmarks
           (url, title, source, summary, tags, kind, reading_minutes, saved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        url.href,
        title,
        source,
        summary,
        JSON.stringify(tags),
        kind,
        readingMinutes,
        savedAt
      )
      .run();

    const row = await db
      .prepare(`SELECT ${SELECT_COLS} FROM bookmarks WHERE url = ?`)
      .bind(url.href)
      .first();
    return new Response(JSON.stringify({ item: parseRows(row ? [row as BookmarkRow] : [])[0] ?? null }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("bookmarks POST error", e);
    return jsonError(500, "Database error");
  }
};
