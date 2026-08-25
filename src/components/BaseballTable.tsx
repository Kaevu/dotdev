import React, { useEffect, useMemo, useState } from "react";
import { AFFILIATES, WATCHLIST, YANKEES } from "../lib/mlb/config";
import {
  fipFrom,
  hitLine,
  pitchLine,
  prevWindowByBF,
  prevWindowByGames,
  prevWindowByPA,
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
  cur: HitLine | PitchLine;
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
  fmt: (r: Row, ctx?: LeagueCtx) => string;
  deltaGoodDir?: 1 | -1;
};

const GAMES_PRESETS = [7, 14, 30];
const PA_PRESETS = [20, 50, 100];

export default function BaseballTable() {
  const [tab, setTab] = useState<"yanks" | "farm">("yanks");
  const [affId, setAffId] = useState(AFFILIATES[0].id);
  const [group, setGroup] = useState<"hitters" | "pitchers">("hitters");
  const [mode, setMode] = useState<"games" | "pa">("games");
  const [winVal, setWinVal] = useState(14);
  const [sortKey, setSortKey] = useState<string>("ops");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const presets = mode === "games" ? GAMES_PRESETS : PA_PRESETS;

  const teamId = tab === "yanks" ? YANKEES.id : affId;
  const teamSportId =
    tab === "yanks" ? YANKEES.sportId : AFFILIATES.find((t) => t.id === affId)?.sportId ?? 1;

  const teamUrl = `/api/mlb/team-log?teamId=${teamId}&group=${group === "hitters" ? "hitting" : "pitching"}`;
  const watchUrl = tab === "farm" ? "/api/mlb/watchlist-log" : null;

  const ctxIds =
    tab === "farm"
      ? [...new Set([teamSportId, ...WATCHLIST.map((w) => w.sportId)])].sort((a, b) => a - b)
      : [teamSportId];
  const ctxUrl = `/api/mlb/league-context?sportIds=${ctxIds.join(",")}`;

  const team = usePayload<Payload>(teamUrl);
  const watch = usePayload<Payload>(watchUrl);
  const ctx = usePayload<CtxPayload>(ctxUrl);

  function leagueFor(r: Row): LeagueCtx | undefined {
    return ctx.data?.sports?.[String(r.sid)];
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
      let delta: number | null = null;
      let spark: number[] = [];

      if (group === "hitters") {
        cur = hitLine(win);
        const pl = hitLine(prev);
        delta = cur.ops != null && pl.ops != null ? cur.ops - pl.ops : null;
        let h = 0,
          ab = 0,
          tb = 0,
          bb = 0,
          hbp = 0,
          sf = 0;
        spark = win.map((gm) => {
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
        const pl = pitchLine(prev);
        delta = cur.era != null && pl.era != null ? cur.era - pl.era : null;
        let er = 0;
        let outs = 0;
        spark = win.map((gm) => {
          outs += gm[1];
          er += gm[4];
          return outs > 0 ? (er * 27) / outs : 0;
        });
      }

      const lpMs = player.lastPlayed ? Date.parse(ymdToStr(player.lastPlayed)) : 0;
      const stale = !lpMs || now - lpMs > STALE_DAYS;

      const wl = WATCHLIST.find((w) => w.id === player.id);
      return {
        id: player.id,
        name: player.name,
        pos: player.pos ?? "",
        pin,
        pinNote: player.note ?? wl?.note ?? "",
        sid: wl ? wl.sportId : teamSportId,
        cur,
        delta,
        spark,
        stale,
        lastPlayed: player.lastPlayed,
        winGames: win,
      };
    });
  }, [team.data, watch.data, group, mode, winVal, teamSportId]);

  const cols: Col[] = useMemo(() => {
    if (group === "hitters") {
      const c: Col[] = [
        { key: "pa", label: "PA", num: (r) => (r.cur as HitLine).pa, fmt: (r) => String((r.cur as HitLine).pa) },
        { key: "hr", label: "HR", num: (r) => (r.cur as HitLine).hr, fmt: (r) => String((r.cur as HitLine).hr) },
        { key: "bbPct", label: "BB%", num: (r) => (r.cur as HitLine).bbPct, fmt: (r) => pct((r.cur as HitLine).bbPct) },
        { key: "kPct", label: "K%", num: (r) => (r.cur as HitLine).kPct, fmt: (r) => pct((r.cur as HitLine).kPct) },
        { key: "avg", label: "AVG", num: (r) => (r.cur as HitLine).avg, fmt: (r) => f3((r.cur as HitLine).avg) },
        { key: "obp", label: "OBP", num: (r) => (r.cur as HitLine).obp, fmt: (r) => f3((r.cur as HitLine).obp) },
        { key: "slg", label: "SLG", num: (r) => (r.cur as HitLine).slg, fmt: (r) => f3((r.cur as HitLine).slg) },
        { key: "ops", label: "OPS", num: (r) => (r.cur as HitLine).ops, fmt: (r) => f3((r.cur as HitLine).ops) },
        {
          key: "opsPlus",
          label: "OPS+",
          num: (r) => {
            const lg = leagueFor(r);
            const cur = r.cur as HitLine;
            if (!lg?.lgOBP || !lg?.lgSLG || cur.obp == null || cur.slg == null) return null;
            return 100 * (cur.obp / lg.lgOBP + cur.slg / lg.lgSLG - 1);
          },
          fmt: (r) => {
            const lg = leagueFor(r);
            const cur = r.cur as HitLine;
            if (!lg?.lgOBP || !lg?.lgSLG || cur.obp == null || cur.slg == null) return DASH;
            return String(Math.round(100 * (cur.obp / lg.lgOBP + cur.slg / lg.lgSLG - 1)));
          },
        },
        { key: "woba", label: "wOBA", num: (r) => (r.cur as HitLine).woba, fmt: (r) => f3((r.cur as HitLine).woba) },
        {
          key: "delta",
          label: "ΔOPS",
          num: (r) => r.delta,
          fmt: (r) => pts(r.delta),
          deltaGoodDir: 1,
        },
      ];
      return c;
    }
    const c: Col[] = [
      { key: "ip", label: "IP", num: (r) => (r.cur as PitchLine).outs, fmt: (r) => (r.cur as PitchLine).ip },
      { key: "so", label: "SO", num: (r) => (r.cur as PitchLine).so, fmt: (r) => String((r.cur as PitchLine).so) },
      { key: "era", label: "ERA", num: (r) => (r.cur as PitchLine).era, fmt: (r) => f2((r.cur as PitchLine).era) },
      {
        key: "eraPlus",
        label: "ERA+",
        num: (r) => {
          const lg = leagueFor(r);
          const era = (r.cur as PitchLine).era;
          if (!lg?.lgERA || era == null || era === 0) return null;
          return (100 * lg.lgERA) / era;
        },
        fmt: (r) => {
          const lg = leagueFor(r);
          const era = (r.cur as PitchLine).era;
          if (!lg?.lgERA || era == null || era === 0) return DASH;
          return String(Math.round((100 * lg.lgERA) / era));
        },
      },
      {
        key: "fip",
        label: "FIP",
        num: (r) => {
          const lg = leagueFor(r);
          if (!lg?.fipConst) return null;
          return fipFrom(r.winGames, lg.fipConst);
        },
        fmt: (r) => {
          const lg = leagueFor(r);
          if (!lg?.fipConst) return DASH;
          return f2(fipFrom(r.winGames, lg.fipConst));
        },
      },
      { key: "whip", label: "WHIP", num: (r) => (r.cur as PitchLine).whip, fmt: (r) => f2((r.cur as PitchLine).whip) },
      { key: "k9", label: "K/9", num: (r) => (r.cur as PitchLine).k9, fmt: (r) => f1((r.cur as PitchLine).k9) },
      {
        key: "delta",
        label: "ΔERA",
        num: (r) => r.delta,
        fmt: (r) => (r.delta == null ? DASH : (r.delta > 0 ? "+" : "") + r.delta.toFixed(2)),
        deltaGoodDir: -1,
      },
    ];
    return c;
  }, [group, ctx.data]);

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

  const loading = team.loading || watch.loading;
  const error = team.error || watch.error;

  const chip = (activeState: boolean) =>
    "text-xs px-3 py-1 rounded border transition-colors " +
    (activeState
      ? "text-neutral-100 border-neutral-600 bg-neutral-800"
      : "text-neutral-400 border-neutral-800 hover:text-neutral-200");

  const cellCls = "px-2 py-1.5 text-right whitespace-nowrap tabular-nums";

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
      </div>

      {loading && <div className="text-sm text-neutral-500">Loading stats…</div>}
      {!loading && error && <div className="text-sm text-red-400">{error}</div>}
      {!loading && !error && sorted.length === 0 && (
        <div className="text-sm text-neutral-500">No players found.</div>
      )}

      {!loading && !error && sorted.length > 0 && (
        <div className="overflow-x-auto bg-neutral-900 rounded border border-neutral-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-neutral-500">
                <th className="text-left font-normal px-2 py-2 sticky left-0 bg-neutral-900 min-w-[140px]">
                  {tab === "farm" ? "Prospect" : "Player"}
                </th>
                {cols.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={
                      "font-normal px-2 py-2 text-right cursor-pointer select-none hover:text-neutral-300 whitespace-nowrap " +
                      (sortKey === c.key ? "text-neutral-200" : "")
                    }
                  >
                    {c.label}
                    {sortKey === c.key ? (sortDir === -1 ? " ↓" : " ↑") : ""}
                  </th>
                ))}
                <th className="font-normal px-2 py-2 text-right">Form</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const hl = r.cur as HitLine;
                const tip =
                  group === "hitters"
                    ? `${r.name} · ${hl.g} G · ${hl.ab}/${hl.h} · ${hl.rbi} RBI · ${hl.sb} SB`
                    : `${r.name} · ${r.cur.g} G`;
                return (
                  <tr
                    key={`${tab}-${r.id}`}
                    className="border-t border-neutral-800 hover:bg-neutral-800/40"
                  >
                    <td
                      className={
                        "px-2 py-1.5 whitespace-nowrap sticky left-0 bg-neutral-900 " +
                        (r.stale ? "text-neutral-600" : "text-neutral-200")
                      }
                      title={r.stale ? `${tip} · last played ${ymdToStr(r.lastPlayed) || "n/a"}` : tip}
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
                      return (
                        <td key={c.key} className={cls}>
                          {c.fmt(r)}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-right text-neutral-400">
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
