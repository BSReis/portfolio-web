import React, { useEffect, useState } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, ScrollView, Dimensions, Pressable, ActivityIndicator,
} from 'react-native';
import Svg, { Rect, Line, Text as SvgText, G, Path, Circle } from 'react-native-svg';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { FinancialPeriod, getFinancials } from '../services/api';

type Props = NativeStackScreenProps<RootStackParamList, 'FinancialCharts'>;

const SCREEN_W = Dimensions.get('window').width;
const CHART_W = SCREEN_W - 32;
const CHART_H = 160;
const COMBO_H = 195;
const PAD = { top: 12, bottom: 32, left: 30, right: 15 };
const COMBO_PAD = { top: 16, bottom: 36, left: 44, right: 44 };
const PAGE_BG = '#111417';
const SURFACE = '#1b2023';
const SURFACE_ALT = '#23282d';
const BORDER = '#303841';
const TEXT_MUTED = '#8f99aa';
const TEXT_SECONDARY = '#c3cad5';
const TEXT_PRIMARY = '#f5f7fa';

/* ── helpers ────────────────────────────────────────────────── */
const fmtB = (v: number): string => {
  const abs = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (abs >= 1e12) return `${s}${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9)  return `${s}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `${s}${(abs / 1e6).toFixed(0)}M`;
  return `${s}${abs.toFixed(0)}`;
};
const fmtPct = (v: number): string => `${(v * 100).toFixed(0)}%`;
const fmtEps = (v: number): string => v.toFixed(2);

/* ── SeriesToggle ────────────────────────────────────────────── */
type SeriesDef = { key: string; label: string; color: string };

