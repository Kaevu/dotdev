interface BookmarkApiItem {
  id: number;
  url: string;
  title: string;
  source: string;
  summary: string;
  tags: string[];
  kind: string;
  reading_minutes: number | null;
  saved_at: string;
}

const RECENT_LIMIT = 10;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return c;
    }
  });
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/`/g, "&#96;");
}

/** Most descriptive tag = deepest path; tie-break on longest string. */
function mostDescriptiveTag(tags: string[]): string | null {
  if (!tags.length) return null;
  let best = tags[0];
  for (const t of tags.slice(1)) {
    const dBest = best.split("/").length;
    const dT = t.split("/").length;
    if (dT > dBest || (dT === dBest && t.length > best.length)) best = t;
  }
  return best;
}

function pillClass(tag: string): string {
  const top = tag.split("/")[0];
  const known = ["cs", "ml", "math", "finance", "other"];
  return `pill pill-${known.includes(top) ? top : "untagged"}`;
}

function pillLabel(tag: string): string {
  const segs = tag.split("/");
  return segs[segs.length - 1];
}

async function loadBookmarks() {
  const container = document.getElementById("recent-bookmarks");
  if (!container) return;

  try {
    const response = await fetch("/api/bookmarks");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as { items?: BookmarkApiItem[] };
    const items = (data.items ?? []).slice(0, RECENT_LIMIT);

    if (items.length === 0) {
      container.innerHTML = `<div class="text-sm text-neutral-500">No bookmarks saved yet.</div>`;
      return;
    }

    const rows = items
      .map((it) => {
        const tag = mostDescriptiveTag(it.tags ?? []);
        const date = escapeHtml((it.saved_at ?? "").slice(0, 10));
        const title = escapeHtml(it.title || it.url);
        const url = escapeAttr(it.url);
        const pill = tag
          ? `<span class="${pillClass(tag)} flex-shrink-0" title="${escapeAttr(tag)}">${escapeHtml(pillLabel(tag))}</span>`
          : "";
        return `
        <a
          href="${url}"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-baseline gap-2 group cursor-pointer hover:bg-neutral-800/50 -mx-3 px-3 py-2 rounded-lg transition-all duration-200 border border-transparent hover:border-neutral-700/50"
        >
          <span class="flex-1 min-w-0 truncate text-neutral-200 group-hover:text-neutral-100 transition-colors font-sans text-sm">
            ${title}
          </span>
          ${pill}
          <span class="text-xs text-neutral-500 whitespace-nowrap flex-shrink-0">${date}</span>
        </a>`;
      })
      .join("");

    container.innerHTML = `<div class="space-y-1">${rows}</div>`;
  } catch (error) {
    console.error("Error loading bookmarks:", error);
    container.innerHTML = `
      <div class="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">
        Failed to load bookmarks
      </div>
    `;
  }
}

loadBookmarks();
