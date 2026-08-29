import type { BookmarkItem } from "./types";

type D1Row = Omit<BookmarkItem, "tags"> & { tags: string };

const SELECT_COLS =
  "id, url, title, source, summary, tags, kind, reading_minutes, saved_at";

function parseRow(r: D1Row): BookmarkItem {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(r.tags);
    if (Array.isArray(parsed)) {
      tags = parsed.filter((t: unknown): t is string => typeof t === "string");
    }
  } catch {
    /* ignore malformed tag json */
  }
  return { ...r, tags };
}

export async function fetchBookmarks(locals: unknown): Promise<BookmarkItem[]> {
  try {
    const env = ((locals as any)?.runtime?.env ?? process.env) as any;
    if (!env?.DB) return [];
    const { results } = await env.DB.prepare(
      `SELECT ${SELECT_COLS} FROM bookmarks ORDER BY saved_at DESC, id DESC`
    ).all();
    return ((results ?? []) as D1Row[]).map(parseRow);
  } catch (e) {
    console.error("bookmarks: d1 query failed", e);
    return [];
  }
}
