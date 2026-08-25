export type TeamDef = {
  id: number;
  short: string;
  label: string;
  sportId: number;
};

export const YANKEES: TeamDef = {
  id: 147,
  short: "Yankees",
  label: "New York Yankees",
  sportId: 1,
};

export const AFFILIATES: TeamDef[] = [
  { id: 531, short: "RailRiders", label: "AAA · Scranton/Wilkes-Barre RailRiders", sportId: 11 },
  { id: 1956, short: "Somerset", label: "AA · Somerset Patriots", sportId: 12 },
  { id: 537, short: "Hudson Valley", label: "A+ · Hudson Valley Renegades", sportId: 13 },
  { id: 587, short: "Tarpons", label: "A · Tampa Tarpons", sportId: 14 },
  { id: 475, short: "FCL Yankees", label: "Rookie · FCL Yankees", sportId: 16 },
];

export const KNOWN_TEAM_IDS = new Set<number>([YANKEES.id, ...AFFILIATES.map((t) => t.id)]);

export function sportIdForTeam(teamId: number): number {
  if (teamId === YANKEES.id) return YANKEES.sportId;
  return AFFILIATES.find((t) => t.id === teamId)?.sportId ?? 1;
}

export type WatchEntry = {
  id: number;
  name: string;
  kind: "hitter" | "pitcher";
  note: string;
  sportId: number;
};

export const WATCHLIST: WatchEntry[] = [
  { id: 828076, name: "Dax Kilby", kind: "hitter", note: "SS · A", sportId: 14 },
  { id: 695684, name: "Elmer Rodríguez", kind: "pitcher", note: "RHP · AAA", sportId: 11 },
  { id: 801739, name: "Carlos Lagrange", kind: "pitcher", note: "RHP · AAA", sportId: 11 },
  { id: 806059, name: "Hunter Dietz", kind: "pitcher", note: "LHP · RK", sportId: 16 },
  { id: 696292, name: "Ben Hess", kind: "pitcher", note: "RHP · AA", sportId: 12 },
  { id: 695765, name: "Thatcher Hurd", kind: "pitcher", note: "RHP · A", sportId: 14 },
  { id: 701480, name: "Bryce Cunningham", kind: "pitcher", note: "RHP · A+", sportId: 13 },
  { id: 812431, name: "Rory Fox", kind: "pitcher", note: "RHP · AA", sportId: 12 },
];

export function currentSeason(now: Date = new Date()): number {
  const y = now.getUTCFullYear();
  return now.getUTCMonth() >= 3 ? y : y - 1;
}
