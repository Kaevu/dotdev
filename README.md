# Kaevu.dev

Personal site built with [Astro](https://astro.build), React islands, Tailwind CSS v4, and Cloudflare (Pages + Functions + D1).

## Commands

| Command | Action |
| :------ | :----- |
| `npm install` | Installs dependencies |
| `npm run dev` | Starts local dev server at `localhost:4321` |
| `npm run build` | Builds production site to `./dist/` |
| `npm run preview` | Previews the build locally |

## Project structure

```text
├── public/            # favicon, robots, headers, img
├── src/
│   ├── pages/         # routes + /api/* (prerender=false → Cloudflare Functions)
│   ├── components/    # Astro + React islands (client:visible)
│   ├── layouts/       # BaseLayout with SEO/meta
│   ├── content/blog/  # blog collection (draft:true excluded from prod)
│   └── lib/           # bookmarks taxonomy/store, MLB helpers
├── schema.sql         # D1 bookmarks table
├── workers/bookmark-mail/ # inbound-email → bookmarks worker (separate deploy)
└── wrangler.jsonc     # Cloudflare project + D1 binding
```

## Environment

Copy `.dev.vars` for local dev (gitignored). Required keys:

- `BOOKMARKS_TOKEN` — guards `POST /api/bookmarks`
- `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` — `/api/bookmarks/summarize`
- `LICHESS_TOKEN` / `LICHESS_USERNAME` — `/api/lichess*` (empty fallback without)
- `BOOKMARKS_API_BASE`, `MAIL_FROM` — `workers/bookmark-mail` only

## Notes

- Blog drafts: set `draft: true` in frontmatter; lists, RSS, sitemap, and `[...slug]` all exclude drafts.
- Static output with Cloudflare adapter: prerendered pages + Functions for `prerender=false` routes (`/api/*`, `/bookmarks*`).
- Fonts (DM Mono/DM Serif/Manrope) and Chart.js are self-hosted and bundled — no Google/jsDelivr CDN.
- Heavy islands hydrate on `client:visible`; Fuse.js splits into its own chunk and loads on first search keystroke.
