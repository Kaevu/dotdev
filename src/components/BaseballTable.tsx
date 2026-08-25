import React, { useEffect, useMemo, useState } from "react";
import { AFFILIATES, YANKEES } from "../lib/mlb/config";
import {
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

const DASH = "—";
const f3 = (x: number | null) => (x == null ? DASH : x.toFixed(3).replace(/^0\./, "."));
const f2 = (x: number | null) => (x == null ? DASH : x.toFixed(2));
const f1 = (x: number | null) => (x == null ? DASH : x.toFixed(1));

function ymdToStr(ymd: number | null): string {
  if (!ymd) return "";
  const y = Math.floor(ymd / 10000);
  const m = String(Math.floor(ymd / 100) % 100).padStart(2, "0");
  const d = String(ymd % 100).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const STALE_DAYS = 21 * 24 * 60 * 60 * 1000;

function usePayload(url: string | null) {
  const [state, setState] = useState<{ data?: Payload; error?: string; loading: boolean }>({
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
        return j as Payload;
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
  if (max <= 0) return null;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="opacity-60">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

type Row = {
  player: PlayerLog;
  pin: boolean;
  cur: HitLine | PitchLine;
  delta: number | null;
  spark: number[];
  stale: boolean;
};

type Col = {
  key: string;
  label: string;
  num: (r: Row) => number | null;
  fmt: (r: Row) => string;
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

  const teamUrl =
    tab === "yanks"
      ? `/api/mlb/team-log?teamId=${YANKEES.id}&group=${group === "hitters" ? "hitting" : "pitching"}`
      : `/api/mlb/team-log?teamId=${affId}&group=${group === "hitters" ? "hitting" : "pitching"}`;
  const watchUrl = tab === "farm" ? "/api/mlb/watchlist-log" : null;

  const team = usePayload(teamUrl);
  const watch = usePayload(watchUrl);

  const apiGroup = group === "hitters" ? "hitting" : "pitching";

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
        win = windowByPA(g as number[][], winVal);
        prev = prevWindowByPA(g as number[][], winVal);
      } else {
        win = windowByBF(g as number[][], winVal);
        prev = prevWindowByBF(g as number[][], winVal);
      }

      let cur: HitLine | PitchLine;
      let delta: number | null = null;
      let spark: number[] = [];

      if (group === "hitters") {
        cur = hitLine(win as number[][]);
        const pl = hitLine(prev as number[][]);
        delta = cur.ops != null && pl.ops != null ? cur.ops - pl.ops : null;
        let h = 0, ab = 0, tb = 0, bb = 0, hbp = 0, sf = 0;
        spark = (win as number[][]).map((gm) => {
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
        cur = pitchLine(win as number[][]);
        const pl = pitchLine(prev as number[][]);
        delta = cur.era != null && pl.era != null ? cur.era - pl.era : null;
        spark = (win as number[][]).map((gm) => gm[6]);
      }

      const lpMs = player.lastPlayed ? Date.parse(ymdToStr(player.lastPlayed)) : 0;
      const stale = !lpMs || now - lpMs > STALE_DAYS;

      return { player, pin, cur, delta, spark, stale };
    });
  }, [team.data, watch.data, group, mode, winVal]);

  const cols: Col[] = useMemo(() => {
    if (group === "hitters") {
      const c: Col[] = [
        {
          key: "g", label: "G", num: (r) => r.cur.g, fmt: (r) => String(r.cur.g),
        },
        { key: "pa", label: "PA", num: (r) => (r.cur as HitLine).pa, fmt: (r) => String((r.cur as HitLine).pa) },
        { key: "h", label: "H", num: (r) => (r.cur as HitLine).h, fmt: (r) => String((r.cur as HitLine).h) },
        { key: "hr", label: "HR", num: (r) => (r.cur as HitLine).hr, fmt: (r) => String((r.cur as HitLine).hr) },
        { key: "rbi", label: "RBI", num: (r) => (r.cur as HitLine).rbi, fmt: (r) => String((r.cur as HitLine).rbi) },
        { key: "sb", label: "SB", num: (r) => (r.cur as HitLine).sb, fmt: (r) => String((r.cur as HitLine).sb) },
        { key: "bb", label: "BB%", num: (r) => (r.cur as HitLine).bbPct, fmt: (r) => f1((r.cur as HitLine).bbPct) },
        { key: "so", label: "K%", num: (r) => (r.cur as HitLine).kPct, fmt: (r) => f1((r.cur as HitLine).kPct) },
        { key: "avg", label: "AVG", num: (r) => (r.cur as HitLine).avg, fmt: (r) => f3((r.cur as HitLine).avg) },
        { key: "obp", label: "OBP", num: (r) => (r.cur as HitLine).obp, fmt: (r) => f3((r.cur as HitLine).obp) },
        { key: "slg", label: "SLG", num: (r) => (r.cur as HitLine).slg, fmt: (r) => f3((r.cur as HitLine).slg) },
        { key: "ops", label: "OPS", num: (r) => (r.cur as HitLine).ops, fmt: (r) => f3((r.cur as HitLine).ops) },
        {
          key: "delta",
          label: "ΔOPS",
          num: (r) => r.delta,
          fmt: (r) => (r.delta == null ? DASH : (r.delta > 0 ? "+" : "") + Math.round(r.delta * 1000)),
          deltaGoodDir: 1,
        },
      ];
      return c;
    }
    const c: Col[] = [
      { key: "g", label: "G", num: (r) => r.cur.g, fmt: (r) => String(r.cur.g) },
      { key: "ip", label: "IP", num: (r) => (r.cur as PitchLine).outs, fmt: (r) => (r.cur as PitchLine).ip },
      { key: "h", label: "H", num: (r) => (r.cur as PitchLine).h, fmt: (r) => String((r.cur as PitchLine).h) },
      { key: "er", label: "ER", num: (r) => (r.cur as PitchLine).er, fmt: (r) => String((r.cur as PitchLine).er) },
      { key: "bb", label: "BB", num: (r) => (r.cur as PitchLine).bb, fmt: (r) => String((r.cur as PitchLine).bb) },
      { key: "so", label: "SO", num: (r) => (r.cur as PitchLine).so, fmt: (r) => String((r.cur as PitchLine).so) },
      { key: "era", label: "ERA", num: (r) => (r.cur as PitchLine).era, fmt: (r) => f2((r.cur as PitchLine).era) },
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
  }, [group]);

  const sorted = useMemo(() => {
    const active = cols.find((c) => c.key === sortKey);
    if (!active) return rows;
    return [...rows].sort((a, b) => {
      if (a.pin !== b.pin) return a.pin ? -1 : 1;
      const av = active.num(a);
      const bv = active.num(b);
      if (av == null && bv == null) return a.player.name.localeCompare(b.player.name);
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
  const meta = team.data;

  const chip = (activeState: boolean) =>
    "text-xs px-3 py-1 rounded border transition-colors " +
    (activeState
      ? "text-neutral-100 border-neutral-600 bg-neutral-800"
      : "text-neutral-400 border-neutral-800 hover:text-neutral-200");

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
          <table className="w-full text-sm">
            <thead>
              <tr className="text-neutral-500 text-xs">
                <th className="text-left font-normal px-3 py-2 sticky left-0 bg-neutral-900">
                  {tab === "farm" ? "Prospect" : "Player"}
                </th>
                {group === "hitters" && (
                  <th className="font-normal px-2 py-2 text-left">Pos</th>
                )}
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
                <th className="font-normal px-3 py-2 text-right">Form</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={`${tab}-${r.player.id}`}
                  className="border-t border-neutral-800 hover:bg-neutral-800/40"
                >
                  <td
                    className={
                      "px-3 py-2 whitespace-nowrap sticky left-0 bg-neutral-900 " +
                      (r.stale ? "text-neutral-600" : "text-neutral-200")
                    }
                    title={r.stale ? `last played ${ymdToStr(r.player.lastPlayed) || "n/a"}` : r.player.name}
                  >
                    {r.pin && <span className="text-amber-500 mr-1" title={r.player.note}>●</span>}
                    {r.player.name}
                    {r.stale && <span className="text-neutral-600 text-xs ml-1">(IL/off)</span>}
                  </td>
                  {group === "hitters" && (
                    <td className="px-2 py-2 text-neutral-500">{r.player.pos}</td>
                  )}
                  {cols.map((c) => {
                    const raw = c.key === "delta" ? r.delta : c.num(r);
                    let cls = "px-2 py-2 text-right whitespace-nowrap ";
                    if (c.key === "delta" && raw != null) {
                      const good = c.deltaGoodDir === 1 ? (raw as number) > 0 : (raw as number) < 0;
                      cls += good ? "text-emerald-400" : "text-red-400";
                    } else {
                      cls += "text-neutral-300";
                    }
                    return (
                      <td key={c.key} className={cls}>
                        {c.fmt(r)}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right text-neutral-400">
                    <Spark values={r.spark} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && (
        <div className="text-xs text-neutral-600">
          {meta.season} season · MLB Stats API · fetched{" "}
          {new Date(meta.fetchedAt).toLocaleTimeString()}
          {tab === "farm" && " · ● = prospect watchlist"}
        </div>
      )}
    </div>
  );
}