function SeriesToggle({
  series, active, onToggle,
}: { series: SeriesDef[]; active: Set<string>; onToggle: (k: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
      {series.map((s) => (
        <TouchableOpacity
          key={s.key}
          activeOpacity={0.7}
          onPress={() => onToggle(s.key)}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 5,
            paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
            backgroundColor: active.has(s.key) ? s.color + '22' : SURFACE_ALT,
            borderWidth: 1, borderColor: active.has(s.key) ? s.color : BORDER,
          }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: active.has(s.key) ? s.color : '#334155' }} />
          <Text style={{ color: active.has(s.key) ? TEXT_SECONDARY : TEXT_MUTED, fontSize: 11, fontWeight: '600' }}>
            {s.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/* ── BarChartSvg ─────────────────────────────────────────────── */
function BarChartSvg({
  labels, series, activeSeries, fmtY = fmtB, colorBySign = false,
}: {
  labels: string[];
  series: { key: string; color: string; values: (number | null)[] }[];
  activeSeries: Set<string>;
  fmtY?: (v: number) => string;
  colorBySign?: boolean;
}) {
  const drawW = CHART_W - PAD.left - PAD.right;
  const drawH = CHART_H - PAD.top - PAD.bottom;
  const n = labels.length;
  if (n === 0) return null;
  const activeSer = series.filter((s) => activeSeries.has(s.key));
  const nSeries = activeSer.length;
  if (nSeries === 0) return null;
  const hasValue = activeSer.some((ser) => ser.values.some((v) => v != null));
  if (!hasValue) return null;
  let minV = 0, maxV = 0;
  for (const ser of activeSer) for (const v of ser.values) {
    if (v == null) continue;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const padding = (maxV - minV) * 0.1 || Math.abs(maxV) * 0.1 || 1;
  maxV += padding;
  if (minV < 0) minV -= padding;
  const range = maxV - minV || 1;
  const yScale = (v: number) => PAD.top + drawH - ((v - minV) / range) * drawH;
  const zeroY = yScale(0);
  const groupW = drawW / n;
  const barTotalPad = 4;
  const barW = (groupW - barTotalPad) / nSeries;
  const ticks = [0, 1, 2, 3, 4, 5].map((i) => minV + (range * i) / 5);
  return (
    <Svg width={CHART_W} height={CHART_H}>
      {ticks.map((t, i) => {
        const y = yScale(t);
        return (
          <G key={i}>
            <Line x1={PAD.left} y1={y} x2={CHART_W - PAD.right} y2={y} stroke="#2d3f55" strokeWidth={1} />
            <SvgText x={PAD.left - 3} y={y + 3.5} fontSize={8.5} fill={TEXT_MUTED} textAnchor="end">{fmtY(t)}</SvgText>
          </G>
        );
      })}
      {labels.map((_, i) => {
        const x = PAD.left + i * groupW + groupW / 2;
        return <Line key={i} x1={x} y1={PAD.top} x2={x} y2={PAD.top + drawH} stroke="#243044" strokeWidth={0.7} />;
      })}
      {minV < 0 && (
        <Line x1={PAD.left} y1={zeroY} x2={CHART_W - PAD.right} y2={zeroY} stroke="#334155" strokeWidth={1} strokeDasharray="4,3" />
      )}
      {activeSer.map((ser, sIdx) =>
        ser.values.map((v, i) => {
          if (v == null) return null;
          const x = PAD.left + i * groupW + barTotalPad / 2 + sIdx * barW;
          const barTop = Math.min(yScale(v), zeroY);
          const barBot = Math.max(yScale(v), zeroY);
          const h = Math.max(barBot - barTop, 1);
          const color = colorBySign ? (v >= 0 ? '#22c55e' : '#ef4444') : ser.color;
          return <Rect key={`${sIdx}-${i}`} x={x} y={barTop} width={Math.max(barW - 1, 1)} height={h} fill={color} rx={2} />;
        })
      )}
      {labels.map((lbl, i) => {
        const cx = PAD.left + i * groupW + groupW / 2;
        const cy = CHART_H - PAD.bottom + 10;
        return (
          <SvgText key={i} x={cx} y={cy} fontSize={7.5} fill={TEXT_MUTED} textAnchor="end" transform={`rotate(-40, ${cx}, ${cy})`}>
            {lbl}
          </SvgText>
        );
      })}
    </Svg>
  );
}

/* ── Growth & Profitability combo chart ─────────────────────── */
function GrowthProfitabilityChart({ periods }: { periods: FinancialPeriod[] }) {
  const labels = periods.map(p => p.label);
  const revenue = periods.map(p => p.revenue);
  const netIncome = periods.map(p => p.netIncome);
  const netMargin = periods.map(p =>
    p.revenue && p.revenue > 0 && p.netIncome != null ? p.netIncome / p.revenue : null);
  const n = labels.length;
  if (n === 0) return null;

  const cp = COMBO_PAD;
  const drawW = CHART_W - cp.left - cp.right;
  const drawH = COMBO_H - cp.top - cp.bottom;

  const allBarVals = [...revenue, ...netIncome].filter((v): v is number => v != null);
  let lMin = Math.min(0, ...allBarVals);
  let lMax = Math.max(0, ...allBarVals);
  const lPad = (lMax - lMin) * 0.18 || Math.abs(lMax) * 0.18 || 1;
  lMax += lPad;
  if (lMin < 0) lMin -= lPad;
  const lRange = lMax - lMin || 1;

  const mVals = netMargin.filter((v): v is number => v != null);
  let rMin = mVals.length ? Math.min(0, ...mVals) : 0;
  let rMax = mVals.length ? Math.max(...mVals) : 0.5;
  const rPad = (rMax - rMin) * 0.25 || 0.05;
  rMax += rPad;
  if (rMin > 0) rMin = Math.max(0, rMin - rPad);
  const rRange = rMax - rMin || 1;

  const yL = (v: number) => cp.top + drawH - ((v - lMin) / lRange) * drawH;
  const yR = (v: number) => cp.top + drawH - ((v - rMin) / rRange) * drawH;
  const zeroY = yL(0);
  const groupW = drawW / n;
  const barGap = 2;
  const barW = (groupW - barGap * 3) / 2;

  type Pt = { cx: number; cy: number };
  const linePts: Pt[] = netMargin
    .map((v, i) => v == null ? null : ({ cx: cp.left + i * groupW + groupW / 2, cy: yR(v) }))
    .filter((pt): pt is Pt => pt != null);
  const linePath = linePts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.cx.toFixed(1)},${pt.cy.toFixed(1)}`).join(' ');
  const lTicks = [0, 1, 2, 3, 4].map(i => lMin + (lRange * i) / 4);
  const rTicks = [0, 1, 2, 3, 4].map(i => rMin + (rRange * i) / 4);

  return (
    <Svg width={CHART_W} height={COMBO_H}>
      {lTicks.map((t, i) => {
        const y = yL(t);
        return (
          <G key={i}>
            <Line x1={cp.left} y1={y} x2={CHART_W - cp.right} y2={y} stroke="#2d3f55" strokeWidth={1} />
            <SvgText x={cp.left - 3} y={y + 3.5} fontSize={8} fill={TEXT_MUTED} textAnchor="end">{fmtB(t)}</SvgText>
          </G>
        );
      })}
      {rTicks.map((t, i) => (
        <SvgText key={i} x={CHART_W - cp.right + 3} y={yR(t) + 3.5} fontSize={8} fill="#f97316" textAnchor="start">{fmtPct(t)}</SvgText>
      ))}
      {lMin < 0 && <Line x1={cp.left} y1={zeroY} x2={CHART_W - cp.right} y2={zeroY} stroke="#334155" strokeWidth={1} strokeDasharray="4,3" />}
      {revenue.map((v, i) => {
        if (v == null) return null;
        const x = cp.left + i * groupW + barGap;
        const top = Math.min(yL(v), zeroY);
        const h = Math.max(Math.abs(yL(v) - zeroY), 1);
        return <Rect key={i} x={x} y={top} width={Math.max(barW, 1)} height={h} fill="#3b82f6" rx={2} />;
      })}
      {netIncome.map((v, i) => {
        if (v == null) return null;
        const x = cp.left + i * groupW + barGap * 2 + barW;
        const top = Math.min(yL(v), zeroY);
        const h = Math.max(Math.abs(yL(v) - zeroY), 1);
        return <Rect key={i} x={x} y={top} width={Math.max(barW, 1)} height={h} fill={v >= 0 ? '#14b8a6' : '#ef4444'} rx={2} />;
      })}
      {linePath.length > 0 && <Path d={linePath} stroke="#f97316" strokeWidth={2} fill="none" />}
      {linePts.map((pt, i) => <Circle key={i} cx={pt.cx} cy={pt.cy} r={2.5} fill="#f97316" />)}
      {labels.map((lbl, i) => {
        const cx = cp.left + i * groupW + groupW / 2;
        const cy = COMBO_H - cp.bottom + 10;
        return (
          <SvgText key={i} x={cx} y={cy} fontSize={7.5} fill={TEXT_MUTED} textAnchor="end" transform={`rotate(-40, ${cx}, ${cy})`}>{lbl}</SvgText>
        );
      })}
    </Svg>
  );
}

/* ── Chart glossary ─────────────────────────────────────────── */
const CHART_INFO: Record<string, string> = {
  'Growth & Profitability': 'Revenue (blue) is total sales. Net income (teal) is profit after all costs — what belongs to shareholders. Net margin % (orange line) = Net income ÷ Revenue. A rising net margin means the company is becoming more efficient as it grows.',
  EBITDA: 'Earnings Before Interest, Taxes, Depreciation & Amortization. Shows operating profitability stripped of accounting and financing choices.',
  'EPS (Diluted)': 'Net income divided by the fully diluted share count. Shows how much each share earns. Growth here drives long-term stock prices.',
  'Debt level and coverage': 'Debt (pink) shows the company debt load. Free cash flow (teal) shows the recurring cash the business generates after capex. Cash & equivalents (blue) shows the liquidity cushion available immediately. Together they show whether debt is comfortably covered by cash generation and cash on hand.',
  'Cash Flow': 'Operating CF (purple) is cash generated by the core business. Free Cash Flow (amber) = Operating CF − Capex. FCF is the cleanest measure of real profitability.',
  'Shares Outstanding': 'Total number of diluted shares. Rising shares = dilution (bad for existing shareholders). Falling shares = buybacks (generally good).',
};

/* ── ChartCard ───────────────────────────────────────────────── */
function ChartCard({ title, children, onInfo }: { title: string; children: React.ReactNode; onInfo?: () => void }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 5 }}>
        <Text style={{ color: TEXT_MUTED, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' }}>{title}</Text>
        {onInfo && (
          <Pressable onPress={onInfo} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
            <Text style={{ color: '#6366f1', fontSize: 13, lineHeight: 18 }}>ⓘ</Text>
          </Pressable>
        )}
      </View>
      <View style={{ backgroundColor: SURFACE, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: BORDER }}>{children}</View>
    </View>
  );
}

/* ── Screen ──────────────────────────────────────────────────── */
export default function FinancialChartsScreen({ route }: Props) {
  const { data, freq, symbol } = route.params;

  const [quarterlyData, setQuarterlyData] = useState<FinancialPeriod[]>(freq === 'quarterly' ? data : []);
  const [annualData, setAnnualData] = useState<FinancialPeriod[]>(freq === 'annual' ? data : []);
  const [loadingQ, setLoadingQ] = useState(freq !== 'quarterly' || data.length === 0);
  const [loadingA, setLoadingA] = useState(freq !== 'annual' || data.length === 0);
  const [freqMode, setFreqMode] = useState<'quarterly' | 'annual'>(freq);
  const [chartInfo, setChartInfo] = useState<{ title: string; desc: string } | null>(null);
  const [cashDebtActive, setCashDebtActive] = useState(new Set(['debt', 'fcf', 'cashEq']));
  const [cfActive, setCfActive] = useState(new Set(['opCF', 'fcf']));

  useEffect(() => {
    setFreqMode(freq);
    setQuarterlyData(freq === 'quarterly' ? data : []);
    setAnnualData(freq === 'annual' ? data : []);
    if (freq !== 'quarterly' || data.length === 0) {
      setLoadingQ(true);
      getFinancials(symbol, 'quarterly').then(setQuarterlyData).catch(() => {}).finally(() => setLoadingQ(false));
    } else {
      setLoadingQ(false);
    }
    if (freq !== 'annual' || data.length === 0) {
      setLoadingA(true);
      getFinancials(symbol, 'annual').then(setAnnualData).catch(() => {}).finally(() => setLoadingA(false));
    } else {
      setLoadingA(false);
    }
  }, [symbol, freq, data]);

  const currentData = freqMode === 'quarterly' ? quarterlyData : annualData;
  const isLoading = freqMode === 'quarterly' ? loadingQ : loadingA;
  const periods = [...currentData].reverse();
  const labels = periods.map((p) => p.label);

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (key: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { if (next.size > 1) next.delete(key); }
      else next.add(key);
      return next;
    });
  };

  const get = (key: keyof FinancialPeriod) =>
    periods.map((p) => (p[key] as number | null) ?? null);

  const freeCF = periods.map((p) =>
    p.operatingCF != null && p.capex != null ? p.operatingCF - p.capex : null);
  // Use pre-computed p.ebitda (same as income statement tab).
  // Re-computing operatingIncome + dAndA fails for Q4 when Finnhub reports YTD cumulative values.
  const ebitda = periods.map((p) =>
    p.ebitda ?? (p.operatingIncome != null && p.dAndA != null ? p.operatingIncome + p.dAndA : p.operatingIncome)) as (number | null)[];
  const cashAndEquivalents = periods.map((p) => p.cashAndShortTermInvestments ?? p.cash);
  const rawDebt = periods.map((p, i) => {
    const totalDebt = (p.shortTermDebt ?? 0) + (p.longTermDebt ?? 0);
    if (totalDebt > 0) return totalDebt;
    if (p.longTermDebt != null) return p.longTermDebt;
    const cashEq = cashAndEquivalents[i];
    if (p.netDebt != null && cashEq != null) return p.netDebt + cashEq;
    return null;
  });
  const debt = rawDebt.map((value, i) => {
    if (value != null) return value;
    if (freqMode !== 'quarterly') return null;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (rawDebt[j] != null) return rawDebt[j];
    }
    return null;
  });

  const debtCoverageSeries = [
    { key: 'debt', label: 'Debt', color: '#ef5b93', values: debt },
    { key: 'fcf', label: 'Free Cash Flow', color: '#06b6d4', values: freeCF },
    { key: 'cashEq', label: 'Cash & Equivalents', color: '#3b82f6', values: cashAndEquivalents },
  ];
  const cfSeries = [
    { key: 'opCF', label: 'Operating CF', color: '#6366f1', values: get('operatingCF') },
    { key: 'fcf', label: 'Free Cash Flow', color: '#f59e0b', values: freeCF },
  ];

  useEffect(() => {
    if (!__DEV__) return;
    console.log('[FinancialCharts][DebtCoverage]', {
      symbol,
      freqMode,
      rows: periods.map((p, i) => ({
        label: p.label,
        endDate: p.endDate,
        shortTermDebt: p.shortTermDebt,
        longTermDebt: p.longTermDebt,
        netDebt: p.netDebt,
        cash: p.cash,
        cashAndShortTermInvestments: p.cashAndShortTermInvestments,
        operatingCF: p.operatingCF,
        capex: p.capex,
        derivedFreeCashFlow: freeCF[i],
        derivedDebt: debt[i],
      })),
    });
  }, [symbol, freqMode, periods, freeCF, debt]);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1, backgroundColor: PAGE_BG }} contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>

        {/* Annual / Quarterly toggle */}
        <View style={{ flexDirection: 'row', backgroundColor: SURFACE, borderRadius: 10, alignSelf: 'flex-end', padding: 3, marginBottom: 16 }}>
          {(['annual', 'quarterly'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFreqMode(f)}
              style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: freqMode === f ? '#6366f1' : 'transparent' }}
            >
              <Text style={{ color: freqMode === f ? '#fff' : TEXT_MUTED, fontSize: 13, fontWeight: '600' }}>
                {f === 'annual' ? 'Annual' : 'Quarterly'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {isLoading ? (
          <ActivityIndicator color="#6366f1" style={{ marginVertical: 60 }} />
        ) : periods.length === 0 ? (
          <Text style={{ color: TEXT_MUTED, fontSize: 14, textAlign: 'center', marginVertical: 60 }}>No data available</Text>
        ) : (
          <>
            {/* Growth & Profitability */}
            <ChartCard title="Growth & Profitability" onInfo={() => setChartInfo({ title: 'Growth & Profitability', desc: CHART_INFO['Growth & Profitability'] })}>
              <View style={{ flexDirection: 'row', gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
                {([
                  { color: '#3b82f6', label: 'Revenue', line: false },
                  { color: '#14b8a6', label: 'Net income', line: false },
                  { color: '#f97316', label: 'Net margin %', line: true },
                ] as { color: string; label: string; line: boolean }[]).map((s) => (
                  <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    {s.line
                      ? <View style={{ width: 14, height: 2, backgroundColor: s.color, borderRadius: 1 }} />
                      : <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: s.color }} />
                    }
                    <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>{s.label}</Text>
                  </View>
                ))}
              </View>
              <GrowthProfitabilityChart periods={periods} />
            </ChartCard>

            <ChartCard title="EBITDA" onInfo={() => setChartInfo({ title: 'EBITDA', desc: CHART_INFO['EBITDA'] })}>
              <BarChartSvg labels={labels} series={[{ key: 'ebitda', color: '#a78bfa', values: ebitda }]} activeSeries={new Set(['ebitda'])} />
            </ChartCard>
            <ChartCard title="EPS (Diluted)" onInfo={() => setChartInfo({ title: 'EPS (Diluted)', desc: CHART_INFO['EPS (Diluted)'] })}>
              <BarChartSvg labels={labels} series={[{ key: 'eps', color: '#fbbf24', values: get('epsDiluted') }]} activeSeries={new Set(['eps'])} colorBySign fmtY={fmtEps} />
            </ChartCard>
            <ChartCard title="Debt level and coverage" onInfo={() => setChartInfo({ title: 'Debt level and coverage', desc: CHART_INFO['Debt level and coverage'] })}>
              <SeriesToggle series={debtCoverageSeries} active={cashDebtActive} onToggle={toggle(setCashDebtActive)} />
              <BarChartSvg labels={labels} series={debtCoverageSeries} activeSeries={cashDebtActive} />
            </ChartCard>
            <ChartCard title="Cash Flow" onInfo={() => setChartInfo({ title: 'Cash Flow', desc: CHART_INFO['Cash Flow'] })}>
              <SeriesToggle series={cfSeries} active={cfActive} onToggle={toggle(setCfActive)} />
              <BarChartSvg labels={labels} series={cfSeries} activeSeries={cfActive} colorBySign />
            </ChartCard>
            <ChartCard title="Shares Outstanding" onInfo={() => setChartInfo({ title: 'Shares Outstanding', desc: CHART_INFO['Shares Outstanding'] })}>
              <BarChartSvg labels={labels} series={[{ key: 'shares', color: '#38bdf8', values: get('sharesDiluted') }]} activeSeries={new Set(['shares'])} />
            </ChartCard>
            <View style={{ height: 40 }} />
          </>
        )}
      </ScrollView>

      {/* Info overlay — absolute, avoids Modal bugs on Android */}
      {chartInfo !== null && (
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24, zIndex: 999, elevation: 99 }]}
          onPress={() => setChartInfo(null)}
        >
          <Pressable style={{ backgroundColor: SURFACE, borderRadius: 18, padding: 24, width: '100%', maxWidth: 380, borderWidth: 1, borderColor: BORDER }} onPress={() => {}}>
            <Text style={{ color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 12 }}>{chartInfo.title}</Text>
            <View style={{ height: 1, backgroundColor: BORDER, marginBottom: 14 }} />
            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              <Text style={{ color: '#cbd5e1', fontSize: 15, lineHeight: 23 }}>{chartInfo.desc}</Text>
            </ScrollView>
            <TouchableOpacity onPress={() => setChartInfo(null)} style={{ marginTop: 20, alignSelf: 'flex-end', backgroundColor: '#6366f1', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 }}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      )}
    </View>
  );
}
