export const prerender = false;

import type { APIRoute } from 'astro';

type CacheEntry = {
  expiresAt: number;
  data: any;
};

const CACHE_TTL_DEFAULT = 300; // seconds

// Simple in-memory cache keyed by username+max
const cache: Record<string, CacheEntry> = {};

function bucketRating(r: number | undefined) {
  if (r == null) return 'unknown';
  if (r < 1200) return '<1200';
  if (r < 1400) return '1200-1399';
  if (r < 1600) return '1400-1599';
  if (r < 1800) return '1600-1799';
  if (r < 2000) return '1800-1999';
  return '2000+';
}

export const GET: APIRoute = async ({ locals, request }) => {
  const env = (locals as any)?.runtime?.env;
  const LICHESS_TOKEN = env?.LICHESS_TOKEN as string | undefined;
  const USERNAME = env?.LICHESS_USERNAME as string | undefined;

  if (!LICHESS_TOKEN || !USERNAME) {
    return new Response(JSON.stringify({
      error: 'Missing configuration',
      message: 'LICHESS_TOKEN or LICHESS_USERNAME not set'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(request.url);
  const maxParam = Number(url.searchParams.get('max') || '200');
  const max = Number.isFinite(maxParam) ? Math.min(Math.max(10, Math.floor(maxParam)), 500) : 200;
  const ttlParam = Number(url.searchParams.get('ttl') || '');
  const ttl = Number.isFinite(ttlParam) && ttlParam > 0 ? Math.min(ttlParam, 3600) : CACHE_TTL_DEFAULT;

  const cacheKey = `${USERNAME.toLowerCase()}:${max}`;

  // Return cached if fresh
  const cached = cache[cacheKey];
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return new Response(JSON.stringify(cached.data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${ttl}`
      }
    });
  }

  try {
    const response = await fetch(
      `https://lichess.org/api/games/user/${USERNAME}?max=${max}&pgnInJson=true&opening=true`,
      {
        headers: {
          'Authorization': `Bearer ${LICHESS_TOKEN}`,
          'Accept': 'application/x-ndjson'
        }
      }
    );

    if (!response.ok) {
      return new Response(JSON.stringify({
        error: 'Failed to fetch games from Lichess',
        status: response.status,
        statusText: response.statusText
      }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const text = await response.text();
    if (!text || text.trim().length === 0) {
      const empty = { gamesCount: 0, wins: 0, losses: 0, draws: 0, winRate: 0, avgOpponentRating: null, ratingTimeline: [], openingStats: [], perfCounts: {}, opponentRatingBuckets: [], recentGames: [] };
      cache[cacheKey] = { data: empty, expiresAt: now + ttl * 1000 };
      return new Response(JSON.stringify(empty), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${ttl}`
        }
      });
    }

    const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
    const gamesRaw = lines.map(line => JSON.parse(line) as any);

    // Aggregation containers
    let wins = 0, losses = 0, draws = 0;
    const ratingTimeline: Array<{ date: string; rating: number | null }> = [];
    const openingMap: Record<string, { games: number; wins: number }> = {};
    const perfCounts: Record<string, number> = {};
    const opponentBuckets: Record<string, { count: number; wins: number }> = {};
    let totalOppRating = 0;
    let oppRatingCount = 0;

    const recentGames: Array<any> = [];

    for (const game of gamesRaw) {
      const timestamp = game.createdAt;
      const gameDate = new Date(timestamp);
      const isoDate = gameDate.toISOString();

      const isWhite = game.players?.white?.user?.id === USERNAME.toLowerCase();
      const playerRating = isWhite ? game.players?.white?.rating : game.players?.black?.rating;
      const opponentRating = isWhite ? game.players?.black?.rating : game.players?.white?.rating;
      const opponentName = isWhite
        ? (game.players?.black?.user?.name || 'Anonymous')
        : (game.players?.white?.user?.name || 'Anonymous');

      // result
      let result = 'Draw';
      if (game.winner) {
        const didWin = (isWhite && game.winner === 'white') || (!isWhite && game.winner === 'black');
        result = didWin ? 'Win' : 'Loss';
      }

      if (result === 'Win') wins++;
      else if (result === 'Loss') losses++;
      else draws++;

      // rating timeline
      ratingTimeline.push({ date: isoDate, rating: playerRating ?? null });

      // openings
      const openingName = game.opening?.name || 'Unknown Opening';
      if (!openingMap[openingName]) openingMap[openingName] = { games: 0, wins: 0 };
      openingMap[openingName].games++;
      if (result === 'Win') openingMap[openingName].wins++;

      // perf/speed
      const perf = game.speed || game.perf || 'unknown';
      perfCounts[perf] = (perfCounts[perf] || 0) + 1;

      // opponent rating buckets
      const bucket = bucketRating(opponentRating);
      if (!opponentBuckets[bucket]) opponentBuckets[bucket] = { count: 0, wins: 0 };
      opponentBuckets[bucket].count++;
      if (result === 'Win') opponentBuckets[bucket].wins++;

      if (opponentRating != null) {
        totalOppRating += opponentRating;
        oppRatingCount++;
      }

      // recent games (keep as we go)
      recentGames.push({
        id: game.id,
        date: isoDate,
        displayDate: gameDate.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        opponent: opponentName,
        result,
        opening: openingName,
        url: `https://lichess.org/${game.id}`,
        rating: playerRating ?? null,
        opponentRating: opponentRating ?? null,
      });
    }

    // sort rating timeline by date ascending
    ratingTimeline.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    // recentGames: keep newest first
    recentGames.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const openingStats = Object.entries(openingMap)
      .map(([name, d]) => ({ name, games: d.games, wins: d.wins, winRate: d.games ? d.wins / d.games : 0 }))
      .sort((a, b) => b.games - a.games)
      .slice(0, 20);

    const opponentRatingBuckets = Object.entries(opponentBuckets).map(([bucket, d]) => ({
      bucket,
      count: d.count,
      wins: d.wins,
      winRate: d.count ? d.wins / d.count : 0
    })).sort((a, b) => b.count - a.count);

    const gamesCount = wins + losses + draws;
    const winRate = gamesCount ? wins / gamesCount : 0;
    const avgOpponentRating = oppRatingCount ? Math.round(totalOppRating / oppRatingCount) : null;

    const result = {
      gamesCount,
      wins,
      losses,
      draws,
      winRate,
      avgOpponentRating,
      ratingTimeline,
      openingStats,
      perfCounts,
      opponentRatingBuckets,
      recentGames: recentGames.slice(0, 50)
    };

    // cache
    cache[cacheKey] = { data: result, expiresAt: now + ttl * 1000 };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${ttl}`
      }
    });

  } catch (error) {
    console.error('Error in lichess-stats route:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
