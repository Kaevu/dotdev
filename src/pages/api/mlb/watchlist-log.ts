export const prerender = false;

import type { APIRoute } from "astro";
import { WATCHLIST, currentSeason } from "../../../lib/mlb/config";
import { fetchJson, playerGameLog } from "../../../lib/mlb/api-shared";

const TTL_MS = 60 * 60 * 1000;

type CacheEntry = { at: number; body: string };
const cache = new Map<string, CacheEntry>();
let refreshing = false;

function jsonRes(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
  });
}

async function collect(seasonNum: number) {
  return Promise.all(
    WATCHLIST.map(async (entry) => {
      const group = entry.kind === "pitcher" ? "pitching" : "hitting";
      const [levelGames, mlbGames] = await Promise.all([
        playerGameLog(entry.id, group, seasonNum, entry.sportId),
        playerGameLog(entry.id, group, seasonNum, 1),
      ]);
      const byDate = new Map<number, number[]>();
      for (const g of [...levelGames, ...mlbGames]) byDate.set(g[0], g);
      const games = [...byDate.values()].sort((a, b) => a[0] - b[0]);
      return {
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        note: entry.note,
        lastPlayed: games.length ? games[games.length - 1][0] : null,
        games,
      };
    })
  );
}

async function computeBody(): Promise<{ body: string; storeKeys: string[] }> {
  const bucket = Math.floor(Date.now() / TTL_MS);
  const season = currentSeason();

  let players = await collect(season);
  let usedSeason = season;
  if (players.every((p) => p.games.length === 0)) {
    usedSeason = season - 1;
    players = await collect(usedSeason);
  }

  const body = JSON.stringify({ season: usedSeason, fetchedAt: new Date().toISOString(), players });
  return { body, storeKeys: [`watchlist:${bucket}`] };
}

export const GET: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any)?.runtime;
  const cfCtx = runtime?.ctx;
  const waitUntil = cfCtx?.waitUntil?.bind(cfCtx) ?? null;
  const edge = typeof caches !== "undefined" ? (caches as any).default : null;

  const bucket = Math.floor(Date.now() / TTL_MS);
  const key = `watchlist:${bucket}`;

  function recompute(): void {
    if (refreshing) return;
    refreshing = true;
    const task = computeBody()
      .then(async ({ body, storeKeys }) => {
        for (const k of storeKeys) cache.set(k, { at: Date.now(), body });
        if (edge) {
          try {
            await edge.put(request, new Response(body, { headers: { "Content-Type": "application/json" } }));
          } catch {}
        }
      })
      .catch(() => {})
      .finally(() => {
        refreshing = false;
      });
    if (waitUntil) waitUntil(task);
  }

  // L1: isolate memory — fresh hit
  const mem = cache.get(key);
  if (mem) return jsonRes(mem.body);

  // L1 stale: serve immediately, refresh in background
  for (const [, entry] of cache) {
    recompute();
    return jsonRes(entry.body);
  }

  // L2: Cloudflare edge cache — shared across isolates
  if (edge) {
    try {
      const m = await edge.match(request);
      if (m) {
        const body = await m.text();
        let age = Number.POSITIVE_INFINITY;
        try {
          age = Date.now() - Date.parse(JSON.parse(body).fetchedAt);
        } catch {}
        if (age < TTL_MS) {
          cache.set(key, { at: Date.now(), body });
          return jsonRes(body);
        }
        recompute();
        return jsonRes(body);
      }
    } catch {}
  }

  // Miss: compute synchronously
  const { body, storeKeys } = await computeBody();
  for (const k of storeKeys) cache.set(k, { at: Date.now(), body });
  if (edge) {
    try {
      await edge.put(request, new Response(body, { headers: { "Content-Type": "application/json" } }));
    } catch {}
  }
  return jsonRes(body);
};
