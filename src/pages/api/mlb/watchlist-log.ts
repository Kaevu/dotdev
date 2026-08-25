export const prerender = false;

import type { APIRoute } from "astro";
import { WATCHLIST, currentSeason } from "../../../lib/mlb/config";

const STATSAPI = "https://statsapi.mlb.com/api/v1";
const TTL_MS = 60 * 60 * 1000;

type CacheEntry = { at: number; body: string };
let cached: CacheEntry | null = null;

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}

function ymd(dateStr: string): number {
  return Number(dateStr.replaceAll("-", "")) || 0;
}

async function fetchPlayerLog(id: number, group: string, season: number, sportId: number): Promise<number[][]> {
  try {
    const json = await fetchJson(
      `${STATSAPI}/people/${id}/stats?stats=gameLog&group=${group}&season=${season}&sportId=${sportId}`
    );
    const splits: any[] = json.stats?.[0]?.splits ?? [];
    if (group === "pitching") {
      return splits.map((s) => [
        ymd(s.date),
        s.stat.outs ?? 0,
        s.stat.battersFaced ?? 0,
        s.stat.hits ?? 0,
        s.stat.earnedRuns ?? 0,
        s.stat.baseOnBalls ?? 0,
        s.stat.strikeOuts ?? 0,
        s.stat.homeRuns ?? 0,
      ]);
    }
    return splits.map((s) => [
      ymd(s.date),
      s.stat.plateAppearances ?? 0,
      s.stat.atBats ?? 0,
      s.stat.hits ?? 0,
      s.stat.doubles ?? 0,
      s.stat.triples ?? 0,
      s.stat.homeRuns ?? 0,
      s.stat.rbi ?? 0,
      s.stat.baseOnBalls ?? 0,
      s.stat.hitByPitch ?? 0,
      s.stat.strikeOuts ?? 0,
      s.stat.stolenBases ?? 0,
      s.stat.sacFlies ?? 0,
    ]);
  } catch {
    return [];
  }
}

export const GET: APIRoute = async () => {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return new Response(cached.body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
    });
  }

  const season = currentSeason();

  async function collect(seasonNum: number) {
    return Promise.all(
      WATCHLIST.map(async (entry) => {
        const group = entry.kind === "pitcher" ? "pitching" : "hitting";
        const [levelGames, mlbGames] = await Promise.all([
          fetchPlayerLog(entry.id, group, seasonNum, entry.sportId),
          fetchPlayerLog(entry.id, group, seasonNum, 1),
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

  let players = await collect(season);
  let usedSeason = season;
  if (players.every((p) => p.games.length === 0)) {
    usedSeason = season - 1;
    players = await collect(usedSeason);
  }

  const body = JSON.stringify({ season: usedSeason, fetchedAt: new Date().toISOString(), players });
  cached = { at: Date.now(), body };

  return new Response(body, {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
  });
};
