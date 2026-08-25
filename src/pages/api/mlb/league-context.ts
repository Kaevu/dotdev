export const prerender = false;

import type { APIRoute } from "astro";
import { currentSeason } from "../../../lib/mlb/config";

const STATSAPI = "https://statsapi.mlb.com/api/v1";
const TTL_MS = 24 * 60 * 60 * 1000;

type LeagueCtx = {
  name: string;
  teams: number;
  lgOBP: number | null;
  lgSLG: number | null;
  lgOPS: number | null;
  lgERA: number | null;
  fipConst: number | null;
};

type CacheEntry = { at: number; body: string };
const cache: Record<string, CacheEntry> = {};

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}

function num(v: any): number | null {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

async function buildContext(sportId: number, season: number) {
  const teamsJson = await fetchJson(`${STATSAPI}/teams?sportIds=${sportId}&season=${season}`);
  const teams: any[] = (teamsJson.teams ?? []).filter((t: any) => t.league?.id);
  const byLeague = new Map<number, { name: string; teamIds: number[] }>();
  for (const t of teams) {
    const lid = t.league.id as number;
    if (!byLeague.has(lid)) byLeague.set(lid, { name: t.league.name, teamIds: [] });
    byLeague.get(lid)!.teamIds.push(t.id);
  }

  const leagues: Record<string, LeagueCtx> = {};
  for (const [lid, info] of byLeague) {
    let gSum = 0;
    let obpW = 0;
    let slgW = 0;
    let erTotal = 0;
    let outsTotal = 0;
    let hrT = 0,
      bbT = 0,
      soT = 0,
      hbpT = 0;

    await Promise.all(
      info.teamIds.map(async (tid) => {
        try {
          const j = await fetchJson(
            `${STATSAPI}/teams/${tid}/stats?stats=season&group=hitting,pitching&season=${season}&sportIds=${sportId}`
          );
          for (const sp of j.stats ?? []) {
            const st = sp.splits?.[0]?.stat;
            if (!st) continue;
            if (sp.group?.displayName === "hitting") {
              const g = st.gamesPlayed ?? 0;
              const obp = num(st.obp);
              const slg = num(st.slg);
              gSum += g;
              if (obp != null) obpW += obp * g;
              if (slg != null) slgW += slg * g;
            } else if (sp.group?.displayName === "pitching") {
              const ipStr = String(st.inningsPitched ?? "0.0");
              const [w, f] = ipStr.split(".");
              outsTotal += (parseInt(w, 10) || 0) * 3 + (parseInt(f || "0", 10) || 0);
              hrT += st.homeRuns ?? 0;
              bbT += st.baseOnBalls ?? 0;
              soT += st.strikeOuts ?? 0;
              hbpT += st.hitBatsmen ?? 0;
              const er = num(st.earnedRuns);
              if (er != null) {
                erTotal += er;
              } else if (num(st.era) != null) {
                erTotal += ((num(st.era) as number) * outsTotal) / 27;
              }
            }
          }
        } catch {}
      })
    );

    const lgOBP = gSum > 0 ? obpW / gSum : null;
    const lgSLG = gSum > 0 ? slgW / gSum : null;
    const lgERA = outsTotal > 0 ? (erTotal * 27) / outsTotal : null;
    const fipNum =
      13 * hrT + 3 * (bbT + hbpT) - 2 * soT;
    leagues[String(lid)] = {
      name: info.name,
      teams: info.teamIds.length,
      lgOBP,
      lgSLG,
      lgOPS: lgOBP != null && lgSLG != null ? lgOBP + lgSLG : null,
      lgERA,
      fipConst: outsTotal > 0 ? lgERA! - (fipNum * 3) / outsTotal : null,
    };
  }
  return leagues;
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const sportIdsParam = url.searchParams.get("sportIds") ?? "";
  const season = Number(url.searchParams.get("season")) || currentSeason();

  const sportIds = [
    ...new Set(
      sportIdsParam
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0)
    ),
  ].slice(0, 8);

  if (sportIds.length === 0) {
    return new Response(JSON.stringify({ error: "no valid sportIds" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const bucket = Math.floor(Date.now() / TTL_MS);
  const key = `${sportIds.sort().join(",")}:${season}:${bucket}`;
  if (cache[key]) {
    return new Response(cache[key].body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
    });
  }

  const out: Record<string, any> = {};
  await Promise.all(
    sportIds.map(async (sid) => {
      try {
        out[String(sid)] = await buildContext(sid, season);
      } catch (e: any) {
        out[String(sid)] = { error: String(e?.message || e) };
      }
    })
  );

  const body = JSON.stringify({ season, fetchedAt: new Date().toISOString(), sports: out });
  for (const k of Object.keys(cache)) delete cache[k];
  cache[key] = { at: Date.now(), body };

  return new Response(body, {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
  });
};
