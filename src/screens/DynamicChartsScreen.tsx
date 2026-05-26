/**
 * DynamicChartsScreen — customisable multi-metric line chart
 * Users pick any combination of indicators; historical + analyst forecasts overlaid.
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Dimensions,
  ActivityIndicator,
} from 'react-native';
import Svg, { Line, Text as SvgText, Path, Circle, G, Rect } from 'react-native-svg';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { FinancialPeriod, getFinancials } from '../services/api';

type Props = NativeStackScreenProps<RootStackParamList, 'DynamicCharts'>;

const W = Dimensions.get('window').width;
const CHART_W = W - 32;
const CHART_H = 250;
const LP = 52;   // left pad ($ axis)
const RP = 52;   // right pad (% / × axis)
const TP = 18;
const BP = 42;
const DRAW_W = CHART_W - LP - RP;
const DRAW_H = CHART_H - TP - BP;
const N_TICKS = 4;
const PAGE_BG = '#111417';
const SURFACE = '#1b2023';
const SURFACE_ALT = '#23282d';
const BORDER = '#303841';
const TEXT_MUTED = '#8f99aa';
const TEXT_SECONDARY = '#c3cad5';

const FMP_KEY = 'YluwKMMsNomEfMhv3H0FaPI73VGAVPSg';

// ─── Formatters ──────────────────────────────────────────────────────────────
const fmtM = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e12) return `${s}${(a / 1e12).toFixed(1)}T`;
  if (a >= 1e9)  return `${s}${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6)  return `${s}${(a / 1e6).toFixed(0)}M`;
  return `${s}${a.toFixed(0)}`;
};
const fmtPct = (v: number) => `${(v * 100).toFixed(0)}%`;
const fmtX   = (v: number) => `${v.toFixed(1)}x`;
const fmtEps = (v: number) => `$${v.toFixed(2)}`;
const fmtGro = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;

// ─── Metric definitions ───────────────────────────────────────────────────────
type Axis = 'L' | 'R';      // left = dollar, right = pct / ratio
type Group = 'Income' | 'Growth' | 'Cash Flow' | 'Balance' | 'Ratios';

type MetricDef = {
  key: string;
  label: string;
  color: string;
  axis: Axis;
  fmt: (v: number) => string;
  compute: (p: FinancialPeriod) => number | null;
  /** Optional: derives ALL values from the full periods array (e.g. YoY growth rates) */
  computeAll?: (periods: FinancialPeriod[]) => (number | null)[];
  group: Group;
  forecastKey?: 'revenue' | 'netIncome' | 'eps' | 'ebitda';  // links to analyst estimate
};

