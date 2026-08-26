export const prerender = false;

import type { APIRoute } from "astro";
import { KNOWN_TEAM_IDS, currentSeason, sportIdForTeam } from "../../../lib/mlb/config";
import { STATSAPI, fetchJson, playerGameLog } from "../../../lib/mlb/api-shared";

const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 24;

type CacheEntry = { at: number; body: string };
const cache = new Map<string, CacheEntry>();
const inflight = new Set<string>();

function prune() {
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function jsonRes(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
  });
}

type RosterPerson = {
  person: { id: number; fullName: string };
  position: { abbreviation: string };
};

async function buildPlayers(
  wanted: RosterPerson[],
  group: string,
  seasonNum: number,
  sportId: number
) {
  return Promise.all(
    wanted.map(async (p) => {
      const games = await playerGameLog(p.person.id, group, seasonNum, sportId);
      return {
        id: p.person.id,
        name: p.person.fullName,
        pos: p.position?.abbreviation ?? "",
        lastPlayed: games.length ? games[games.length - 1][0] : null,
        games,
      };
    })
  );
}

async function computeBody(
  teamId: number,
  group: string,
  seasonParam: number | undefined
): Promise<{ body: string; storeKeys: string[] }> {
  const season = seasonParam ?? currentSeason();
  const bucket = Math.floor(Date.now() / TTL_MS);
  const sportId = sportIdForTeam(teamId);

  const rosterJson = await fetchJson(`${STATSAPI}/teams/${teamId}/roster?rosterType=active`);
  const isPitcher = (p: RosterPerson) => p.position?.abbreviation === "P";
  const wanted: RosterPerson[] = ((rosterJson.roster ?? []) as RosterPerson[])
    .filter((p) => (group === "pitching" ? isPitcher(p) : !isPitcher(p)))
    .slice(0, 40);

  let players = await buildPlayers(wanted, group, season, sportId);
  let seasonUsed = season;
  if (!seasonParam && players.every((p) => p.games.length === 0)) {
    const prior = await buildPlayers(wanted, group, season - 1, sportId);
    if (prior.some((p) => p.games.length > 0)) {
      players = prior;
      seasonUsed = season - 1;
    }
  }

  const body = JSON.stringify({ teamId, group, season: seasonUsed, fetchedAt: new Date().toISOString(), players });
  return { body, storeKeys: [`${teamId}:${group}:${seasonUsed}:${bucket}`] };
}

export const GET: APIRoute = async ({ request, locals }) => {
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

  const runtime = (locals as any)?.runtime;
  const cfCtx = runtime?.ctx;
  const waitUntil = cfCtx?.waitUntil?.bind(cfCtx) ?? null;
  const edge = typeof caches !== "undefined" ? (caches as any).default : null;

  const bucket = Math.floor(Date.now() / TTL_MS);
  const baseKey = `${teamId}:${group}:${season}`;
  const key = `${baseKey}:${bucket}`;

  function recompute(): Promise<void> {
    if (inflight.has(baseKey)) return Promise.resolve();
    inflight.add(baseKey);
    const task = computeBody(teamId, group, seasonParam)
      .then(async ({ body, storeKeys }) => {
        for (const k of storeKeys) cache.set(k, { at: Date.now(), body });
        prune();
        if (edge) {
          try {
            await edge.put(request, new Response(body, { headers: { "Content-Type": "application/json" } }));
          } catch {}
        }
      })
      .catch(() => {})
      .finally(() => inflight.delete(baseKey));
    if (waitUntil) waitUntil(task);
    return task;
  }

  // L1: isolate memory — fresh hit
  const mem = cache.get(key);
  if (mem) return jsonRes(mem.body);

  // L1 stale: serve immediately, refresh in background
  for (const [k, entry] of cache) {
    if (k.startsWith(`${baseKey}:`)) {
      recompute();
      return jsonRes(entry.body);
    }
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
          prune();
          return jsonRes(body);
        }
        recompute();
        return jsonRes(body);
      }
    } catch {}
  }

  // Miss: compute synchronously
  try {
    const { body, storeKeys } = await computeBody(teamId, group, seasonParam);
    for (const k of storeKeys) cache.set(k, { at: Date.now(), body });
    prune();
    if (edge) {
      try {
        await edge.put(request, new Response(body, { headers: { "Content-Type": "application/json" } }));
      } catch {}
    }
    return jsonRes(body);
  } catch (e: any) {
    return new Response(JSON.stringify({ error: "fetch failed", message: String(e?.message || e) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
