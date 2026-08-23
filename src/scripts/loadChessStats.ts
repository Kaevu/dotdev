type StatsResp = {
  gamesCount: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  avgOpponentRating: number | null;
  ratingTimeline: Array<{ date: string; rating: number | null }>;
  openingStats: Array<{ name: string; games: number; wins: number; winRate: number }>;
  perfCounts: Record<string, number>;
  recentGames: Array<any>;
  pagination?: { page: number; pageSize: number; totalPages: number; totalItems: number };
};

async function renderStats(max = 200, page = 1, pageSize = 10) {
  const summaryGames = document.getElementById('stat-games');
  const summaryWinrate = document.getElementById('stat-winrate');

  if (!summaryGames || !summaryWinrate) return;

  const res = await fetch(`/api/lichess-stats?max=${max}&page=${page}&pageSize=${pageSize}`);
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    const msg = (json as any)?.message || 'Failed to load stats';
    const recent = document.getElementById('recent-games-stats');
    if (recent) recent.innerHTML = `<div class="text-sm text-red-400">${msg}</div>`;
    return;
  }
  const data: StatsResp = await res.json();

  // Summary
  (summaryGames as any).textContent = String((data as any).gamesCount ?? '0');
  (summaryWinrate as any).textContent = `${Math.round((((data as any).winRate || 0) * 100))}%`;

  // Rating timeline (line)
  const ratingEl = document.getElementById('ratingChart') as HTMLCanvasElement | null;
  if (ratingEl && (window as any).Chart) {
    const ratingCtx = ratingEl.getContext('2d')!;
    const timeline = (((data as any).ratingTimeline || []) as Array<{ date: string; rating: number | null }>).filter(r => r.rating != null);
    if ((ratingEl as any)._chartInstance) {
      (ratingEl as any)._chartInstance.destroy();
    }
    const chart = new (window as any).Chart(ratingCtx, {
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
    (ratingEl as any)._chartInstance = chart;
  }

  // Top 3 openings widget
  const topOpeningsEl = document.getElementById('top-openings-widget');
  if (topOpeningsEl) {
    const opens = (((data as any).openingStats || []) as Array<{ name: string; games: number; winRate: number }>).slice(0, 3);
    const total = (data as any).gamesCount || 0;
    if (opens.length === 0 || total === 0) {
      (topOpeningsEl as any).innerHTML = '<div class="text-sm text-neutral-500">No openings data</div>';
    } else {
      (topOpeningsEl as any).innerHTML = opens.map((o) => {
        const usage = total ? Math.round((o.games / total) * 100) : 0;
        const winPct = Math.round(((o as any).winRate || 0) * 100);
        return `
          <div class="p-3 rounded border border-neutral-800 bg-neutral-900/60">
            <div class="flex items-start justify-between gap-3">
              <div class="font-medium text-neutral-200">${o.name}</div>
              <div class="text-xs text-neutral-400">${o.games} games</div>
            </div>
            <div class="mt-2 flex items-center justify-between text-sm">
              <div class="text-neutral-400">Usage</div>
              <div class="text-neutral-200">${usage}%</div>
            </div>
            <div class="w-full h-1.5 bg-neutral-800 rounded mt-1.5">
              <div class="h-1.5 bg-amber-500 rounded" style="width:${usage}%"></div>
            </div>
            <div class="mt-3 flex items-center justify-between text-sm">
              <div class="text-neutral-400">Win Rate</div>
              <div class="${winPct >= 50 ? 'text-emerald-400' : 'text-neutral-200'} font-medium">${winPct}%</div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Recent games with pagination
  const recent = document.getElementById('recent-games-stats');
  const pageInfo = document.getElementById('rg-pageinfo');
  const prevBtn = document.getElementById('rg-prev') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('rg-next') as HTMLButtonElement | null;

  if (recent) {
    const rg: Array<any> = (data as any).recentGames || [];
    if (rg.length === 0) {
      (recent as any).innerHTML = '<div class="text-sm text-neutral-500">No recent games</div>';
    } else {
      (recent as any).innerHTML = rg.map(g => {
        const colorBadge = g.color === 'white'
          ? '<span class="inline-block w-2.5 h-2.5 rounded-full bg-neutral-200 mr-1.5 align-middle"></span>White'
          : '<span class="inline-block w-2.5 h-2.5 rounded-full bg-neutral-700 mr-1.5 align-middle"></span>Black';
        const elo = (g.opponentRating != null) ? `(${g.opponentRating})` : '';
        const eloDiff = (g.eloDiff == null) ? '' : (g.eloDiff > 0 ? `+${g.eloDiff}` : `${g.eloDiff}`);
        const eloClass = (g.eloDiff == null) ? 'text-neutral-400' : (g.eloDiff > 0 ? 'text-emerald-400' : (g.eloDiff < 0 ? 'text-red-400' : 'text-neutral-400'));
        return `
          <a href="${g.url}" target="_blank" rel="noopener noreferrer" class="grid grid-cols-1 sm:grid-cols-5 gap-2 items-center group cursor-pointer hover:bg-neutral-800/50 -mx-3 px-3 py-2.5 rounded-lg transition-all duration-200 border border-transparent hover:border-neutral-700/50">
            <div class="sm:col-span-2">
              <div class="flex items-baseline gap-2">
                <span class="text-neutral-200 group-hover:text-neutral-100 transition-colors font-medium">vs ${g.opponent}</span>
                ${elo ? `<span class=\"text-xs text-neutral-500\">${elo}</span>` : ''}
              </div>
              <div class="text-xs text-neutral-500 mt-0.5 line-clamp-1">${g.opening}</div>
            </div>
            <div class="text-sm text-neutral-300">${colorBadge}</div>
            <div class="text-sm ${(g.result === 'Win') ? 'text-emerald-400' : (g.result === 'Loss' ? 'text-red-400' : 'text-neutral-300')} font-medium">${g.result}</div>
            <div class="text-sm ${eloClass}">${eloDiff || 'N/A'}</div>
            <div class="text-xs text-neutral-500 sm:text-right">${(new Date(g.date)).toLocaleDateString()}</div>
          </a>
        `;
      }).join('');
    }

    // Update pagination controls
    if (pageInfo && (data as any).pagination) {
      (pageInfo as any).textContent = `Page ${(data as any).pagination.page} of ${(data as any).pagination.totalPages}`;
    }
    if (prevBtn) {
      prevBtn.disabled = !(data as any).pagination || (data as any).pagination.page <= 1;
      prevBtn.onclick = () => {
        if ((data as any).pagination && (data as any).pagination.page > 1) {
          renderStats(max, (data as any).pagination.page - 1, pageSize).catch(() => {});
        }
      };
    }
    if (nextBtn) {
      const canNext = (data as any).pagination && (data as any).pagination.page < (data as any).pagination.totalPages;
      nextBtn.disabled = !canNext;
      nextBtn.onclick = () => {
        if ((data as any).pagination && (data as any).pagination.page < (data as any).pagination.totalPages) {
          renderStats(max, (data as any).pagination.page + 1, pageSize).catch(() => {});
        }
      };
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderStats(200, 1, 10).catch(err => {
    console.error('Error loading chess stats:', err);
    const recent = document.getElementById('recent-games-stats');
    if (recent) recent.innerHTML = `<div class="text-sm text-red-400">Failed to load stats</div>`;
  });
});