const METRICS: MetricDef[] = [
  // ── Income ────────────────────────────────────────────────────────────────
  { key: 'revenue',   label: 'Revenue',      color: '#3b82f6', axis: 'L', fmt: fmtM,   compute: p => p.revenue,        group: 'Income', forecastKey: 'revenue' },
  { key: 'earnings',  label: 'Earnings',     color: '#14b8a6', axis: 'L', fmt: fmtM,   compute: p => p.netIncome,      group: 'Income', forecastKey: 'netIncome' },
  { key: 'ebitda',    label: 'EBITDA',       color: '#a78bfa', axis: 'L', fmt: fmtM,   compute: p => p.ebitda ?? (p.operatingIncome != null && p.dAndA != null ? p.operatingIncome + p.dAndA : null), group: 'Income', forecastKey: 'ebitda' },
  { key: 'eps',       label: 'EPS',          color: '#fbbf24', axis: 'R', fmt: fmtEps, compute: p => p.epsDiluted,     group: 'Income', forecastKey: 'eps' },
  { key: 'grossMgn',  label: 'Gross Margin', color: '#22d3ee', axis: 'R', fmt: fmtPct, compute: p => p.revenue && p.grossProfit != null ? p.grossProfit / p.revenue : null, group: 'Income' },
  { key: 'opMgn',     label: 'Op. Margin',   color: '#fb923c', axis: 'R', fmt: fmtPct, compute: p => p.revenue && p.operatingIncome != null ? p.operatingIncome / p.revenue : null, group: 'Income' },
  { key: 'netMgn',    label: 'Net Margin',   color: '#f472b6', axis: 'R', fmt: fmtPct, compute: p => p.revenue && p.netIncome != null ? p.netIncome / p.revenue : null, group: 'Income' },
  { key: 'ebitdaMgn', label: 'EBITDA Margin',color: '#c084fc', axis: 'R', fmt: fmtPct, compute: p => p.revenue && p.ebitda != null ? p.ebitda / p.revenue : null, group: 'Income' },
  { key: 'rdRev',     label: 'R&D / Revenue',color: '#67e8f9', axis: 'R', fmt: fmtPct, compute: p => p.revenue && p.rAndD != null ? p.rAndD / p.revenue : null, group: 'Income' },
  { key: 'sbcRev',    label: 'SBC / Revenue',color: '#fb7185', axis: 'R', fmt: fmtPct, compute: p => p.revenue && p.sbc != null ? p.sbc / p.revenue : null, group: 'Income' },
  // ── Growth YoY ────────────────────────────────────────────────────────────
  { key: 'revGro',    label: 'Revenue YoY',  color: '#60a5fa', axis: 'R', fmt: fmtGro, compute: () => null,
    computeAll: ps => ps.map((p, i) => { const pr = ps[i - 1]; return pr?.revenue && pr.revenue !== 0 && p.revenue != null ? ((p.revenue - pr.revenue) / Math.abs(pr.revenue)) * 100 : null; }), group: 'Growth' },
  { key: 'earGro',    label: 'Earnings YoY', color: '#2dd4bf', axis: 'R', fmt: fmtGro, compute: () => null,
    computeAll: ps => ps.map((p, i) => { const pr = ps[i - 1]; return pr?.netIncome != null && pr.netIncome !== 0 && p.netIncome != null ? ((p.netIncome - pr.netIncome) / Math.abs(pr.netIncome)) * 100 : null; }), group: 'Growth' },
  { key: 'epsGro',    label: 'EPS YoY',      color: '#fcd34d', axis: 'R', fmt: fmtGro, compute: () => null,
    computeAll: ps => ps.map((p, i) => { const pr = ps[i - 1]; return pr?.epsDiluted != null && pr.epsDiluted !== 0 && p.epsDiluted != null ? ((p.epsDiluted - pr.epsDiluted) / Math.abs(pr.epsDiluted)) * 100 : null; }), group: 'Growth' },
  { key: 'fcfGro',    label: 'FCF YoY',      color: '#d97706', axis: 'R', fmt: fmtGro, compute: () => null,
    computeAll: ps => ps.map((p, i) => { const _f = (x: FinancialPeriod) => x.operatingCF != null && x.capex != null ? x.operatingCF - x.capex : null; const cur = _f(p); const prev = ps[i - 1] ? _f(ps[i - 1]) : null; return prev != null && prev !== 0 && cur != null ? ((cur - prev) / Math.abs(prev)) * 100 : null; }), group: 'Growth' },
  { key: 'ebitdaGro', label: 'EBITDA YoY',   color: '#7c3aed', axis: 'R', fmt: fmtGro, compute: () => null,
    computeAll: ps => ps.map((p, i) => { const pr = ps[i - 1]; return pr?.ebitda != null && pr.ebitda !== 0 && p.ebitda != null ? ((p.ebitda - pr.ebitda) / Math.abs(pr.ebitda)) * 100 : null; }), group: 'Growth' },
  // ── Cash Flow ─────────────────────────────────────────────────────────────
  { key: 'fcf',       label: 'FCF',          color: '#f59e0b', axis: 'L', fmt: fmtM,   compute: p => p.operatingCF != null && p.capex != null ? p.operatingCF - p.capex : null, group: 'Cash Flow' },
  { key: 'opCF',      label: 'Op. CF',       color: '#6366f1', axis: 'L', fmt: fmtM,   compute: p => p.operatingCF,    group: 'Cash Flow' },
  { key: 'capex',     label: 'Capex',        color: '#dc2626', axis: 'L', fmt: fmtM,   compute: p => p.capex,          group: 'Cash Flow' },
  { key: 'danda',     label: 'D&A',          color: '#9ca3af', axis: 'L', fmt: fmtM,   compute: p => p.dAndA,          group: 'Cash Flow' },
  { key: 'buybacks',  label: 'Buybacks',     color: '#f97316', axis: 'L', fmt: fmtM,   compute: p => p.buybacks,       group: 'Cash Flow' },
  { key: 'fcfMgn',    label: 'FCF Margin',   color: '#fde06a', axis: 'R', fmt: fmtPct, compute: p => { const f = p.operatingCF != null && p.capex != null ? p.operatingCF - p.capex : null; return p.revenue && f != null ? f / p.revenue : null; }, group: 'Cash Flow' },
  { key: 'capexRev',  label: 'Capex/Revenue',color: '#fca5a5', axis: 'R', fmt: fmtPct, compute: p => p.revenue && p.capex != null ? Math.abs(p.capex) / p.revenue : null, group: 'Cash Flow' },
  // ── Balance ───────────────────────────────────────────────────────────────
  { key: 'totalDebt', label: 'Total Debt',   color: '#ef4444', axis: 'L', fmt: fmtM,   compute: p => { const d = (p.shortTermDebt ?? 0) + (p.longTermDebt ?? 0); return d > 0 ? d : p.longTermDebt; }, group: 'Balance' },
  { key: 'netDebt',   label: 'Net Debt',     color: '#f87171', axis: 'L', fmt: fmtM,   compute: p => p.netDebt,        group: 'Balance' },
  { key: 'equity',    label: 'Equity',       color: '#34d399', axis: 'L', fmt: fmtM,   compute: p => p.equity,         group: 'Balance' },
  { key: 'cashAbs',   label: 'Cash',         color: '#4ade80', axis: 'L', fmt: fmtM,   compute: p => p.cash,           group: 'Balance' },
  { key: 'totAssets', label: 'Total Assets', color: '#94a3b8', axis: 'L', fmt: fmtM,   compute: p => p.totalAssets,    group: 'Balance' },
  { key: 'retEarn',   label: 'Retained Earn.',color: '#6ee7b7',axis: 'L', fmt: fmtM,   compute: p => p.retainedEarnings, group: 'Balance' },
  // ── Ratios / Returns ──────────────────────────────────────────────────────
  { key: 'roe',       label: 'ROE',          color: '#a3e635', axis: 'R', fmt: fmtPct, compute: p => p.equity && p.equity !== 0 && p.netIncome != null ? p.netIncome / p.equity : null, group: 'Ratios' },
  { key: 'roa',       label: 'ROA',          color: '#0891b2', axis: 'R', fmt: fmtPct, compute: p => p.totalAssets && p.totalAssets > 0 && p.netIncome != null ? p.netIncome / p.totalAssets : null, group: 'Ratios' },
  { key: 'roic',      label: 'ROIC',         color: '#86efac', axis: 'R', fmt: fmtPct, compute: p => {
    if (p.operatingIncome == null) return null;
    const ic = (p.equity ?? 0) + (p.longTermDebt ?? 0);
    return ic > 0 ? (p.operatingIncome * 0.79) / ic : null;
  }, group: 'Ratios' },
  { key: 'dByE',      label: 'Debt/Equity',  color: '#f43f5e', axis: 'R', fmt: fmtX,   compute: p => {
    const d = (p.shortTermDebt ?? 0) + (p.longTermDebt ?? 0);
    return p.equity && p.equity !== 0 ? d / p.equity : null;
  }, group: 'Ratios' },
  { key: 'dByFCF',    label: 'Debt/FCF',     color: '#ec4899', axis: 'R', fmt: fmtX,   compute: p => {
    const d = (p.shortTermDebt ?? 0) + (p.longTermDebt ?? 0);
    const f = p.operatingCF != null && p.capex != null ? p.operatingCF - p.capex : null;
    return f != null && f !== 0 ? d / f : null;
  }, group: 'Ratios' },
  { key: 'currRat',   label: 'Current Ratio',color: '#38bdf8', axis: 'R', fmt: fmtX,   compute: p => p.currentAssets != null && p.currentLiabilities != null && p.currentLiabilities > 0 ? p.currentAssets / p.currentLiabilities : null, group: 'Ratios' },
  { key: 'quickRat',  label: 'Quick Ratio',  color: '#7dd3fc', axis: 'R', fmt: fmtX,   compute: p => {
    if (!p.currentLiabilities || p.currentLiabilities <= 0) return null;
    const qa = p.cash ?? (p.currentAssets != null ? p.currentAssets * 0.6 : null);
    return qa != null ? qa / p.currentLiabilities : null;
  }, group: 'Ratios' },
  { key: 'dByEbitda', label: 'Debt/EBITDA',  color: '#be123c', axis: 'R', fmt: fmtX,   compute: p => {
    const d = (p.shortTermDebt ?? 0) + (p.longTermDebt ?? 0);
    const eb = p.ebitda ?? (p.operatingIncome != null && p.dAndA != null ? p.operatingIncome + p.dAndA : null);
    return eb && eb > 0 ? d / eb : null;
  }, group: 'Ratios' },
  { key: 'ndByEbitda',label: 'NetDebt/EBITDA',color: '#c2410c',axis: 'R', fmt: fmtX,   compute: p => {
    const eb = p.ebitda ?? (p.operatingIncome != null && p.dAndA != null ? p.operatingIncome + p.dAndA : null);
    return p.netDebt != null && eb != null && eb > 0 ? p.netDebt / eb : null;
  }, group: 'Ratios' },
  { key: 'intCov',    label: 'Interest Cov.',color: '#059669', axis: 'R', fmt: fmtX,   compute: p => p.ebit != null && p.interestExpense != null && p.interestExpense !== 0 ? p.ebit / p.interestExpense : null, group: 'Ratios' },
  { key: 'assetTurn', label: 'Asset Turnover',color: '#818cf8',axis: 'R', fmt: fmtX,   compute: p => p.totalAssets && p.totalAssets > 0 && p.revenue != null ? p.revenue / p.totalAssets : null, group: 'Ratios' },
];

