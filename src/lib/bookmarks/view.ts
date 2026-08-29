import { TOP_TAGS } from "./taxonomy";
import type { BookmarkItem } from "./types";

export type TagCount = { tag: string; count: number };

export function subtreeFilter(
  items: BookmarkItem[],
  category: string
): BookmarkItem[] {
  return items.filter((it) =>
    it.tags.some((t) => t === category || t.startsWith(category + "/"))
  );
}

export function topCounts(items: BookmarkItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of TOP_TAGS) counts[t] = 0;
  for (const it of items) {
    const seen = new Set<string>();
    for (const tag of it.tags) seen.add(tag.split("/")[0]);
    for (const top of seen) {
      if (top in counts) counts[top]++;
    }
  }
  return counts;
}

export function childCounts(items: BookmarkItem[], category: string): TagCount[] {
  const depth = category.split("/").length;
  const children = new Set<string>();
  for (const it of items) {
    for (const tag of it.tags) {
      if (!tag.startsWith(category + "/")) continue;
      const segs = tag.split("/");
      if (segs.length <= depth) continue;
      children.add(segs.slice(0, depth + 1).join("/"));
    }
  }
  return [...children]
    .map((tag) => ({ tag, count: subtreeFilter(items, tag).length }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
