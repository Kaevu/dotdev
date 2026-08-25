export const prerender = false;

import type { APIRoute } from "astro";
import { currentSeason } from "../../../lib/mlb/config";
import { STATSAPI, fetchJson, ymd } from "../../../lib/mlb/api-shared";

const TTL_MS = 60 * 60 * 1000;
type CacheEntry = { at: number; body: string };
const cache: Record<string, CacheEntry> = {};

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const playerId = Number(url.searchParams.get("playerId"));
  const group = url.searchParams.get("group") === "pitching" ? "pitching" : "hitting";
  const sitCodeRaw = (url.searchParams.get("sitCode") ?? "").toLowerCase();
  const sportId = Number(url.searchParams.get("sportId")) || 1;
  const seasonParam = Number(url.searchParams.get("season")) || undefined;
  const season = seasonParam ?? currentSeason();

  const sitCode = ["vl", "vr"].includes(sitCodeRaw) ? sitCodeRaw : null;

  if (!Number.isFinite(playerId) || playerId <= 0 || !sitCode) {
    return new Response(JSON.stringify({ error: "playerId and sitCode (vl|vr) required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const bucket = Math.floor(Date.now() / TTL_MS);
  const key = `${playerId}:${group}:${sitCode}:${sportId}:${season}:${bucket}`;
  if (cache[key]) {
    return new Response(cache[key].body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
    });
  }

  async function fetchSplit(seasonNum: number): Promise<number[][] | null> {
    try {
      const json = await fetchJson(
        `${STATSAPI}/people/${playerId}/stats?stats=statSplits&group=${group}&season=${seasonNum}&sportId=${sportId}&sitCodes=${sitCode}`
      );
      const split = json.stats?.[0]?.splits?.[0];
      if (!split) return [];
      return [[
        ymd(split.date ?? ""),
        split.stat.plateAppearances ?? 0,
        split.stat.atBats ?? 0,
        split.stat.hits ?? 0,
        split.stat.doubles ?? 0,
        split.stat.triples ?? 0,
        split.stat.homeRuns ?? 0,
        split.stat.rbi ?? 0,
        split.stat.baseOnBalls ?? 0,
        split.stat.hitByPitch ?? 0,
        split.stat.strikeOuts ?? 0,
        split.stat.stolenBases ?? 0,
        split.stat.sacFlies ?? 0,
        split.stat.intentionalWalks ?? 0,
        0,
      ]];
    } catch {
      return null;
    }
  }

  let games = await fetchSplit(season);
  let usedSeason = season;
  if (games === null || (games.length === 0 && !seasonParam)) {
    usedSeason = season - 1;
    games = await fetchSplit(usedSeason);
  }

  const body = JSON.stringify({
    playerId,
    group,
    sitCode,
    sportId,
    season: usedSeason,
    games: games ?? [],
  });
  for (const k of Object.keys(cache)) delete cache[k];
  cache[key] = { at: Date.now(), body };

  return new Response(body, {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
  });
};