const GROUPS: Group[] = ['Income', 'Growth', 'Cash Flow', 'Balance', 'Ratios'];
const DEFAULT_ACTIVE = new Set(['revenue', 'earnings', 'netMgn']);

// ─── Scale helpers ────────────────────────────────────────────────────────────
function scale(vals: (number | null)[]) {
  const clean = vals.filter((v): v is number => v != null && isFinite(v) && Math.abs(v) < 1e16);
  if (!clean.length) return { min: 0, max: 1, range: 1 };
  let lo = Math.min(0, ...clean);
  let hi = Math.max(0, ...clean);
  const pad = (hi - lo) * 0.15 || Math.abs(hi || 1) * 0.15;
  hi += pad;
  if (lo < 0) lo -= pad;
  const range = hi - lo || 1;
  return { min: lo, max: hi, range };
}

function ticks(min: number, max: number): number[] {
  return Array.from({ length: N_TICKS + 1 }, (_, i) => min + ((max - min) * i) / N_TICKS);
}

// ─── Chart ────────────────────────────────────────────────────────────────────
type SerDef = { key: string; color: string; fmt: (v: number) => string; values: (number | null)[]; dashed?: boolean };

function DualChart({
  labels, leftSers, rightSers, selIdx, onTap, growthMode, splitIdx,
}: {
  labels: string[];
  leftSers: SerDef[];
  rightSers: SerDef[];
  selIdx: number | null;
  onTap: (i: number) => void;
  growthMode: boolean;
  splitIdx: number;  // index after which data is forecasted
}) {
  const n = labels.length;
  if (n === 0) return null;

  // In growth mode, normalise all series to % change from first real value
  const normSers = (sers: SerDef[]): SerDef[] =>
    sers.map(s => {
      // YoY metrics already express % change — re-normalising them gives nonsense
      if (s.fmt === fmtGro) return s;
      const first = s.values.slice(0, splitIdx + 1).find(v => v != null && v !== 0);
      return {
        ...s,
        values: s.values.map(v =>
          v != null && first != null && first !== 0 ? ((v - first) / Math.abs(first)) * 100 : null),
        fmt: fmtGro,
      };
    });

  const lSers = growthMode ? normSers([...leftSers, ...rightSers]) : leftSers;
  const rSers = growthMode ? [] : rightSers;

  const hasL = lSers.length > 0;
  const hasR = rSers.length > 0;

  const lVals = lSers.flatMap(s => s.values);
  const rVals = rSers.flatMap(s => s.values);

  const ls = scale(lVals);
  const rs = hasR ? scale(rVals) : { min: 0, max: 1, range: 1 };

  const lTicks = ticks(ls.min, ls.max);
  const rTicks = hasR ? ticks(rs.min, rs.max) : [];

  const step = n > 1 ? DRAW_W / (n - 1) : DRAW_W;
  const xOf  = (i: number) => LP + i * step;
  const yL   = (v: number) => TP + DRAW_H - ((v - ls.min) / ls.range) * DRAW_H;
  const yR   = (v: number) => TP + DRAW_H - ((v - rs.min) / rs.range) * DRAW_H;

  const buildPath = (vals: (number | null)[], yFn: (v: number) => number): string => {
    let d = '';
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v == null || !isFinite(v)) { d += ''; continue; }
      const x = xOf(i).toFixed(1), y = yFn(v).toFixed(1);
      // Start new segment if previous was null
      const prev = vals[i - 1];
      d += (i === 0 || prev == null || !isFinite(prev)) ? ` M${x},${y}` : ` L${x},${y}`;
    }
    return d.trim();
  };

  const lFmt = lSers[0]?.fmt ?? fmtM;
  const rFmt = rSers[0]?.fmt ?? fmtPct;

  // vertical line separating real/forecast
  const splitX = splitIdx < n - 1 ? xOf(splitIdx) + step / 2 : null;

  return (
    <Svg width={CHART_W} height={CHART_H}>
      {/* Grid lines + left axis labels */}
      {lTicks.map((t, i) => {
        const y = yL(t);
        return (
          <G key={`lt${i}`}>
            <Line x1={LP} y1={y} x2={CHART_W - RP} y2={y} stroke="#1b2a3d" strokeWidth={1} />
            <SvgText x={LP - 4} y={y + 3.5} fontSize={7.5} fill={TEXT_MUTED} textAnchor="end">{lFmt(t)}</SvgText>
          </G>
        );
      })}

      {/* Right axis labels */}
      {rTicks.map((t, i) => (
        <SvgText key={`rt${i}`} x={CHART_W - RP + 4} y={yR(t) + 3.5} fontSize={7.5} fill={TEXT_MUTED} textAnchor="start">
          {rFmt(t)}
        </SvgText>
      ))}

      {/* Zero line */}
      {ls.min < 0 && (
        <Line x1={LP} y1={yL(0)} x2={CHART_W - RP} y2={yL(0)} stroke="#334155" strokeWidth={1} strokeDasharray="4,3" />
      )}

      {/* Forecast divider */}
      {splitX != null && (
        <Line x1={splitX} y1={TP} x2={splitX} y2={TP + DRAW_H} stroke="#6366f1" strokeWidth={1} strokeDasharray="3,3" opacity={0.5} />
      )}
      {splitX != null && (
        <SvgText x={splitX + 3} y={TP + 9} fontSize={7} fill="#6366f1" opacity={0.8}>estimativas</SvgText>
      )}

      {/* Active period highlight */}
      {selIdx != null && (
        <Rect
          x={xOf(selIdx) - step / 2} y={TP}
          width={Math.max(step, 4)} height={DRAW_H}
          fill="rgba(99,102,241,0.12)" rx={2}
        />
      )}

      {/* Lines — left */}
      {lSers.map(s => {
        const d = buildPath(s.values, yL);
        return d ? (
          <Path key={s.key} d={d} stroke={s.color} strokeWidth={2.2} fill="none"
            strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray={s.dashed ? '8,4' : undefined}
            opacity={s.dashed ? 0.8 : 1}
          />
        ) : null;
      })}

      {/* Lines — right (dashed to distinguish axis) */}
      {rSers.map(s => {
        const d = buildPath(s.values, yR);
        return d ? (
          <Path key={s.key} d={d} stroke={s.color} strokeWidth={2.2} fill="none"
            strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray={s.dashed ? '8,4' : '6,3'}
            opacity={s.dashed ? 0.8 : 1}
          />
        ) : null;
      })}

      {/* Dots — left */}
      {lSers.map(s =>
        s.values.map((v, i) =>
          v != null && isFinite(v) ? (
            <Circle key={`${s.key}d${i}`} cx={xOf(i)} cy={yL(v)}
              r={selIdx === i ? 4.5 : 2.5}
              fill={i > splitIdx ? 'transparent' : s.color}
              stroke={i > splitIdx ? s.color : 'transparent'}
              strokeWidth={1.5}
            />
          ) : null
        )
      )}

      {/* Dots — right */}
      {rSers.map(s =>
        s.values.map((v, i) =>
          v != null && isFinite(v) ? (
            <Circle key={`${s.key}d${i}`} cx={xOf(i)} cy={yR(v)}
              r={selIdx === i ? 4.5 : 2.5}
              fill={i > splitIdx ? 'transparent' : s.color}
              stroke={i > splitIdx ? s.color : 'transparent'}
              strokeWidth={1.5}
            />
          ) : null
        )
      )}

      {/* X axis labels */}
      {labels.map((lbl, i) => {
        if (n > 12 && i % 2 !== 0) return null;
        const x = xOf(i), y = CHART_H - BP + 12;
        return (
          <SvgText key={i} x={x} y={y} fontSize={7.5} fill={TEXT_MUTED}
            textAnchor="end" transform={`rotate(-40, ${x}, ${y})`}>{lbl}
          </SvgText>
        );
      })}

      {/* Axis side labels */}
      {hasL && <SvgText x={8} y={TP + DRAW_H / 2 + 4} fontSize={7.5} fill={TEXT_MUTED} textAnchor="middle" transform={`rotate(-90, 8, ${TP + DRAW_H / 2})`}>{growthMode ? '% chg' : '$'}</SvgText>}
      {hasR && <SvgText x={CHART_W - 8} y={TP + DRAW_H / 2 + 4} fontSize={7.5} fill={TEXT_MUTED} textAnchor="middle" transform={`rotate(90, ${CHART_W - 8}, ${TP + DRAW_H / 2})`}>%  ×</SvgText>}

      {/* Touch hit areas */}
      {Array.from({ length: n }, (_, i) => (
        <Rect key={`h${i}`} x={xOf(i) - step / 2} y={TP}
          width={Math.max(step, 1)} height={DRAW_H}
          fill="transparent" onPress={() => onTap(i)}
        />
      ))}
    </Svg>
  );
}

