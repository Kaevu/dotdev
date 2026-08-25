export const STATSAPI = "https://statsapi.mlb.com/api/v1";

export function ymd(dateStr: string): number {
  return Number(dateStr.replaceAll("-", "")) || 0;
}

export async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}

export function mapSplits(splits: any[], group: string): number[][] {
  if (group === "pitching") {
    return splits.map((s) => [
      ymd(s.date),
      s.stat.outs ?? 0,
      s.stat.battersFaced ?? 0,
      s.stat.hits ?? 0,
      s.stat.earnedRuns ?? 0,
      s.stat.baseOnBalls ?? 0,
      s.stat.strikeOuts ?? 0,
      s.stat.homeRuns ?? 0,
      s.stat.hitBatsmen ?? 0,
      s.opponent?.id ?? 0,
    ]);
  }
  return splits.map((s) => [
    ymd(s.date),
    s.stat.plateAppearances ?? 0,
    s.stat.atBats ?? 0,
    s.stat.hits ?? 0,
    s.stat.doubles ?? 0,
    s.stat.triples ?? 0,
    s.stat.homeRuns ?? 0,
    s.stat.rbi ?? 0,
    s.stat.baseOnBalls ?? 0,
    s.stat.hitByPitch ?? 0,
    s.stat.strikeOuts ?? 0,
    s.stat.stolenBases ?? 0,
    s.stat.sacFlies ?? 0,
    s.stat.intentionalWalks ?? 0,
    s.opponent?.id ?? 0,
  ]);
}

export async function playerGameLog(
  id: number,
  group: string,
  season: number,
  sportId: number
): Promise<number[][]> {
  try {
    const json = await fetchJson(
      `${STATSAPI}/people/${id}/stats?stats=gameLog&group=${group}&season=${season}&sportId=${sportId}`
    );
    return mapSplits(json.stats?.[0]?.splits ?? [], group);
  } catch {
    return [];
  }
}
