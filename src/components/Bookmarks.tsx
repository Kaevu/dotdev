import React, { useEffect, useMemo, useState } from "react";
import Fuse from "fuse.js";
import { TOP_TAGS, lastSeg, topOf } from "../lib/bookmarks/taxonomy";
import { childCounts, topCounts } from "../lib/bookmarks/view";
import type { BookmarkItem } from "../lib/bookmarks/types";

type Props = { items: BookmarkItem[]; category?: string };

const mono = { fontFamily: "var(--font-mono)" } as const;

function fmtMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default function Bookmarks({ items, category }: Props) {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDq(q), 150);
    return () => clearTimeout(t);
  }, [q]);

  const fuse = useMemo(
    () =>
      new Fuse(items, {
        keys: [
          { name: "title", weight: 0.45 },
          { name: "source", weight: 0.15 },
          { name: "summary", weight: 0.2 },
          { name: "tags", weight: 0.15 },
          { name: "url", weight: 0.05 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
        minMatchCharLength: 2,
      }),
    [items]
  );

  const searching = dq.trim().length > 0;

  const visible = useMemo(() => {
    const t = dq.trim();
    if (!t) return items;
    return fuse.search(t).map((r) => r.item);
  }, [fuse, dq, items]);

  const counts = useMemo(() => topCounts(items), [items]);

  const kidCounts = useMemo(() => {
    const m: Record<string, ReturnType<typeof childCounts>> = {};
    for (const t of TOP_TAGS) m[t] = childCounts(items, t);
    return m;
  }, [items]);

  const subcats = useMemo(
    () => (category ? childCounts(items, category) : []),
    [items, category]
  );

  function toggle(top: string) {
    setExpanded((xs) =>
      xs.includes(top) ? xs.filter((x) => x !== top) : [...xs, top]
    );
  }

  const countLine = searching ? (
    <span>
      {visible.length} result{visible.length === 1 ? "" : "s"} for &ldquo;
      {dq.trim()}&rdquo;
    </span>
  ) : (
    <span>
      {items.length} bookmark{items.length === 1 ? "" : "s"}
      {category ? ` tagged ${category}` : ""}
    </span>
  );

  return (
    <div className="space-y-8">
      <div className="flex justify-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={category ? `search ${category} bookmarks…` : "search bookmarks…"}
          className="w-full max-w-xl text-sm fg-secondary focus:fg-primary bg-transparent outline-none"
          style={{ ...mono, borderBottom: "1px solid var(--border)", padding: "0.35rem 0" }}
          aria-label="search bookmarks"
        />
      </div>

      {searching ? (
        <div className="text-xs fg-tertiary" style={mono}>
          {countLine}
        </div>
      ) : category ? (
        subcats.length > 0 && (
          <div className="max-w-xl mx-auto">
            <div className="text-xs fg-tertiary pb-1" style={mono}>
              subcategories
            </div>
            {subcats.map((s) => (
              <div key={s.tag} className="flex items-baseline gap-2 py-0.5">
                <a
                  href={`/bookmarks/${s.tag}`}
                  className="font-serif text-base fg-secondary hover:fg-primary transition-colors"
                >
                  {s.tag.split("/").slice(1).join("/")}
                </a>
                <span className="text-xs fg-tertiary" style={mono}>
                  ({s.count})
                </span>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="max-w-xl mx-auto" style={mono}>
          {TOP_TAGS.map((top) => {
            const kids = kidCounts[top] ?? [];
            const isOpen = expanded.includes(top);
            return (
              <div key={top}>
                <div className="flex items-center gap-2 py-1">
                  <a
                    href={`/bookmarks/${top}`}
                    className="font-serif text-base fg-secondary hover:fg-primary transition-colors"
                  >
                    {top}
                  </a>
                  <span className="text-xs fg-tertiary">({counts[top] ?? 0})</span>
                  {kids.length > 0 && (
                    <button
                      onClick={() => toggle(top)}
                      className="text-xs fg-tertiary hover:fg-primary"
                      style={mono}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? "[–]" : "[+]"}
                    </button>
                  )}
                </div>
                {isOpen && (
                  <div className="pl-6 pb-1">
                    {kids.map((k) => (
                      <div key={k.tag} className="flex items-baseline gap-2 py-0.5">
                        <a
                          href={`/bookmarks/${k.tag}`}
                          className="font-serif text-sm fg-secondary hover:fg-primary transition-colors"
                        >
                          {k.tag.split("/").slice(1).join("/")}
                        </a>
                        <span className="text-xs fg-tertiary">({k.count})</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {items.length === 0 && !searching ? (
        <div className="text-sm fg-tertiary py-8" style={mono}>
          {category
            ? `nothing tagged ${category} yet`
            : "no bookmarks yet"}
        </div>
      ) : (
        <div>
          {!searching && (
            <div className="text-xs fg-tertiary pb-1" style={mono}>
              {countLine}
            </div>
          )}
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {visible.map((it) => (
              <BookmarkRow key={it.id + it.url} it={it} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BookmarkRow({ it }: { it: BookmarkItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="group py-3">
      <div className="grid" style={{ gridTemplateColumns: "1fr auto" }}>
        <div className="min-w-0">
          <div
            className="flex items-baseline gap-2 text-xs fg-tertiary flex-wrap"
            style={mono}
          >
            <span>{it.kind}</span>
            <span>·</span>
            <span>{it.source}</span>
            {it.kind !== "video" && it.reading_minutes != null && (
              <>
                <span>·</span>
                <span>{fmtMinutes(it.reading_minutes)}</span>
              </>
            )}
          </div>
          <a
            href={it.url}
            target="_blank"
            rel="noreferrer noopener"
            className="block font-serif text-sm md:text-base fg-secondary group-hover:fg-primary transition-colors mt-0.5"
            title={it.title}
          >
            {it.title}
          </a>
          {it.summary && (
            <p
              onClick={() => setOpen((o) => !o)}
              className="mt-1 text-xs md:text-sm fg-tertiary cursor-pointer"
              title={open ? "collapse" : "expand"}
              style={
                open
                  ? undefined
                  : {
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }
              }
            >
              {it.summary}
            </p>
          )}
          {it.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {it.tags.map((t) => (
                <a
                  key={t}
                  href={`/bookmarks/${t}`}
                  title={t}
                  className={`pill pill-${topOf(t)}`}
                  style={{ opacity: 0.85 }}
                >
                  {lastSeg(t)}
                </a>
              ))}
            </div>
          )}
        </div>
        <div
          className="pl-4 text-xs fg-tertiary whitespace-nowrap"
          style={mono}
        >
          {it.saved_at.slice(0, 10)}
        </div>
      </div>
    </div>
  );
}