// ─── Analyst estimate type ────────────────────────────────────────────────────
type Estimate = {
  label: string;
  revenue: number | null;
  netIncome: number | null;
  eps: number | null;
  ebitda: number | null;
};

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function DynamicChartsScreen({ route }: Props) {
  const { data, freq: initFreq, symbol } = route.params;

  const [freq, setFreq] = useState<'quarterly' | 'annual'>('annual');
  const [annualData, setAnnualData]     = useState<FinancialPeriod[]>(initFreq === 'annual' ? data : []);
  const [quarterlyData, setQuarterlyData] = useState<FinancialPeriod[]>(initFreq === 'quarterly' ? data : []);
  const [loadingA, setLoadingA] = useState(initFreq !== 'annual' || data.length === 0);
  const [loadingQ, setLoadingQ] = useState(true);  // always load quarterly too
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [showForecasts, setShowForecasts] = useState(false);
  const [active, setActive] = useState<Set<string>>(new Set(DEFAULT_ACTIVE));
  const [growthMode, setGrowthMode] = useState(false);
  const [selIdx, setSelIdx] = useState<number | null>(null);
  const [openGroup, setOpenGroup] = useState<Group | null>('Income');

  useEffect(() => {
    if (initFreq !== 'annual' || data.length === 0) {
      setLoadingA(true);
      getFinancials(symbol, 'annual').then(d => { setAnnualData(d); setLoadingA(false); }).catch(() => setLoadingA(false));
    } else {
      setLoadingA(false);
    }
    getFinancials(symbol, 'quarterly').then(d => { setQuarterlyData(d); setLoadingQ(false); }).catch(() => setLoadingQ(false));

    // Fetch analyst estimates from FMP
    fetch(`https://financialmodelingprep.com/stable/analyst-estimates?symbol=${symbol}&limit=6&apikey=${FMP_KEY}`)
      .then(r => r.json())
      .then((arr: unknown) => {
        if (!Array.isArray(arr)) return;
        const currentYear = new Date().getFullYear();
        const future = (arr as Record<string, unknown>[])
          .filter(e => typeof e.date === 'string' && parseInt(e.date.split('-')[0]) > currentYear)
          .sort((a, b) => String(a.date).localeCompare(String(b.date)))
          .slice(0, 5)
          .map(e => ({
            label: `${String(e.date).split('-')[0]}E`,
            revenue:    (e.estimatedRevenueAvg  as number | null) ?? null,
            netIncome:  (e.estimatedNetIncomeAvg as number | null) ?? null,
            eps:        (e.estimatedEpsAvg       as number | null) ?? null,
            ebitda:     (e.estimatedEbitdaAvg    as number | null) ?? null,
          }));
        setEstimates(future);
      })
      .catch(() => {});
  }, [symbol]);

  const isLoading = freq === 'annual' ? loadingA : loadingQ;

  // Memoised — only rebuilds when source data or forecast toggle changes
  const periods = useMemo(() => {
    const raw = [...(freq === 'annual' ? annualData : quarterlyData)].reverse();
    const fc: FinancialPeriod[] = showForecasts && freq === 'annual'
      ? estimates.map(e => ({
          label: e.label, year: parseInt(e.label), quarter: 0, endDate: '',
          revenue: e.revenue, grossProfit: null, costOfRevenue: null,
          rAndD: null, sgAndA: null, operatingIncome: null,
          ebitda: e.ebitda, ebit: null, interestExpense: null,
          pretaxIncome: null, incomeTax: null,
          netIncome: e.netIncome, epsDiluted: e.eps, sbc: null,
          cash: null, cashAndShortTermInvestments: null,
          currentAssets: null, totalAssets: null, currentLiabilities: null,
          shortTermDebt: null, longTermDebt: null, netDebt: null,
          totalLiabilities: null, equity: null, goodwill: null,
          retainedEarnings: null, operatingCF: null, capex: null,
          investingCF: null, financingCF: null, dAndA: null,
          dividendsPaid: null, buybacks: null, sharesDiluted: null,
        }))
      : [];
    return [...raw, ...fc];
  }, [freq, annualData, quarterlyData, showForecasts, estimates]);

  // Last index of real (non-forecast) data
  const splitIdx = useMemo(
    () => (freq === 'annual' ? annualData : quarterlyData).length - 1,
    [freq, annualData, quarterlyData],
  );

  const labels = useMemo(() => periods.map(p => p.label), [periods]);

  // If forecasts are toggled off, selIdx may point past the new periods.length → reset it
  useEffect(() => { setSelIdx(null); }, [showForecasts, freq]);

  const toggle = useCallback((key: string) => {
    setActive(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSelIdx(null);
  }, []);

  // activeDefs memoised separately so seriesValues only recomputes when active set changes
  const activeDefs = useMemo(() => METRICS.filter(m => active.has(m.key)), [active]);
  const seriesValues = useMemo(() => {
    const map = new Map<string, (number | null)[]>();
    for (const m of activeDefs) {
      map.set(m.key, m.computeAll ? m.computeAll(periods) : periods.map(m.compute));
    }
    return map;
  }, [activeDefs, periods]);

  const leftSers: SerDef[] = activeDefs
    .filter(m => m.axis === 'L')
    .map(m => ({
      key: m.key,
      color: m.color,
      fmt: m.fmt,
      values: seriesValues.get(m.key) ?? [],
    }));
  const rightSers: SerDef[] = activeDefs
    .filter(m => m.axis === 'R')
    .map(m => ({
      key: m.key,
      color: m.color,
      fmt: m.fmt,
      values: seriesValues.get(m.key) ?? [],
    }));

  // Tooltip values for selected period
  const tooltipPeriod = selIdx != null ? periods[selIdx] : null;

  const canForecast = estimates.length > 0 && freq === 'annual';

  return (
    <View style={{ flex: 1, backgroundColor: PAGE_BG }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Controls bar ─────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {/* Annual / Quarterly */}
          <View style={{ flexDirection: 'row', backgroundColor: SURFACE, borderRadius: 8, padding: 2 }}>
            {(['annual', 'quarterly'] as const).map(f => (
              <TouchableOpacity
                key={f} onPress={() => { setFreq(f); setSelIdx(null); }}
                style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6, backgroundColor: freq === f ? '#6366f1' : 'transparent' }}
              >
                <Text style={{ color: freq === f ? '#fff' : TEXT_MUTED, fontSize: 12, fontWeight: '600' }}>
                  {f === 'annual' ? 'Annual' : 'Quarterly'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Growth % mode */}
          <TouchableOpacity
            onPress={() => setGrowthMode(v => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7,
              borderRadius: 8, backgroundColor: growthMode ? '#6366f133' : SURFACE,
              borderWidth: 1, borderColor: growthMode ? '#6366f1' : 'transparent' }}
          >
            <Text style={{ color: growthMode ? '#6366f1' : TEXT_MUTED, fontSize: 12, fontWeight: '600' }}>% Crescimento</Text>
          </TouchableOpacity>

          {/* Forecasts */}
          {canForecast && (
            <TouchableOpacity
              onPress={() => setShowForecasts(v => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7,
                borderRadius: 8, backgroundColor: showForecasts ? '#0ea5e933' : SURFACE,
                borderWidth: 1, borderColor: showForecasts ? '#0ea5e9' : 'transparent' }}
            >
              <Text style={{ color: showForecasts ? '#0ea5e9' : TEXT_MUTED, fontSize: 12, fontWeight: '600' }}>
                Previsões {estimates.length}a
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Legend pills ─────────────────────────────────────────── */}
        {activeDefs.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {activeDefs.map(m => (
              <TouchableOpacity key={m.key} onPress={() => toggle(m.key)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4,
                  borderRadius: 20, backgroundColor: m.color + '22', borderWidth: 1, borderColor: m.color }}
              >
                <View style={{ width: m.axis === 'R' ? 12 : 8, height: m.axis === 'R' ? 2 : 8, borderRadius: m.axis === 'R' ? 1 : 4, backgroundColor: m.color }} />
                <Text style={{ color: '#e2e8f0', fontSize: 11, fontWeight: '600' }}>{m.label}</Text>
                {m.axis === 'L'
                  ? <Text style={{ color: TEXT_MUTED, fontSize: 9 }}>$</Text>
                  : <Text style={{ color: TEXT_MUTED, fontSize: 9 }}>%/×</Text>
                }
                <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>✕</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Chart ────────────────────────────────────────────────── */}
        <View style={{ backgroundColor: SURFACE, borderRadius: 12, padding: 10, marginBottom: 14, borderWidth: 1, borderColor: BORDER }}>
          {isLoading ? (
            <ActivityIndicator color="#6366f1" style={{ marginVertical: 40 }} />
          ) : periods.length === 0 ? (
            <Text style={{ color: TEXT_MUTED, textAlign: 'center', marginVertical: 40 }}>Sem dados</Text>
          ) : activeDefs.length === 0 ? (
            <Text style={{ color: TEXT_MUTED, textAlign: 'center', marginVertical: 40, fontSize: 13 }}>
              Seleciona pelo menos um indicador abaixo
            </Text>
          ) : (
            <DualChart
              labels={labels}
              leftSers={leftSers}
              rightSers={rightSers}
              selIdx={selIdx}
              onTap={i => setSelIdx(prev => prev === i ? null : i)}
              growthMode={growthMode}
              splitIdx={splitIdx}
            />
          )}
          {/* Axis legend hint */}
          {!growthMode && activeDefs.some(m => m.axis === 'L') && activeDefs.some(m => m.axis === 'R') && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingHorizontal: 4 }}>
              <Text style={{ color: '#334155', fontSize: 9 }}>← eixo esquerdo ($)</Text>
              <Text style={{ color: '#334155', fontSize: 9 }}>eixo direito (%/×) →</Text>
            </View>
          )}
        </View>

        {/* ── Tooltip ──────────────────────────────────────────────── */}
        {tooltipPeriod && (
          <View style={{ backgroundColor: SURFACE, borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#6366f133' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ color: '#f8fafc', fontSize: 14, fontWeight: '700' }}>{tooltipPeriod.label}</Text>
              {selIdx != null && selIdx > splitIdx && (
                <View style={{ backgroundColor: '#0ea5e922', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                  <Text style={{ color: '#0ea5e9', fontSize: 10, fontWeight: '600' }}>ESTIMATIVA</Text>
                </View>
              )}
              <TouchableOpacity onPress={() => setSelIdx(null)}>
                <Text style={{ color: TEXT_MUTED, fontSize: 18 }}>×</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {activeDefs.map(m => {
                const v = selIdx != null ? (seriesValues.get(m.key)?.[selIdx] ?? null) : null;
                return (
                  <View key={m.key} style={{ minWidth: '44%', flexGrow: 1 }}>
                    <Text style={{ color: TEXT_MUTED, fontSize: 10, marginBottom: 2 }}>{m.label}</Text>
                    <Text style={{ color: v != null ? m.color : '#334155', fontSize: 14, fontWeight: '700' }}>
                      {v != null ? m.fmt(v) : '—'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* ── Metric picker ────────────────────────────────────────── */}
        <View style={{ backgroundColor: '#111827', borderRadius: 14, overflow: 'hidden', marginBottom: 8 }}>
          <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER }}>
            <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' }}>
              Indicadores — {active.size} selecionados
            </Text>
          </View>

          {GROUPS.map(group => {
            const groupMetrics = METRICS.filter(m => m.group === group);
            const isOpen = openGroup === group;
            return (
              <View key={group}>
                <TouchableOpacity
                  onPress={() => setOpenGroup(isOpen ? null : group)}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    paddingHorizontal: 14, paddingVertical: 9, backgroundColor: SURFACE_ALT,
                    borderTopWidth: 1, borderTopColor: BORDER }}
                >
                  <Text style={{ color: '#cbd5e1', fontSize: 13, fontWeight: '600' }}>{group}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>
                      {groupMetrics.filter(m => active.has(m.key)).length}/{groupMetrics.length}
                    </Text>
                    <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>{isOpen ? '▲' : '▼'}</Text>
                  </View>
                </TouchableOpacity>

                {isOpen && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 10, gap: 8, backgroundColor: SURFACE_ALT }}>
                    {groupMetrics.map(m => {
                      const on = active.has(m.key);
                      return (
                        <TouchableOpacity
                          key={m.key} onPress={() => toggle(m.key)}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 6,
                            paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
                            backgroundColor: on ? m.color + '22' : SURFACE,
                            borderWidth: 1, borderColor: on ? m.color : '#2d3748' }}
                        >
                          {/* Line or dot indicator based on axis */}
                          {m.axis === 'R'
                            ? <View style={{ width: 14, height: 2, borderRadius: 1, backgroundColor: on ? m.color : '#334155' }} />
                            : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: on ? m.color : '#334155' }} />
                          }
                          <Text style={{ color: on ? TEXT_SECONDARY : TEXT_MUTED, fontSize: 12, fontWeight: '600' }}>{m.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* Legend hint */}
        <Text style={{ color: '#334155', fontSize: 10, textAlign: 'center', marginTop: 6 }}>
          Ponto cheio = dados reais · Ponto vazio = estimativa · Linha sólida = eixo $ · Linha tracejada = eixo %/×
        </Text>

      </ScrollView>
    </View>
  );
}
