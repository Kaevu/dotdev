interface Game {
  date: string;
  opponent: string;
  result: string;
  opening: string;
  url: string;
  rating?: number;
  opponentRating?: number;
}

async function loadGames() {
  const container = document.getElementById('recent-games');
  if (!container) return;

  try {
    const response = await fetch('/api/lichess');
    const games: Game[] = await response.json();
    
    const gamesHTML = games.map(game => `
      <a 
        href="${game.url}" 
        target="_blank" 
        rel="noopener noreferrer"
        class="flex justify-between items-start group cursor-pointer hover:bg-neutral-800/50 -mx-3 px-3 py-2.5 rounded-lg transition-all duration-200 border border-transparent hover:border-neutral-700/50"
      >
        <div class="flex-1">
          <div class="flex items-baseline gap-2">
            <span class="text-neutral-200 group-hover:text-neutral-100 transition-colors font-medium">
              vs ${game.opponent}
            </span>
            ${game.opponentRating ? `<span class="text-xs text-neutral-500">(${game.opponentRating})</span>` : ''}
          </div>
          <div class="text-xs text-neutral-500 mt-0.5">${game.opening}</div>
        </div>
        <div class="flex items-center gap-3 flex-shrink-0">
          <div class="text-xs text-neutral-500">${game.date}</div>
          <div class="text-xs font-semibold px-2 py-1 rounded ${
            game.result === 'Win' ? 'text-emerald-400 bg-emerald-400/10' :
            game.result === 'Loss' ? 'text-red-400 bg-red-400/10' :
            'text-neutral-400 bg-neutral-400/10'
          }">
            ${game.result}
          </div>
        </div>
      </a>
    `).join('');
    
    container.innerHTML = `<div class="space-y-3">${gamesHTML}</div>`;
    
  } catch (error) {
    console.error('Error loading games:', error);
    container.innerHTML = `
      <div class="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">
        Failed to load games
      </div>
    `;
  }
}

loadGames();
