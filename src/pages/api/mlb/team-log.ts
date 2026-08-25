export const prerender = false;

import type { APIRoute } from "astro";
import { KNOWN_TEAM_IDS, currentSeason, sportIdForTeam } from "../../../lib/mlb/config";

const STATSAPI = "https://statsapi.mlb.com/api/v1";
const TTL_MS = 60 * 60 * 1000;

type CacheEntry = { at: number; body: string };
const cache: Record<string, CacheEntry> = {};

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}

function ymd(dateStr: string): number {
  return Number(dateStr.replaceAll("-", "")) || 0;
}

type RosterPerson = {
  person: { id: number; fullName: string };
  position: { abbreviation: string };
};

async function fetchPlayerLog(
  id: number,
  group: string,
  season: number,
  sportId: number
): Promise<number[][]> {
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
        s.stat.hitBatsmen ?? 0,
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
      s.stat.intentionalWalks ?? 0,
    ]);
  } catch {
    return [];
  }
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const teamId = Number(url.searchParams.get("teamId"));
  const group = url.searchParams.get("group") === "pitching" ? "pitching" : "hitting";
  const seasonParam = Number(url.searchParams.get("season")) || undefined;
  const season = seasonParam ?? currentSeason();

  if (!KNOWN_TEAM_IDS.has(teamId)) {
    return new Response(
      JSON.stringify({ error: "unknown teamId", known: [...KNOWN_TEAM_IDS] }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const bucket = Math.floor(Date.now() / TTL_MS);
  const sportId = sportIdForTeam(teamId);
  const key = `${teamId}:${group}:${season}:${bucket}`;
  const hit = cache[key];
  if (hit) {
    return new Response(hit.body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
    });
  }

  let rosterJson: any;
  try {
    rosterJson = await fetchJson(`${STATSAPI}/teams/${teamId}/roster?rosterType=active`);
  } catch (e: any) {
    return new Response(JSON.stringify({ error: "roster fetch failed", message: String(e?.message || e) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const isPitcher = (p: RosterPerson) => p.position?.abbreviation === "P";
  const wanted: RosterPerson[] = ((rosterJson.roster ?? []) as RosterPerson[])
    .filter((p) => (group === "pitching" ? isPitcher(p) : !isPitcher(p)))
    .slice(0, 40);

  let players = await Promise.all(
    wanted.map(async (p) => {
      const games = await fetchPlayerLog(p.person.id, group, season, sportId);
      return {
        id: p.person.id,
        name: p.person.fullName,
        pos: p.position?.abbreviation ?? "",
        lastPlayed: games.length ? games[games.length - 1][0] : null,
        games,
      };
    })
  );

  if (!seasonParam && players.every((p) => p.games.length === 0)) {
    const prior = season - 1;
    players = await Promise.all(
      wanted.map(async (p) => {
        const games = await fetchPlayerLog(p.person.id, group, prior, sportId);
        return {
          id: p.person.id,
          name: p.person.fullName,
          pos: p.position?.abbreviation ?? "",
          lastPlayed: games.length ? games[games.length - 1][0] : null,
          games,
        };
      })
    );
    if (players.some((p) => p.games.length > 0)) {
      const body = JSON.stringify({ teamId, group, season: prior, fetchedAt: new Date().toISOString(), players });
      cache[`${teamId}:${group}:${prior}:${bucket}`] = { at: Date.now(), body };
      return new Response(body, {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
      });
    }
  }

  const body = JSON.stringify({ teamId, group, season, fetchedAt: new Date().toISOString(), players });
  for (const k of Object.keys(cache)) delete cache[k];
  cache[key] = { at: Date.now(), body };

  return new Response(body, {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
  });
};
