import React, { useMemo, useState } from "react";

type ShareItem = {
  name: string;
  size: number;
  last_modified?: string;
  mode?: number | string;
};

type Props = {
  items: ShareItem[];
  tags: Record<string, string>;
};

type Category = "cs" | "ml" | "finance" | "math" | "other" | "untagged";

function cleanTitle(raw: string): string {
  let s = raw;
  s = s.replace(/[\._]/g, " ");
  s = s.replace(/^[ǂ]+\s*/u, "");
  s = s.replace(/\.(pdf|djvu|epub|mobi|azw3|zip|rar|7z)$/i, "");
  s = s.replace(/^\[[^\]]+\]\s*/, "");
  s = s.replace(/anna'?s?\s+archive[^-–—:]*[-–—:]?/gi, "");
  s = s.replace(/\b[0-9a-fA-F]{8,}\b/g, "");
  s = s.replace(/\s*--\s*[^-]+(?:\s*--\s*[^-]+)*\s*$/g, "");
  s = s.replace(/[\s\-]{2,}/g, " ").trim();
  s = s.replace(/\s*[:–—-]\s*/g, ": ");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  const mb = bytes / 1_000_000;
  if (mb >= 1) return `${Math.round(mb)}mb`;
  return `${Math.max(1, Math.round(bytes / 1_000))}kb`;
}

const validTags = new Set(["cs", "ml", "finance", "math", "other"]);

function lookupTag(title: string, tags: Record<string, string>): Category {
  const tag = tags[title.toLowerCase()];
  if (tag && validTags.has(tag)) return tag as Category;
  return "untagged";
}

const categoryLabel: Record<Category, string> = {
  cs: "cs",
  ml: "ml / ai",
  finance: "finance",
  math: "math",
  other: "other",
  untagged: "untagged",
};

const pillClass: Record<Category, string> = {
  cs: "pill pill-cs",
  ml: "pill pill-ml",
  finance: "pill pill-finance",
  math: "pill pill-math",
  other: "pill pill-other",
  untagged: "pill pill-untagged",
};

const SHARE_ID = "Xio8EZcNj5vpmpMgbtMK7F";

export default function Bookshelf({ items, tags }: Props) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | Category>("all");

  const books = useMemo(() => {
    return items
      .map((it) => {
        const title = cleanTitle(it.name);
        const cat = lookupTag(title, tags);
        const hrefBrowse =
          "https://ebooks.kaevu.dev/web/client/pubshares/" +
          SHARE_ID +
          "/browse?name=" +
          encodeURIComponent(it.name);

        return {
          raw: it,
          title,
          cat,
          sizeStr: formatSize(it.size),
          href: hrefBrowse,
        };
      })
      .sort((a, b) => {
        if (a.cat === "untagged" && b.cat !== "untagged") return -1;
        if (a.cat !== "untagged" && b.cat === "untagged") return 1;
        return a.title.localeCompare(b.title);
      });
  }, [items, tags]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return books.filter((b) => {
      if (filter !== "all" && b.cat !== filter) return false;
      if (!term) return true;
      return (
        b.title.toLowerCase().includes(term) ||
        b.raw.name.toLowerCase().includes(term)
      );
    });
  }, [books, q, filter]);

  const filters: { key: "all" | Category; label: string }[] = [
    { key: "all", label: "all" },
    { key: "cs", label: "cs" },
    { key: "ml", label: "ml / ai" },
    { key: "finance", label: "finance" },
    { key: "math", label: "math" },
    { key: "other", label: "other" },
    { key: "untagged", label: "untagged" },
  ];

  const untaggedCount = books.filter((b) => b.cat === "untagged").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 text-sm">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search titles"
          className="flex-1 bg-transparent outline-none border-b border-subtle px-0 py-1 fg-secondary focus:fg-primary text-sm"
          style={{ fontFamily: "var(--font-mono)" }}
        />
        <div className="flex items-center gap-2">
          {filters.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={
                  "text-xs px-3 py-1 rounded border transition-colors " +
                  (active
                    ? "fg-primary border-subtle"
                    : "fg-secondary border-subtle hover:fg-primary")
                }
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="text-xs fg-tertiary" style={{ fontFamily: "var(--font-mono)" }}>
        {visible.length} books
        {untaggedCount > 0 && (
          <span className="fg-tertiary"> &middot; {untaggedCount} untagged</span>
        )}
      </div>

      <div className="divide-y" style={{ borderColor: "var(--border)" }}>
        {visible.map((b) => (
          <a
            key={b.raw.name}
            href={b.href}
            target="_blank"
            rel="noreferrer noopener"
            className="group block py-3"
          >
            <div className="grid" style={{ gridTemplateColumns: "1fr auto" }}>
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-block rounded-full opacity-30 transition-opacity group-hover:opacity-100"
                  style={{ width: 5, height: 5, background: "currentColor" }}
                />
                <span
                  className="truncate fg-secondary group-hover:fg-primary transition-colors font-serif text-sm md:text-base"
                  title={b.title}
                >
                  {b.title}
                </span>
              </div>

              <div className="flex items-center gap-2 pl-4">
                <span className={pillClass[b.cat]}>{categoryLabel[b.cat]}</span>
                <span className="text-xs fg-tertiary" style={{ fontFamily: "var(--font-mono)" }}>
                  {b.sizeStr}
                </span>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
