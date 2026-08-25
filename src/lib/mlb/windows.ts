export type HitGame = number[];
export type PitchGame = number[];

export const HC = {
  DATE: 0,
  PA: 1,
  AB: 2,
  H: 3,
  D2: 4,
  T3: 5,
  HR: 6,
  RBI: 7,
  BB: 8,
  HBP: 9,
  SO: 10,
  SB: 11,
  SF: 12,
} as const;

export const PC = {
  DATE: 0,
  OUTS: 1,
  BF: 2,
  H: 3,
  ER: 4,
  BB: 5,
  SO: 6,
  HR: 7,
} as const;

export type HitLine = {
  g: number;
  pa: number;
  ab: number;
  h: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  sb: number;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  kPct: number | null;
  bbPct: number | null;
};

export type PitchLine = {
  g: number;
  ip: string;
  outs: number;
  bf: number;
  h: number;
  er: number;
  bb: number;
  so: number;
  hr: number;
  era: number | null;
  whip: number | null;
  k9: number | null;
};

function sum(games: number[][], idx: number): number {
  let t = 0;
  for (const g of games) t += g[idx] || 0;
  return t;
}

function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

export function windowByGames<T>(games: T[], n: number): T[] {
  return n >= games.length ? games.slice() : games.slice(-n);
}

export function prevWindowByGames<T>(games: T[], n: number): T[] {
  if (n >= games.length) return [];
  const end = games.length - n;
  return games.slice(Math.max(0, end - n), end);
}

function walkBack(games: number[][], keyIdx: number, min: number): [number, number] {
  let total = 0;
  let i = games.length - 1;
  while (i >= 0 && total < min) {
    total += games[i][keyIdx] || 0;
    i--;
  }
  return [i + 1, games.length];
}

export function windowByPA(games: HitGame[], minPA: number): HitGame[] {
  const [start] = walkBack(games, HC.PA, minPA);
  return games.slice(start);
}

export function prevWindowByPA(games: HitGame[], minPA: number): HitGame[] {
  const [start] = walkBack(games, HC.PA, minPA);
  if (start <= 0) return [];
  const prior = games.slice(0, start);
  const [pStart] = walkBack(prior, HC.PA, minPA);
  return prior.slice(pStart);
}

export function windowByBF(games: PitchGame[], minBF: number): PitchGame[] {
  const [start] = walkBack(games, PC.BF, minBF);
  return games.slice(start);
}

export function prevWindowByBF(games: PitchGame[], minBF: number): PitchGame[] {
  const [start] = walkBack(games, PC.BF, minBF);
  if (start <= 0) return [];
  const prior = games.slice(0, start);
  const [pStart] = walkBack(prior, PC.BF, minBF);
  return prior.slice(pStart);
}

export function hitLine(games: HitGame[]): HitLine {
  const pa = sum(games, HC.PA);
  const ab = sum(games, HC.AB);
  const h = sum(games, HC.H);
  const d2 = sum(games, HC.D2);
  const t3 = sum(games, HC.T3);
  const bb = sum(games, HC.BB);
  const hbp = sum(games, HC.HBP);
  const sf = sum(games, HC.SF);
  const tb = h + d2 + 2 * t3 + 3 * sum(games, HC.HR);
  const avg = ratio(h, ab);
  const obpDenom = ab + bb + hbp + sf;
  const obp = obpDenom > 0 ? (h + bb + hbp) / obpDenom : null;
  const slg = ratio(tb, ab);
  return {
    g: games.length,
    pa,
    ab,
    h,
    hr: sum(games, HC.HR),
    rbi: sum(games, HC.RBI),
    bb,
    so: sum(games, HC.SO),
    sb: sum(games, HC.SB),
    avg,
    obp,
    slg,
    ops: obp != null && slg != null ? obp + slg : null,
    kPct: ratio(sum(games, HC.SO), pa),
    bbPct: ratio(bb, pa),
  };
}

export function pitchLine(games: PitchGame[]): PitchLine {
  const outs = sum(games, PC.OUTS);
  const h = sum(games, PC.H);
  const er = sum(games, PC.ER);
  const bb = sum(games, PC.BB);
  const so = sum(games, PC.SO);
  const wholeIp = Math.floor(outs / 3);
  return {
    g: games.length,
    ip: `${wholeIp}.${outs % 3}`,
    outs,
    bf: sum(games, PC.BF),
    h,
    er,
    bb,
    so,
    hr: sum(games, PC.HR),
    era: outs > 0 ? (er * 27) / outs : null,
    whip: outs > 0 ? ((h + bb) * 3) / outs : null,
    k9: outs > 0 ? (so * 27) / outs : null,
  };
}
