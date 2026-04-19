interface StatsResp {
  gamesCount: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  avgOpponentRating: number | null;
  ratingTimeline: Array<{ date: string; rating: number | null }>;
  openingStats: Array<{ name: string; games: number; wins: number; winRate: number }>;
  perfCounts: Record<string, number>;
  opponentRatingBuckets: Array<{ bucket: string; count: number; wins: number; winRate: number }>;
  recentGames: Array<any>;
}

async function renderStats(max = 200) {
  const summaryGames = document.getElementById('stat-games');
  const summaryWinrate = document.getElementById('stat-winrate');
  const summaryAvgOpp = document.getElementById('stat-avgopp');
  const summaryTopOpening = document.getElementById('stat-topopening');

  if (!summaryGames || !summaryWinrate || !summaryAvgOpp || !summaryTopOpening) return;

  const res = await fetch(`/api/lichess-stats?max=${max}`);
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    const msg = json?.message || 'Failed to load stats';
    const recent = document.getElementById('recent-games-stats');
    if (recent) recent.innerHTML = `<div class="text-sm text-red-400">${msg}</div>`;
    return;
  }
  const data: StatsResp = await res.json();

  summaryGames.textContent = String(data.gamesCount ?? '0');
  summaryWinrate.textContent = `${Math.round((data.winRate || 0) * 100)}%`;
  summaryAvgOpp.textContent = data.avgOpponentRating ? String(data.avgOpponentRating) : '—';
  summaryTopOpening.textContent = (data.openingStats && data.openingStats[0]) ? data.openingStats[0].name : '—';

  // Results pie
  const resultsEl = document.getElementById('resultsChart') as HTMLCanvasElement | null;
  if (resultsEl && (window as any).Chart) {
    const resultsCtx = resultsEl.getContext('2d')!;
    new (window as any).Chart(resultsCtx, {
      type: 'pie',
      data: {
        labels: ['Wins', 'Losses', 'Draws'],
        datasets: [{
          data: [data.wins, data.losses, data.draws],
          backgroundColor: ['#10b981', '#f87171', '#9ca3af']
        }]
      },
      options: { responsive: true }
    });
  }

  // Rating timeline (line)
  const ratingEl = document.getElementById('ratingChart') as HTMLCanvasElement | null;
  if (ratingEl && (window as any).Chart) {
    const ratingCtx = ratingEl.getContext('2d')!;
    const timeline = (data.ratingTimeline || []).filter(r => r.rating != null);
    new (window as any).Chart(ratingCtx, {
      type: 'line',
      data: {
        labels: timeline.map(t => new Date(t.date).toLocaleDateString()),
        datasets: [{
          label: 'Rating',
          data: timeline.map(t => t.rating),
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96,165,250,0.12)',
          tension: 0.15,
          fill: true,
        }]
      },
      options: { responsive: true, scales: { y: { beginAtZero: false } } }
    });
  }

  // Openings bar
  const openingsEl = document.getElementById('openingsChart') as HTMLCanvasElement | null;
  if (openingsEl && (window as any).Chart) {
    const openingsCtx = openingsEl.getContext('2d')!;
    const opens = (data.openingStats || []).slice(0, 12);
    new (window as any).Chart(openingsCtx, {
      type: 'bar',
      data: {
        labels: opens.map(o => o.name),
        datasets: [{
          label: 'Games',
          data: opens.map(o => o.games),
          backgroundColor: '#f59e0b'
        }]
      },
      options: { responsive: true, indexAxis: 'y', scales: { x: { beginAtZero: true } } }
    });
  }

  // Opponent buckets
  const oppEl = document.getElementById('oppRatingChart') as HTMLCanvasElement | null;
  if (oppEl && (window as any).Chart) {
    const oppCtx = oppEl.getContext('2d')!;
    const opp = (data.opponentRatingBuckets || []);
    new (window as any).Chart(oppCtx, {
      type: 'bar',
      data: {
        labels: opp.map(o => o.bucket),
        datasets: [{
          label: 'Games',
          data: opp.map(o => o.count),
          backgroundColor: '#8b5cf6'
        }]
      },
      options: { responsive: true, scales: { y: { beginAtZero: true } } }
    });
  }

  // Recent games
  const recent = document.getElementById('recent-games-stats');
  if (recent) {
    if (!data.recentGames || data.recentGames.length === 0) {
      recent.innerHTML = '<div class="text-sm text-neutral-500">No recent games</div>';
    } else {
      recent.innerHTML = data.recentGames.slice(0, 10).map(g => `
        <a href="${g.url}" target="_blank" rel="noopener noreferrer" class="flex justify-between items-start group cursor-pointer hover:bg-neutral-800/50 -mx-3 px-3 py-2.5 rounded-lg transition-all duration-200 border border-transparent hover:border-neutral-700/50">
          <div class="flex-1">
            <div class="flex items-baseline gap-2">
              <span class="text-neutral-200 group-hover:text-neutral-100 transition-colors font-medium">vs ${g.opponent}</span>
              ${g.opponentRating ? `<span class="text-xs text-neutral-500">(${g.opponentRating})</span>` : ''}
            </div>
            <div class="text-xs text-neutral-500 mt-0.5">${g.opening}</div>
          </div>
          <div class="flex items-center gap-3 flex-shrink-0">
            <div class="text-xs text-neutral-500">${(new Date(g.date)).toLocaleDateString()}</div>
            <div class="text-xs font-semibold px-2 py-1 rounded ${g.result === 'Win' ? 'text-emerald-400 bg-emerald-400/10' : g.result === 'Loss' ? 'text-red-400 bg-red-400/10' : 'text-neutral-400 bg-neutral-400/10'}">${g.result}</div>
          </div>
        </a>
      `).join('');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderStats(200).catch(err => {
    console.error('Error loading chess stats:', err);
    const recent = document.getElementById('recent-games-stats');
    if (recent) recent.innerHTML = `<div class="text-sm text-red-400">Failed to load stats</div>`;
  });
});
