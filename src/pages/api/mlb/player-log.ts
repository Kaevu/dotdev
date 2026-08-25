export const prerender = false;

import type { APIRoute } from "astro";
import { currentSeason } from "../../../lib/mlb/config";
import { playerGameLog } from "../../../lib/mlb/api-shared";

const TTL_MS = 60 * 60 * 1000;
type CacheEntry = { at: number; body: string };
const cache: Record<string, CacheEntry> = {};

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get("playerId"));
  const group = url.searchParams.get("group") === "pitching" ? "pitching" : "hitting";
  const sportId = Number(url.searchParams.get("sportId")) || 1;
  const seasonParam = Number(url.searchParams.get("season")) || undefined;
  const season = seasonParam ?? currentSeason();

  if (!Number.isFinite(playerId) || playerId <= 0) {
    return new Response(JSON.stringify({ error: "invalid playerId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const bucket = Math.floor(Date.now() / TTL_MS);
  const key = `${playerId}:${group}:${sportId}:${season}:${bucket}`;
  if (cache[key]) {
    return new Response(cache[key].body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
    });
  }

  async function collect(seasonNum: number) {
    const [levelGames, mlbGames] =
      sportId === 1
        ? await playerGameLog(playerId, group, seasonNum, 1).then((g) => [g, []])
        : await Promise.all([
            playerGameLog(playerId, group, seasonNum, sportId),
            playerGameLog(playerId, group, seasonNum, 1),
          ]);
    const byDate = new Map<number, number[]>();
    for (const g of [...levelGames, ...mlbGames]) byDate.set(g[0], g);
    return [...byDate.values()].sort((a, b) => a[0] - b[0]);
  }

  let games = await collect(season);
  let usedSeason = season;
  if (games.length === 0 && !seasonParam) {
    usedSeason = season - 1;
    games = await collect(usedSeason);
  }

  const body = JSON.stringify({
    playerId,
    group,
    sportId,
    season: usedSeason,
    lastPlayed: games.length ? games[games.length - 1][0] : null,
    games,
  });
  for (const k of Object.keys(cache)) delete cache[k];
  cache[key] = { at: Date.now(), body };

  return new Response(body, {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
  });
};
