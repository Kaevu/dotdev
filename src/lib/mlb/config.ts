export type TeamDef = {
  id: number;
  short: string;
  label: string;
  sportId: number;
  leagueId: number;
};

export const YANKEES: TeamDef = {
  id: 147,
  short: "Yankees",
  label: "New York Yankees",
  sportId: 1,
  leagueId: 103,
};

export const AFFILIATES: TeamDef[] = [
  { id: 531, short: "RailRiders", label: "AAA · Scranton/Wilkes-Barre RailRiders", sportId: 11, leagueId: 117 },
  { id: 1956, short: "Somerset", label: "AA · Somerset Patriots", sportId: 12, leagueId: 113 },
  { id: 537, short: "Hudson Valley", label: "A+ · Hudson Valley Renegades", sportId: 13, leagueId: 116 },
  { id: 587, short: "Tarpons", label: "A · Tampa Tarpons", sportId: 14, leagueId: 123 },
  { id: 475, short: "FCL Yankees", label: "Rookie · FCL Yankees", sportId: 16, leagueId: 124 },
];

export const KNOWN_TEAM_IDS = new Set<number>([YANKEES.id, ...AFFILIATES.map((t) => t.id)]);

export function teamDef(teamId: number): TeamDef | undefined {
  if (teamId === YANKEES.id) return YANKEES;
  return AFFILIATES.find((t) => t.id === teamId);
}

export function sportIdForTeam(teamId: number): number {
  return teamDef(teamId)?.sportId ?? 1;
}

export type WatchEntry = {
  id: number;
  name: string;
  kind: "hitter" | "pitcher";
  note: string;
  sportId: number;
  leagueId: number;
};

export const WATCHLIST: WatchEntry[] = [
  { id: 828076, name: "Dax Kilby", kind: "hitter", note: "SS · A", sportId: 14, leagueId: 123 },
  { id: 695684, name: "Elmer Rodríguez", kind: "pitcher", note: "RHP · AAA", sportId: 11, leagueId: 117 },
  { id: 801739, name: "Carlos Lagrange", kind: "pitcher", note: "RHP · AAA", sportId: 11, leagueId: 117 },
  { id: 806059, name: "Hunter Dietz", kind: "pitcher", note: "LHP · RK", sportId: 16, leagueId: 124 },
  { id: 696292, name: "Ben Hess", kind: "pitcher", note: "RHP · AA", sportId: 12, leagueId: 113 },
  { id: 695765, name: "Thatcher Hurd", kind: "pitcher", note: "RHP · A", sportId: 14, leagueId: 123 },
  { id: 701480, name: "Bryce Cunningham", kind: "pitcher", note: "RHP · A+", sportId: 13, leagueId: 116 },
  { id: 812431, name: "Rory Fox", kind: "pitcher", note: "RHP · AA", sportId: 12, leagueId: 113 },
];

export function currentSeason(now: Date = new Date()): number {
  const y = now.getUTCFullYear();
  return now.getUTCMonth() >= 3 ? y : y - 1;
}

export const MLB_TEAM_IDS: Record<string, number> = {
  athletics: 133,
  "pittsburgh pirates": 134,
  "san diego padres": 135,
  "seattle mariners": 136,
  "san francisco giants": 137,
  "st. louis cardinals": 138,
  "tampa bay rays": 139,
  "texas rangers": 140,
  "toronto blue jays": 141,
  "minnesota twins": 142,
  "philadelphia phillies": 143,
  "atlanta braves": 144,
  "chicago white sox": 145,
  "miami marlins": 146,
  "new york yankees": 147,
  "milwaukee brewers": 158,
  "los angeles angels": 108,
  "arizona diamondbacks": 109,
  "baltimore orioles": 110,
  "boston red sox": 111,
  "chicago cubs": 112,
  "cincinnati reds": 113,
  "cleveland guardians": 114,
  "colorado rockies": 115,
  "detroit tigers": 116,
  "houston astros": 117,
  "kansas city royals": 118,
  "los angeles dodgers": 119,
  "washington nationals": 120,
  "new york mets": 121,
};

export const MLB_TEAM_ALIASES: Record<string, string> = {
  yankees: "new york yankees",
  orioles: "baltimore orioles",
  "red sox": "boston red sox",
  rays: "tampa bay rays",
  "blue jays": "toronto blue jays",
  guardians: "cleveland guardians",
  royals: "kansas city royals",
  tigers: "detroit tigers",
  twins: "minnesota twins",
  "white sox": "chicago white sox",
  astros: "houston astros",
  angels: "los angeles angels",
  mariners: "seattle mariners",
  rangers: "texas rangers",
  braves: "atlanta braves",
  marlins: "miami marlins",
  mets: "new york mets",
  phillies: "philadelphia phillies",
  nationals: "washington nationals",
  cubs: "chicago cubs",
  reds: "cincinnati reds",
  brewers: "milwaukee brewers",
  cardinals: "st. louis cardinals",
  pirates: "pittsburgh pirates",
  "diamondbacks": "arizona diamondbacks",
  rockies: "colorado rockies",
  "padres": "san diego padres",
  dodgers: "los angeles dodgers",
  giants: "san francisco giants",
};
