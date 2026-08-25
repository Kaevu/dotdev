export const prerender = false;

import type { APIRoute } from "astro";
import { AFFILIATES, YANKEES, currentSeason } from "../../../lib/mlb/config";
import { STATSAPI, fetchJson } from "../../../lib/mlb/api-shared";

const TTL_MS = 60 * 60 * 1000;
type CacheEntry = { at: number; body: string };
let cached: CacheEntry | null = null;

type IndexEntry = {
  id: number;
  name: string;
  pos: string;
  teamShort: string;
  kind: "hitter" | "pitcher";
  sportId: number;
  leagueId: number;
};

export const GET: APIRoute = async () => {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return new Response(cached.body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
    });
  }

  const season = currentSeason();
  const teams = [YANKEES, ...AFFILIATES];
  const seen = new Set<number>();
  const players: IndexEntry[] = [];

  await Promise.all(
    teams.map(async (t) => {
      let roster: any[] = [];
      try {
        const rosterType = t.id === YANKEES.id ? "active" : "fullSeason";
        const j = await fetchJson(`${STATSAPI}/teams/${t.id}/roster?rosterType=${rosterType}`);
        roster = j.roster ?? [];
        if (roster.length === 0 && t.id !== YANKEES.id) {
          const j2 = await fetchJson(`${STATSAPI}/teams/${t.id}/roster?rosterType=active`);
          roster = j2.roster ?? [];
        }
      } catch {}
      for (const p of roster) {
        const id = p.person?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const pos = p.position?.abbreviation ?? "";
        players.push({
          id,
          name: p.person.fullName,
          pos,
          teamShort: t.short,
          kind: pos === "P" ? "pitcher" : "hitter",
          sportId: t.sportId,
          leagueId: t.leagueId,
        });
      }
    })
  );

  players.sort((a, b) => a.name.localeCompare(b.name));
  const body = JSON.stringify({ season, fetchedAt: new Date().toISOString(), players });
  cached = { at: Date.now(), body };

  return new Response(body, {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
  });
};
