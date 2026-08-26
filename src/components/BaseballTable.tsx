import React, { useEffect, useMemo, useRef, useState } from "react";
import { AFFILIATES, WATCHLIST, YANKEES } from "../lib/mlb/config";
import {
  fipFrom,
  hitLine,
  pitchLine,
  prevWindowByBF,
  prevWindowByGames,
  prevWindowByPA,
  windowByAB,
  windowByBF,
  windowByGames,
  windowByPA,
} from "../lib/mlb/windows";
import type { HitLine, PitchLine } from "../lib/mlb/windows";

type PlayerLog = {
  id: number;
  name: string;
  pos?: string;
  kind?: string;
  note?: string;
  lastPlayed: number | null;
  games: number[][];
};
type Payload = { season: number; fetchedAt: string; players: PlayerLog[] };

type LeagueCtx = {
  name?: string;
  lgOBP?: number | null;
  lgSLG?: number | null;
  lgERA?: number | null;
  fipConst?: number | null;
};
type CtxPayload = { sports: Record<string, Record<string, LeagueCtx>> };

type OrgEntry = {
  id: number;
  name: string;
  pos: string;
  teamShort: string;
  kind: "hitter" | "pitcher";
  sportId: number;
  leagueId: number;
};

const DASH = "—";
const f3 = (x: number | null) => (x == null ? DASH : x.toFixed(3).replace(/^0\./, "."));
const f2 = (x: number | null) => (x == null ? DASH : x.toFixed(2));
const f1 = (x: number | null) => (x == null ? DASH : x.toFixed(1));
const pct = (x: number | null) => (x == null ? DASH : (x * 100).toFixed(1));
const pts = (d: number | null) => {
  if (d == null) return DASH;
  const v = Math.round(d * 1000);
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}.${String(Math.abs(v)).padStart(3, "0")}`;
};

function ymdToStr(ymd: number | null): string {
  if (!ymd) return "";
  const y = Math.floor(ymd / 10000);
  const m = String(Math.floor(ymd / 100) % 100).padStart(2, "0");
  const d = String(ymd % 100).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const STALE_DAYS = 21 * 24 * 60 * 60 * 1000;
const DELTA_MIN_SAMPLE = 15;

function usePayload<T>(url: string | null) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({
    loading: false,
  });
  useEffect(() => {
    if (!url) {
      setState({ loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fetch(url)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.message || j.error || `HTTP ${r.status}`);
        return j as T;
      })
      .then((d) => {
        if (alive) setState({ data: d, loading: false });
      })
      .catch((e) => {
        if (alive) setState({ error: String(e?.message || e), loading: false });
      });
    return () => {
      alive = false;
    };
  }, [url]);
  return state;
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 64;
  const h = 18;
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max === min) return null;
  const span = max - min;
  const step = w / (values.length - 1);
  const p = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="opacity-60">
      <polyline points={p} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

type Row = {
  id: number;
  name: string;
  pos: string;
  pin: boolean;
  pinNote: string;
  sid: number;
  leagueId: number;
  cur: HitLine | PitchLine;
  seasonLine: HitLine | PitchLine;
  viewGames: number[][];
  prevVal: number | null;
  delta: number | null;
  spark: number[];
  stale: boolean;
  lastPlayed: number | null;
  winGames: number[][];
};

type Col = {
  key: string;
  label: string;
  num: (r: Row) => number | null;
  fmt: (r: Row) => string;
  title?: (r: Row) => string;
  deltaGoodDir?: 1 | -1;
};

function splitLabel(code: "vl" | "vr", kind: "hitter" | "pitcher"): string {
  if (kind === "pitcher") return code === "vl" ? "vs LHB" : "vs RHB";
  return code === "vl" ? "vs LHP" : "vs RHP";
}

const GAMES_PRESETS = [7, 14, 30];
const PA_PRESETS = [20, 50, 100];

const cellCls = "px-1.5 py-1.5 text-right whitespace-nowrap tabular-nums";

function TableSkeleton({ labels, nameLabel }: { labels: string[]; nameLabel: string }) {
  return (
    <div className="overflow-x-auto bg-neutral-900 rounded border border-neutral-800 animate-pulse">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-neutral-500">
            <th className="text-left font-normal px-1.5 py-2 sticky left-0 bg-neutral-900 min-w-[140px]">{nameLabel}</th>
            {labels.map((l) => (
              <th key={l} className="font-normal px-1.5 py-2 text-right whitespace-nowrap">
                {l}
              </th>
            ))}
            <th className="font-normal px-1.5 py-2 text-right">Form</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 8 }).map((_, i) => (
            <tr key={i} className="border-t border-neutral-800">
              <td className="px-1.5 py-2 sticky left-0 bg-neutral-900">
                <div className="h-3 w-24 rounded bg-neutral-800" />
              </td>
              {labels.map((l) => (
                <td key={l} className={cellCls}>
                  <div className="h-3 w-8 ml-auto rounded bg-neutral-800" />
                </td>
              ))}
              <td className="px-1.5 py-2">
                <div className="h-3 w-16 ml-auto rounded bg-neutral-800" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function BaseballTable() {
  const [tab, setTab] = useState<"yanks" | "farm">("yanks");
  const [affId, setAffId] = useState(AFFILIATES[0].id);
  const [group, setGroup] = useState<"hitters" | "pitchers">("hitters");
  const [mode, setMode] = useState<"games" | "pa">("games");
  const [winVal, setWinVal] = useState(14);
  const [statScope, setStatScope] = useState<"form" | "season">("form");
  const [sortKey, setSortKey] = useState<string>("ops");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const presets = mode === "games" ? GAMES_PRESETS : PA_PRESETS;

  const activeDef = tab === "yanks" ? YANKEES : AFFILIATES.find((t) => t.id === affId)!;

  const teamUrl = `/api/mlb/team-log?teamId=${activeDef.id}&group=${group === "hitters" ? "hitting" : "pitching"}`;
  const watchUrl = tab === "farm" ? "/api/mlb/watchlist-log" : null;

  const ctxIds =
    tab === "farm"
      ? [...new Set([activeDef.sportId, ...WATCHLIST.map((w) => w.sportId)])].sort((a, b) => a - b)
      : [activeDef.sportId];
  const ctxUrl = `/api/mlb/league-context?sportIds=${ctxIds.join(",")}`;

  const team = usePayload<Payload>(teamUrl);
  const watch = usePayload<Payload>(watchUrl);
  const ctx = usePayload<CtxPayload>(ctxUrl);

  function leagueFor(sid: number, leagueId: number): LeagueCtx | undefined {
    return ctx.data?.sports?.[String(sid)]?.[String(leagueId)];
  }

  const rows: Row[] = useMemo(() => {
    const tp = team.data?.players ?? [];
    const wp = watch.data?.players ?? [];
    const wantedKind = group === "hitters" ? "hitter" : "pitcher";
    const pins = new Map(wp.filter((p) => (p.kind ?? "hitter") === wantedKind).map((p) => [p.id, p]));
    const ids = new Set(tp.map((p) => p.id));

    const merged: { player: PlayerLog; pin: boolean }[] = [
      ...tp.map((p) => ({ player: p, pin: pins.has(p.id) })),
      ...wp
        .filter((w) => (w.kind ?? "hitter") === wantedKind && !ids.has(w.id))
        .map((player) => ({ player, pin: true })),
    ];

    const now = Date.now();
    return merged.map(({ player, pin }) => {
      const g = player.games;
      let win: number[][];
      let prev: number[][];
      if (mode === "games") {
        win = windowByGames(g, winVal);
        prev = prevWindowByGames(g, winVal);
      } else if (group === "hitters") {
        win = windowByPA(g, winVal);
        prev = prevWindowByPA(g, winVal);
      } else {
        win = windowByBF(g, winVal);
        prev = prevWindowByBF(g, winVal);
      }

      let cur: HitLine | PitchLine;
      let seasonLine: HitLine | PitchLine;
      let delta: number | null = null;
      let prevVal: number | null = null;
      let spark: number[] = [];

      if (group === "hitters") {
        cur = hitLine(win);
        seasonLine = hitLine(g);
        const pl = hitLine(prev);
        prevVal = pl.ops;
        const okSample =
          (cur as HitLine).pa >= DELTA_MIN_SAMPLE &&
          (pl as HitLine).pa >= DELTA_MIN_SAMPLE;
        delta =
          okSample && cur.ops != null && pl.ops != null ? cur.ops - pl.ops : null;
        let h = 0,
          ab = 0,
          tb = 0,
          bb = 0,
          hbp = 0,
          sf = 0;
        spark = (statScope === "season" ? g : win).map((gm) => {
          ab += gm[2];
          h += gm[3];
          tb += gm[3] + gm[4] + 2 * gm[5] + 3 * gm[6];
          bb += gm[8];
          hbp += gm[9];
          sf += gm[12];
          const obpDen = ab + bb + hbp + sf;
          const obp = obpDen > 0 ? (h + bb + hbp) / obpDen : 0;
          const slg = ab > 0 ? tb / ab : 0;
          return obp + slg;
        });
      } else {
        cur = pitchLine(win);
        seasonLine = pitchLine(g);
        const pl = pitchLine(prev);
        prevVal = pl.era;
        const okSample =
          (cur as PitchLine).bf >= DELTA_MIN_SAMPLE &&
          (pl as PitchLine).bf >= DELTA_MIN_SAMPLE;
        delta =
          okSample && cur.era != null && pl.era != null ? cur.era - pl.era : null;
        let er = 0;
        let outs = 0;
        spark = (statScope === "season" ? g : win).map((gm) => {
          outs += gm[1];
          er += gm[4];
          return outs > 0 ? (er * 27) / outs : 0;
        });
      }

      const lpMs = player.lastPlayed ? Date.parse(ymdToStr(player.lastPlayed)) : 0;
      const stale = !lpMs || now - lpMs > STALE_DAYS;

      const wl = WATCHLIST.find((w) => w.id === player.id);
      const td = tab === "yanks" ? YANKEES : AFFILIATES.find((t) => t.id === affId)!;
      return {
        id: player.id,
        name: player.name,
        pos: player.pos ?? "",
        pin,
        pinNote: player.note ?? wl?.note ?? "",
        sid: wl ? wl.sportId : td.sportId,
        leagueId: wl ? wl.leagueId : td.leagueId,
        cur,
        seasonLine,
        viewGames: statScope === "season" ? player.games : win,
        prevVal,
        delta,
        spark,
        stale,
        lastPlayed: player.lastPlayed,
        winGames: win,
      };
    });
  }, [team.data, watch.data, group, mode, winVal, statScope, tab, affId]);

  const cols: Col[] = useMemo(() => {
    const viewLine = (r: Row): HitLine | PitchLine =>
      statScope === "season" ? r.seasonLine : r.cur;
    const deltaOps: Col = {
      key: "delta",
      label: "ΔOPS",
      num: (r) => r.delta,
      fmt: (r) => pts(r.delta),
      title: (r) => (r.prevVal != null ? `prev ${winVal}${mode === "games" ? "G" : "PA"}: ${f3(r.prevVal)} OPS` : ""),
      deltaGoodDir: 1,
    };
    const deltaEra: Col = {
      key: "delta",
      label: "ΔERA",
      num: (r) => r.delta,
      fmt: (r) => (r.delta == null ? DASH : (r.delta > 0 ? "+" : "") + r.delta.toFixed(2)),
      title: (r) => (r.prevVal != null ? `prev ${winVal}${mode === "games" ? "G" : "BF"}: ${f2(r.prevVal)} ERA` : ""),
      deltaGoodDir: -1,
    };
    if (group === "hitters") {
      const c: Col[] = [
        { key: "pa", label: "PA", num: (r) => (viewLine(r) as HitLine).pa, fmt: (r) => String((viewLine(r) as HitLine).pa) },
        { key: "hr", label: "HR", num: (r) => (viewLine(r) as HitLine).hr, fmt: (r) => String((viewLine(r) as HitLine).hr) },
        { key: "bbPct", label: "BB%", num: (r) => (viewLine(r) as HitLine).bbPct, fmt: (r) => pct((viewLine(r) as HitLine).bbPct) },
        { key: "kPct", label: "K%", num: (r) => (viewLine(r) as HitLine).kPct, fmt: (r) => pct((viewLine(r) as HitLine).kPct) },
        { key: "avg", label: "AVG", num: (r) => (viewLine(r) as HitLine).avg, fmt: (r) => f3((viewLine(r) as HitLine).avg) },
        { key: "obp", label: "OBP", num: (r) => (viewLine(r) as HitLine).obp, fmt: (r) => f3((viewLine(r) as HitLine).obp) },
        { key: "slg", label: "SLG", num: (r) => (viewLine(r) as HitLine).slg, fmt: (r) => f3((viewLine(r) as HitLine).slg) },
        { key: "ops", label: "OPS", num: (r) => (viewLine(r) as HitLine).ops, fmt: (r) => f3((viewLine(r) as HitLine).ops) },
        ...(statScope === "form" ? [deltaOps] : []),
        {
          key: "opsPlus",
          label: "OPS+",
          num: (r) => {
            const lg = leagueFor(r.sid, r.leagueId);
            const cur = viewLine(r) as HitLine;
            if (!lg?.lgOBP || !lg?.lgSLG || cur.obp == null || cur.slg == null) return null;
            return 100 * (cur.obp / lg.lgOBP + cur.slg / lg.lgSLG - 1);
          },
          fmt: (r) => {
            const lg = leagueFor(r.sid, r.leagueId);
            const cur = viewLine(r) as HitLine;
            if (!lg?.lgOBP || !lg?.lgSLG || cur.obp == null || cur.slg == null) return DASH;
            return String(Math.round(100 * (cur.obp / lg.lgOBP + cur.slg / lg.lgSLG - 1)));
          },
        },
        { key: "woba", label: "wOBA", num: (r) => (viewLine(r) as HitLine).woba, fmt: (r) => f3((viewLine(r) as HitLine).woba) },
      ];
      return c;
    }
    const c: Col[] = [
      { key: "ip", label: "IP", num: (r) => (viewLine(r) as PitchLine).outs, fmt: (r) => (viewLine(r) as PitchLine).ip },
      { key: "so", label: "SO", num: (r) => (viewLine(r) as PitchLine).so, fmt: (r) => String((viewLine(r) as PitchLine).so) },
      { key: "era", label: "ERA", num: (r) => (viewLine(r) as PitchLine).era, fmt: (r) => f2((viewLine(r) as PitchLine).era) },
      ...(statScope === "form" ? [deltaEra] : []),
      {
        key: "eraPlus",
        label: "ERA+",
        num: (r) => {
          const lg = leagueFor(r.sid, r.leagueId);
          const era = (viewLine(r) as PitchLine).era;
          if (!lg?.lgERA || era == null || era === 0) return null;
          return (100 * lg.lgERA) / era;
        },
        fmt: (r) => {
          const lg = leagueFor(r.sid, r.leagueId);
          const era = (viewLine(r) as PitchLine).era;
          if (!lg?.lgERA || era == null || era === 0) return DASH;
          return String(Math.round((100 * lg.lgERA) / era));
        },
      },
      {
        key: "fip",
        label: "FIP",
        num: (r) => {
          const lg = leagueFor(r.sid, r.leagueId);
          if (!lg?.fipConst) return null;
          return fipFrom(r.viewGames, lg.fipConst);
        },
        fmt: (r) => {
          const lg = leagueFor(r.sid, r.leagueId);
          if (!lg?.fipConst) return DASH;
          return f2(fipFrom(r.viewGames, lg.fipConst));
        },
      },
      { key: "whip", label: "WHIP", num: (r) => (viewLine(r) as PitchLine).whip, fmt: (r) => f2((viewLine(r) as PitchLine).whip) },
      { key: "k9", label: "K/9", num: (r) => (viewLine(r) as PitchLine).k9, fmt: (r) => f1((viewLine(r) as PitchLine).k9) },
    ];
    return c;
  }, [group, ctx.data, winVal, mode, statScope]);

  const sorted = useMemo(() => {
    const active = cols.find((c) => c.key === sortKey);
    if (!active) return rows;
    return [...rows].sort((a, b) => {
      if (a.pin !== b.pin) return a.pin ? -1 : 1;
      const av = active.num(a);
      const bv = active.num(b);
      if (av == null && bv == null) return a.name.localeCompare(b.name);
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * sortDir;
    });
  }, [rows, cols, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(-1);
    }
  }

  function rowTip(r: Row): string {
    const scopeLabel =
      statScope === "season"
        ? "season"
        : `${mode === "games" ? `last ${winVal} G` : `min ${winVal} ${group === "hitters" ? "PA" : "BF"}`}`;
    const wXbh = r.viewGames.reduce((a, gm) => a + gm[4] + gm[5] + gm[6], 0);
    if (group === "hitters") {
      const c = (statScope === "season" ? r.seasonLine : r.cur) as HitLine;
      return `${f3(c.avg)}/${f3(c.obp)}/${f3(c.slg)} · ${wXbh} XBH · ${c.sb} SB · ${c.rbi} RBI in ${c.g} G (${scopeLabel})`;
    }
    const c = (statScope === "season" ? r.seasonLine : r.cur) as PitchLine;
    return `${c.ip} IP · ${c.so} K · ${c.bb} BB · ${c.er} ER in ${c.g} G (${scopeLabel})`;
  }

  const [playerInput, setPlayerInput] = useState("");
  const [selected, setSelected] = useState<OrgEntry | null>(null);
  const [showSug, setShowSug] = useState(false);
  const [hiIdx, setHiIdx] = useState(0);
  const [abVal, setAbVal] = useState("");
  const [hand, setHand] = useState<"" | "vl" | "vr">("");
  const [orgIdx, setOrgIdx] = useState<OrgEntry[] | null>(null);
  const idxPromise = useRef<Promise<OrgEntry[]> | null>(null);
  const [qBusy, setQBusy] = useState(false);
  const [qError, setQError] = useState<string | null>(null);

  type ResultRow = {
    key: string;
    name: string;
    pos: string;
    teamShort: string;
    sid: number;
    leagueId: number;
    kind: "hitter" | "pitcher";
    label: string;
    note: string | null;
    line: HitLine | PitchLine;
    games: number[][];
  };
  const [results, setResults] = useState<ResultRow[]>([]);

  async function ensureIndex(): Promise<OrgEntry[]> {
    if (orgIdx) return orgIdx;
    if (!idxPromise.current) {
      idxPromise.current = fetch("/api/mlb/org-index")
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.message || j.error || `HTTP ${r.status}`);
          const players: OrgEntry[] = j.players ?? [];
          setOrgIdx(players);
          return players;
        })
        .finally(() => {
          idxPromise.current = null;
        });
    }
    try {
      return await idxPromise.current;
    } catch (e: any) {
      setQError(String(e?.message || e));
      return [];
    }
  }

  const suggestions = useMemo(() => {
    if (!orgIdx) return [];
    const q = playerInput.trim().toLowerCase();
    if (!q) return [];
    const starts: OrgEntry[] = [];
    const incl: OrgEntry[] = [];
    for (const p of orgIdx) {
      const n = p.name.toLowerCase();
      if (n.startsWith(q)) starts.push(p);
      else if (n.includes(q)) incl.push(p);
    }
    return [...starts, ...incl].slice(0, 8);
  }, [orgIdx, playerInput]);

  useEffect(() => {
    if (!showSug || suggestions.length === 0) setHiIdx(0);
  }, [showSug, suggestions.length]);

  function choosePlayer(p: OrgEntry) {
    setSelected(p);
    setPlayerInput(p.name);
    setShowSug(false);
    setQError(null);
  }

  async function runQuery() {
    if (!selected || qBusy) return;
    setQError(null);
    const rawAb = abVal.trim();
    let abN: number | null = null;
    if (rawAb !== "") {
      abN = Number(rawAb);
      if (!Number.isFinite(abN) || abN < 1) {
        setQError("enter a valid at-bat count");
        return;
      }
      abN = Math.floor(abN);
    }
    setQBusy(true);
    try {
      const grp = selected.kind === "pitcher" ? "pitching" : "hitting";
      const lr = await fetch(`/api/mlb/player-log?playerId=${selected.id}&group=${grp}&sportId=${selected.sportId}`).then((r) => r.json());
      let games: number[][] = lr.games ?? [];
      const labels: string[] = [];
      let note: string | null = null;

      if (hand) {
        const sr = await fetch(`/api/mlb/player-splits?playerId=${selected.id}&group=${grp}&sitCode=${hand}&sportId=${selected.sportId}`).then((r) => r.json());
        const agg = sr.games?.[0];
        if (!agg) {
          setQError("no handedness split data for that player");
          return;
        }
        games = [agg];
        labels.push(`season ${splitLabel(hand, selected.kind)}`);
        if (abN != null) note = "handedness splits are season aggregates — AB window ignored";
      } else {
        if (abN != null) {
          games = windowByAB(games, abN);
          labels.push(`last ${abN} AB`);
        }
        if (labels.length === 0) labels.push(`${lr.season} season`);
      }

      const line = grp === "pitching" ? pitchLine(games) : hitLine(games);
      const player = selected;

      setResults((prev) =>
        [
          {
            key: `${player.id}-${labels.join("-")}-${Date.now()}`,
            name: player.name,
            pos: player.pos,
            teamShort: player.teamShort,
            sid: player.sportId,
            leagueId: player.leagueId,
            kind: player.kind,
            label: labels.join(" · "),
            note,
            line,
            games,
          },
          ...prev,
        ].slice(0, 8)
      );
    } catch (e: any) {
      setQError(String(e?.message || e));
    } finally {
      setQBusy(false);
    }
  }

  const chip = (activeState: boolean) =>
    "text-xs px-3 py-1 rounded border transition-colors " +
    (activeState
      ? "text-neutral-100 border-neutral-600 bg-neutral-800"
      : "text-neutral-400 border-neutral-800 hover:text-neutral-200");

  const loading = team.loading || watch.loading;
  const error = team.error || watch.error;

  type RCol = {
    label: string;
    f: (line: any, rr: ResultRow) => string;
  };

  const resultCols = (kind: "hitter" | "pitcher"): RCol[] =>
    kind === "hitter"
      ? [
          { label: "G", f: (l) => String(l.g) },
          { label: "PA", f: (l) => String(l.pa) },
          { label: "HR", f: (l) => String(l.hr) },
          { label: "BB%", f: (l) => pct(l.bbPct) },
          { label: "K%", f: (l) => pct(l.kPct) },
          { label: "AVG", f: (l) => f3(l.avg) },
          { label: "OBP", f: (l) => f3(l.obp) },
          { label: "SLG", f: (l) => f3(l.slg) },
          { label: "OPS", f: (l) => f3(l.ops) },
          {
            label: "OPS+",
            f: (l, rr) => {
              const lg = leagueFor(rr.sid, rr.leagueId);
              if (!lg?.lgOBP || !lg?.lgSLG || l.obp == null || l.slg == null) return DASH;
              return String(Math.round(100 * (l.obp / lg.lgOBP + l.slg / lg.lgSLG - 1)));
            },
          },
          { label: "wOBA", f: (l) => f3(l.woba) },
        ]
      : [
          { label: "G", f: (l) => String(l.g) },
          { label: "IP", f: (l) => l.ip },
          { label: "SO", f: (l) => String(l.so) },
          { label: "ERA", f: (l) => f2(l.era) },
          {
            label: "ERA+",
            f: (l, rr) => {
              const lg = leagueFor(rr.sid, rr.leagueId);
              if (!lg?.lgERA || l.era == null || l.era === 0) return DASH;
              return String(Math.round((100 * lg.lgERA) / l.era));
            },
          },
          {
            label: "FIP",
            f: (l, rr) => {
              const lg = leagueFor(rr.sid, rr.leagueId);
              if (!lg?.fipConst) return DASH;
              return f2(fipFrom(rr.games, lg.fipConst));
            },
          },
          { label: "WHIP", f: (l) => f2(l.whip) },
          { label: "K/9", f: (l) => f1(l.k9) },
        ];

  function resultSection(kind: "hitter" | "pitcher") {
    const rowsOfKind = results.filter((r) => r.kind === kind);
    if (rowsOfKind.length === 0) return null;
    const colsR = resultCols(kind);
    return (
      <div key={kind} className="overflow-x-auto rounded border border-neutral-800 mt-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-neutral-500">
              <th className="text-left font-normal px-2 py-1.5 sticky left-0 bg-neutral-900">Query</th>
              {colsR.map((c) => (
                <th key={c.label} className="font-normal px-2 py-1.5 text-right whitespace-nowrap">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowsOfKind.map((rr) => (
              <tr key={rr.key} className="border-t border-neutral-800">
                <td className="px-2 py-1.5 whitespace-nowrap sticky left-0 bg-neutral-900">
                  <span className="text-neutral-200">{rr.name}</span>
                  <span className="text-neutral-600 ml-1">{rr.teamShort}</span>
                  <span className="block text-[10px] text-neutral-500 leading-none mt-0.5">{rr.label}</span>
                  {rr.note && (
                    <span className="block text-[10px] text-amber-600/80 leading-tight mt-0.5" title={rr.note}>
                      ⚠ season agg
                    </span>
                  )}
                </td>
                {colsR.map((c) => (
                  <td key={c.label} className={cellCls + " text-neutral-300"}>
                    {c.f(rr.line, rr)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button className={chip(tab === "yanks")} onClick={() => setTab("yanks")}>
          Yankees
        </button>
        <button className={chip(tab === "farm")} onClick={() => setTab("farm")}>
          Farm
        </button>
        {tab === "farm" && (
          <select
            value={affId}
            onChange={(e) => setAffId(Number(e.target.value))}
            className="bg-neutral-900 border border-neutral-800 rounded text-sm px-2 py-1 text-neutral-300"
          >
            {AFFILIATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="rounded border border-neutral-800 p-3 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <input
              value={playerInput}
              onChange={(e) => {
                setPlayerInput(e.target.value);
                setSelected(null);
                setShowSug(true);
                setHiIdx(0);
              }}
              onFocus={() => {
                ensureIndex();
                if (playerInput.trim()) setShowSug(true);
              }}
              onBlur={() => setShowSug(false)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (!showSug) setShowSug(true);
                  else setHiIdx((i) => Math.min(i + 1, suggestions.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHiIdx((i) => Math.max(i - 1, 0));
                } else if (e.key === "Escape") {
                  setShowSug(false);
                } else if (e.key === "Enter") {
                  if (showSug && suggestions[hiIdx]) choosePlayer(suggestions[hiIdx]);
                  else if (selected) runQuery();
                }
              }}
              placeholder="search player name…"
              className="w-full bg-transparent outline-none border-b border-subtle px-0 py-1 fg-secondary focus:text-neutral-200 text-sm"
            />
            {showSug && (
              <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded border border-neutral-800 bg-neutral-900 shadow-xl overflow-y-auto max-h-72">
                {!orgIdx && <div className="px-3 py-2 text-xs text-neutral-500">loading player index…</div>}
                {orgIdx && playerInput.trim() !== "" && suggestions.length === 0 && (
                  <div className="px-3 py-2 text-xs text-neutral-500">no matching players</div>
                )}
                {suggestions.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choosePlayer(p)}
                    onMouseEnter={() => setHiIdx(i)}
                    className={
                      "w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-sm " +
                      (i === hiIdx ? "bg-neutral-800 text-neutral-100" : "text-neutral-300")
                    }
                  >
                    <span>{p.name}</span>
                    <span className="text-[10px] text-neutral-500 whitespace-nowrap">
                      {p.pos} · {p.teamShort}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="w-px h-5 bg-neutral-800" />
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={abVal}
            onChange={(e) => setAbVal(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="45 AB's"
            disabled={!!hand}
            title={hand ? "handedness splits are season aggregates — AB window not applied" : "window: last N at-bats (blank = full season)"}
            className="w-20 bg-transparent outline-none border-b border-subtle px-1 py-1 fg-secondary focus:text-neutral-200 text-sm text-center placeholder:italic disabled:opacity-40"
          />
          <select
            value={hand}
            onChange={(e) => setHand(e.target.value as "" | "vl" | "vr")}
            className="bg-neutral-900 border border-neutral-800 rounded text-sm px-2 py-1 text-neutral-300"
          >
            <option value="">full season</option>
            <option value="vl">{selected ? splitLabel("vl", selected.kind) : "vs LHP / LHB"}</option>
            <option value="vr">{selected ? splitLabel("vr", selected.kind) : "vs RHP / RHB"}</option>
          </select>
          <button
            onClick={() => runQuery()}
            disabled={qBusy || !selected}
            aria-label="run query"
            title={selected ? "run query" : "pick a player from the search suggestions first"}
            className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500 text-neutral-200 disabled:opacity-50 disabled:hover:border-neutral-700"
          >
            {qBusy ? <span className="italic">…</span> : <span className="text-base leading-none">→</span>}
          </button>
          {results.length > 0 && (
            <button onClick={() => setResults([])} className="text-xs text-neutral-600 hover:text-neutral-400">
              clear
            </button>
          )}
        </div>

        {qError && <div className="text-xs text-red-400">{qError}</div>}

        {results.length > 0 && (
          <>
            {resultSection("hitter")}
            {resultSection("pitcher")}
          </>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button className={chip(group === "hitters")} onClick={() => { setGroup("hitters"); setSortKey("ops"); }}>
          Hitters
        </button>
        <button className={chip(group === "pitchers")} onClick={() => { setGroup("pitchers"); setSortKey("era"); }}>
          Pitchers
        </button>

        <span className="w-px h-5 bg-neutral-800" />

        <button
          className={chip(mode === "games")}
          onClick={() => {
            setMode("games");
            setWinVal(14);
          }}
        >
          last N games
        </button>
        <button
          className={chip(mode === "pa")}
          onClick={() => {
            setMode("pa");
            setWinVal(50);
          }}
        >
          min {group === "hitters" ? "PA" : "BF"}
        </button>

        <span className="flex items-center gap-1">
          {presets.map((v) => (
            <button key={v} className={chip(winVal === v)} onClick={() => setWinVal(v)}>
              {v}
            </button>
          ))}
        </span>

        <span className="w-px h-5 bg-neutral-800" />

        <button
          onClick={() => {
            const next = statScope === "season" ? "form" : "season";
            setStatScope(next);
            if (next === "season" && sortKey === "delta") {
              setSortKey(group === "hitters" ? "ops" : "era");
            }
          }}
          title="toggle full-season stats"
          className={
            "text-xs px-3 py-1 rounded border transition-colors " +
            (statScope === "season"
              ? "text-amber-300 border-amber-500/60 bg-neutral-800"
              : "text-neutral-400 border-neutral-800 hover:text-neutral-200")
          }
        >
          {statScope === "season" && <span className="text-amber-400 mr-1">●</span>}
          season
        </button>
      </div>

      {loading && (
        <TableSkeleton
          labels={cols.map((c) => c.label)}
          nameLabel={tab === "farm" ? "Prospect" : "Player"}
        />
      )}
      {!loading && error && <div className="text-sm text-red-400">{error}</div>}
      {!loading && !error && sorted.length === 0 && (
        <div className="text-sm text-neutral-500">No players found.</div>
      )}

      {!loading && !error && sorted.length > 0 && (
        <div className="overflow-x-auto bg-neutral-900 rounded border border-neutral-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-neutral-500">
                <th className="text-left font-normal px-1.5 py-2 sticky left-0 bg-neutral-900 min-w-[140px]">
                  {tab === "farm" ? "Prospect" : "Player"}
                </th>
                {cols.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={
                      "font-normal px-1.5 py-2 text-right cursor-pointer select-none hover:text-neutral-300 whitespace-nowrap " +
                      (sortKey === c.key ? "text-neutral-200" : "")
                    }
                  >
                    {c.label}
                    {sortKey === c.key ? (sortDir === -1 ? " ↓" : " ↑") : ""}
                  </th>
                ))}
                <th className="font-normal px-1.5 py-2 text-right">Form</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const tip = `${rowTip(r)}${r.stale ? `\nlast played ${ymdToStr(r.lastPlayed) || "n/a"}` : ""}`;
                return (
                  <tr
                    key={`${tab}-${r.id}`}
                    className="border-t border-neutral-800 hover:bg-neutral-800/40"
                  >
                    <td
                      className={
                        "px-1.5 py-1.5 whitespace-nowrap sticky left-0 bg-neutral-900 " +
                        (r.stale ? "text-neutral-600" : "text-neutral-200")
                      }
                      title={tip}
                    >
                      {r.pin && <span className="text-amber-500 mr-1" title={r.pinNote}>●</span>}
                      {r.name}
                      <span className="block text-[10px] text-neutral-600 leading-none mt-0.5">
                        {r.pos || (r.stale ? `last ${ymdToStr(r.lastPlayed) || "?"}` : "")}
                      </span>
                    </td>
                    {cols.map((c) => {
                      const raw = c.num(r);
                      let cls = cellCls;
                      if (c.key === "delta" && raw != null) {
                        const good = c.deltaGoodDir === 1 ? raw > 0 : raw < 0;
                        cls += good ? " text-emerald-400" : " text-red-400";
                      } else {
                        cls += " text-neutral-300";
                      }
                      const t = c.title?.(r);
                      return (
                        <td key={c.key} className={cls} title={t}>
                          {c.fmt(r)}
                        </td>
                      );
                    })}
                    <td className="px-1.5 py-1.5 text-right text-neutral-400">
                      <Spark values={r.spark} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {team.data && (
        <div className="text-xs text-neutral-600">
          {team.data.season} season · MLB Stats API · neutral-park OPS+/ERA+/FIP vs league context · fetched{" "}
          {new Date(team.data.fetchedAt).toLocaleTimeString()}
          {tab === "farm" && " · ● = prospect watchlist"}
        </div>
      )}
    </div>
  );
}
