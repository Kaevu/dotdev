export const prerender = false;

import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ context }) => {
  const env = context.locals.runtime.env;
  const LICHESS_TOKEN = env.LICHESS_TOKEN;
  const USERNAME = env.LICHESS_USERNAME;


  if (!LICHESS_TOKEN || !USERNAME) {
    return new Response(JSON.stringify({ 
      error: 'Missing configuration',
      message: 'LICHESS_TOKEN or LICHESS_USERNAME not set',
      debug: {
        hasRuntime: !!context.locals.runtime,
        hasEnv: !!env,
        hasToken: !!LICHESS_TOKEN,
        hasUsername: !!USERNAME
      }
    }), {
      status: 500,
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
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
