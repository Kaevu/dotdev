export const prerender = false;

import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  // Safely extract environment variables from locals.runtime.env when available,
  // otherwise fall back to process.env for local development.
  const env = (locals && (locals as any).runtime && (locals as any).runtime.env) ?? process.env;
  const LICHESS_TOKEN = env?.LICHESS_TOKEN;
  const USERNAME = env?.LICHESS_USERNAME;


  if (!LICHESS_TOKEN || !USERNAME) {
    // If configuration is missing, return an empty array (200) so widgets
    // that depend on this route degrade gracefully instead of throwing 500.
    console.warn('LICHESS_TOKEN or LICHESS_USERNAME not set for Lichess API route', {
      hasRuntime: !!(locals && (locals as any).runtime),
      hasEnv: !!env,
      hasToken: !!LICHESS_TOKEN,
      hasUsername: !!USERNAME
    });
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }


  try {
    const response = await fetch(
      `https://lichess.org/api/games/user/${USERNAME}?max=3&pgnInJson=true&opening=true`,
      {
        headers: {
          'Authorization': `Bearer ${LICHESS_TOKEN}`,
          'Accept': 'application/x-ndjson'
        }
      }
    );

    if (!response.ok) {
      console.error('Lichess returned non-OK status', { status: response.status, statusText: response.statusText });
      // degrade gracefully: return an empty array so the client can continue
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const text = await response.text();
    
    if (!text || text.trim().length === 0) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const games = text.trim().split('\n').map(line => JSON.parse(line));
    
    const formattedGames = games.map((game: any) => {
      const timestamp = game.createdAt;
      const gameDate = new globalThis.Date(timestamp);
      
      const isWhite = game.players.white.user?.id === USERNAME.toLowerCase();
      const opponent = isWhite 
        ? game.players.black.user?.name || 'Anonymous'
        : game.players.white.user?.name || 'Anonymous';
      
      let result = 'Draw';
      if (game.winner) {
        result = (isWhite && game.winner === 'white') || (!isWhite && game.winner === 'black')
          ? 'Win' 
          : 'Loss';
      }
      
      const month = gameDate.toLocaleString('en-US', { month: 'short' });
      const day = gameDate.getDate();
      const year = gameDate.getFullYear();
      const formattedDate = `${month} ${day}, ${year}`;
      
      return {
        date: formattedDate,
        opponent,
        result,
        opening: game.opening?.name || 'Unknown Opening',
        url: `https://lichess.org/${game.id}`,
        rating: isWhite ? game.players.white.rating : game.players.black.rating,
        opponentRating: isWhite ? game.players.black.rating : game.players.white.rating
      };
    });

    return new Response(JSON.stringify(formattedGames), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300'
      }
    });

  } catch (error) {
    console.error('Error in Lichess API route:', error);
    // degrade gracefully: return empty array so widgets don't break on server errors
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
