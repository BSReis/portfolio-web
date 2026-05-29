import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Dimensions, Platform, Modal, Pressable,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Holding, Transaction } from '../context/PortfolioContext';
import {
  getStockQuote, getHistoricalData, StockQuote, effectivePrice, HistoricalData,
  getDividends, getDeclaredDividends, getDividendHistory,
} from '../services/api';
import InteractiveChart from '../components/InteractiveChart';
import Svg, { Path, Text as SvgText, G } from 'react-native-svg';
import { BlurValue } from '../utils/blurValue';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const PERIODS = ['1D', '1W', '1M', 'YTD', '1Y', '5Y', 'Max'] as const;
type Period = (typeof PERIODS)[number];

const CHART_PARAMS: Record<Period, { range: string; interval: string }> = {
  '1D':  { range: '5d',  interval: '5m'  },
  '1W':  { range: '1mo', interval: '1h'  },
  '1M':  { range: '6mo', interval: '1d'  },
  YTD:   { range: '2y',  interval: '1wk' },
  '1Y':  { range: '5y',  interval: '1wk' },
  '5Y':  { range: 'max', interval: '1mo' },
  Max:   { range: 'max', interval: '1mo' },
};

function pointsForPeriod(timestamps: number[], period: Period): number {
  if (period === 'Max' || timestamps.length === 0) return timestamps.length;
  if (period === '1D') {
    for (let i = timestamps.length - 1; i > 0; i--) {
      if (timestamps[i] - timestamps[i - 1] > 4 * 3600) return Math.max(5, timestamps.length - i);
    }
    return timestamps.length;
  }
  const now = Date.now() / 1000;
  const cutoffs: Record<string, number> = {
    '1W': now - 7 * 86400,
    '1M': now - 30 * 86400,
    YTD: new Date(new Date().getFullYear(), 0, 1).getTime() / 1000,
    '1Y': now - 365 * 86400,
    '5Y': now - 5 * 365 * 86400,
  };
  const cutoff = cutoffs[period] ?? 0;
  let idx = 0;
  for (let i = 0; i < timestamps.length; i++) {
    if (timestamps[i] >= cutoff) { idx = i; break; }
  }
  return timestamps.length - idx;
}

const ALLOC_COLORS = [
  '#6366f1', '#818cf8', '#4f46e5', '#8b5cf6', '#a78bfa',
  '#7c3aed', '#a855f7', '#c084fc', '#9333ea', '#4338ca',
  '#6d28d9', '#7e22ce', '#5b21b6', '#60a5fa', '#93c5fd',
];

// ---- Dividend types & helpers ----
type DivStatus = 'paid' | 'forecasted' | 'declared';
interface DivEntry {
  symbol: string; name: string; shares: number;
  amount: number; total: number;
  timestamp: number; payDate: number | null;
  year: number; status: DivStatus;
}

const DIV_COLORS = ['#6366f1','#3b82f6','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function deriveFreqDays(divs: { date: number }[]): number | null {
  if (divs.length < 2) return null;
  const recent = divs.slice(0, 8);
  const gaps: number[] = [];
  for (let i = 0; i < recent.length - 1; i++) gaps.push((recent[i].date - recent[i + 1].date) / 86400);
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median < 20) return 7;
  if (median < 45) return 30;
  if (median < 100) return 91;
  if (median < 200) return 183;
  return 365;
}

const TIMESPANS = ['since_buy', 'year', 'ytd', 'month', 'week', 'daily'] as const;
type Timespan = (typeof TIMESPANS)[number];
const SORT_MODES = ['relative', 'absolute', 'position'] as const;
type SortMode = (typeof SORT_MODES)[number];

const TIMESPAN_LABELS: Record<Timespan, string> = {
  since_buy: 'Since buy', year: 'Year', ytd: 'Year-to-date',
  month: 'Month', week: 'Week', daily: 'Daily trend',
};
const SORT_LABELS: Record<SortMode, [string, string]> = {
  relative: ['%', 'Relative return'],
  absolute: ['$', 'Absolute return'],
  position: ['≡', 'Position size'],
};

const fmtMoney = (v: number, decimals = 2): string => {
  const [int, dec] = Math.abs(v).toFixed(decimals).split('.');
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = v < 0 ? '-' : '';
  return decimals > 0 ? `${sign}${intFmt},${dec}` : `${sign}${intFmt}`;
};

interface Props {
  name: string;
  holdings: Holding[];
  transactions: Transaction[];
  hideValues?: boolean;
}

function DonutChart({ items, centerLabel, centerValue, centerGain, isPositive, size = 260, hideValues = false }: {
  items: { symbol: string; pct: number; color: string; value?: number }[];
  centerLabel: string; centerValue: string; centerGain: string;
  isPositive: boolean; size?: number; hideValues?: boolean;
}) {
  const [hoveredIdx, setHoveredIdx] = React.useState(-1);
  const cx = size / 2, cy = size / 2;
  const outerR = size * 0.43, innerR = size * 0.265;
  const GAP = 0.012;
  const paths: { d: string; color: string; symbol: string; pct: number; lx: number; ly: number }[] = [];
  let startAngle = -Math.PI / 2;
  for (const item of items) {
    const angle = item.pct * 2 * Math.PI;
    const sa = startAngle + GAP / 2, ea = startAngle + angle - GAP / 2;
    const largeArc = angle > Math.PI ? 1 : 0;
    const fmt = (n: number) => n.toFixed(3);
    const d = [
      `M ${fmt(cx + outerR * Math.cos(sa))} ${fmt(cy + outerR * Math.sin(sa))}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${fmt(cx + outerR * Math.cos(ea))} ${fmt(cy + outerR * Math.sin(ea))}`,
      `L ${fmt(cx + innerR * Math.cos(ea))} ${fmt(cy + innerR * Math.sin(ea))}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${fmt(cx + innerR * Math.cos(sa))} ${fmt(cy + innerR * Math.sin(sa))}`,
      'Z',
    ].join(' ');
    const mid = (sa + ea) / 2, lr = (outerR + innerR) / 2;
    paths.push({ d, color: item.color, symbol: item.symbol, pct: item.pct,
      lx: cx + lr * Math.cos(mid), ly: cy + lr * Math.sin(mid) });
    startAngle += angle;
  }
  const hov = hoveredIdx >= 0 ? paths[hoveredIdx] : null;
  const dispLabel  = hov ? hov.symbol : centerLabel;
  const dispValue  = hov && items[hoveredIdx]?.value != null
    ? (hideValues ? '•••' : fmtMoney(items[hoveredIdx].value!))
    : centerValue;
  const dispGain   = hov ? `${(hov.pct * 100).toFixed(2)}%` : centerGain;
  const dispPos    = hov ? true : isPositive;
  return (
    <Svg width={size} height={size}>
      <G>{paths.map((p, i) => (
        <Path
          key={i} d={p.d} fill={p.color}
          fillOpacity={hoveredIdx === -1 ? 0.82 : i === hoveredIdx ? 1.0 : 0.35}
          // @ts-ignore
          onMouseEnter={() => setHoveredIdx(i)}
          onMouseLeave={() => setHoveredIdx(-1)}
          style={{ cursor: 'pointer' }}
        />
      ))}</G>
      {paths.filter(p => p.pct >= 0.04).map((p, i) => (
        <G key={`l${i}`} opacity={hoveredIdx === -1 ? 1 : i === hoveredIdx ? 1 : 0.3} pointerEvents="none">
          <SvgText x={p.lx} y={p.ly - 5} fill="#fff" fontSize={size < 200 ? 7 : 9} fontWeight="700" fontFamily="system-ui, -apple-system, sans-serif" textAnchor="middle">{p.symbol}</SvgText>
          <SvgText x={p.lx} y={p.ly + 7} fill="rgba(255,255,255,0.75)" fontSize={size < 200 ? 6 : 8} fontFamily="system-ui, -apple-system, sans-serif" textAnchor="middle">{(p.pct * 100).toFixed(0)}%</SvgText>
        </G>
      ))}
      <G pointerEvents="none">
        <SvgText x={cx} y={cy - 8} fill="#f5f7fa" fontSize={size < 200 ? 12 : 14} fontWeight="700" fontFamily="system-ui, -apple-system, sans-serif" textAnchor="middle">{dispValue}</SvgText>
        <SvgText x={cx} y={cy + 12} fill={dispPos ? '#22c55e' : '#ef4444'} fontSize={11} fontWeight="600" fontFamily="system-ui, -apple-system, sans-serif" textAnchor="middle">{dispGain}</SvgText>
      </G>
    </Svg>
  );
}

function StatRight({ label, value, color, sub, subColor, blur = false }: {
  label: string; value: string; color?: string; sub?: string; subColor?: string; blur?: boolean;
}) {
  return (
    <View style={{ backgroundColor: '#1b2023', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#303841' }}>
      <Text style={{ color: '#8f99aa', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</Text>
      <BlurValue hidden={blur}>
        <Text style={{ color: color ?? '#f5f7fa', fontSize: 18, fontWeight: '700' }}>{value}</Text>
      </BlurValue>
      {sub != null && <Text style={{ color: subColor ?? '#8f99aa', fontSize: 12, marginTop: 2 }}>{sub}</Text>}
    </View>
  );
}

export default function SharedPortfolioScreen({ name, holdings, transactions, hideValues = false }: Props) {
  const mv = (n: number, decimals?: number) => hideValues ? '•••' : fmtMoney(n, decimals); // kept only for SVG string contexts
  const { width: windowWidth } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && windowWidth >= 768;
  const filterBtnRef = useRef<View>(null);

  const [quotes, setQuotes] = useState<Record<string, StockQuote | null>>({});
  const [quotesLoading, setQuotesLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('Max');
  const [fullData, setFullData] = useState<HistoricalData>({ prices: [], timestamps: [] });
  const [chartLoading, setChartLoading] = useState(false);
  const [chartVisiblePrices, setChartVisiblePrices] = useState<number[]>([]);
  const [crosshairVisible, setCrosshairVisible] = useState(false);
  const [chPrice, setChPrice] = useState(0);
  const [chDateStr, setChDateStr] = useState('');
  const [spxOverlay, setSpxOverlay] = useState<number[]>([]);

  // Filter state
  const [timespan, setTimespan] = useState<Timespan>('daily');
  const [sortBy, setSortBy] = useState<SortMode>('relative');
  const [filterVisible, setFilterVisible] = useState(false);
  const [filterPopoverPos, setFilterPopoverPos] = useState<{ top?: number; bottom?: number; right: number; maxHeight: number }>({ right: 16, maxHeight: 400 });
  const [refPrices, setRefPrices] = useState<Record<string, number>>({});

  // Dividend state
  const [divEntries, setDivEntries] = useState<DivEntry[]>([]);
  const [divLoading, setDivLoading] = useState(false);
  const [selectedDivYear, setSelectedDivYear] = useState<number | 'all'>('all');
  const [gainMode, setGainMode] = useState<'period' | 'alltime'>('period');

  const openFilter = useCallback(() => {
    if (isDesktop && filterBtnRef.current) {
      filterBtnRef.current.measure((_fx, _fy, _w, h, _px, py) => {
        const screenH = Dimensions.get('window').height;
        const spaceBelow = screenH - py - h;
        const spaceAbove = py;
        const maxH = Math.min(400, Math.max(spaceBelow, spaceAbove) - 16);
        if (spaceBelow >= spaceAbove) {
          setFilterPopoverPos({ top: py + h + 4, right: 16, maxHeight: maxH });
        } else {
          setFilterPopoverPos({ bottom: screenH - py + 4, right: 16, maxHeight: maxH });
        }
        setFilterVisible(true);
      });
    } else {
      setFilterVisible(true);
    }
  }, [isDesktop]);

  // Fetch reference prices for the selected timespan
  useEffect(() => {
    if (timespan === 'since_buy' || timespan === 'daily' || holdings.length === 0) {
      setRefPrices({});
      return;
    }
    const rangeMap: Record<string, [string, string]> = {
      week: ['5d', '1d'], month: ['1mo', '1d'], ytd: ['ytd', '1d'], year: ['1y', '1wk'],
    };
    const [range, interval] = rangeMap[timespan] ?? ['1mo', '1d'];
    let cancelled = false;
    Promise.all(
      holdings.map(async (h) => {
        if (h.symbol.startsWith('CASH_')) return { symbol: h.symbol, price: h.avgPrice };
        try {
          const data = await getHistoricalData(h.symbol, range, interval);
          return { symbol: h.symbol, price: data.prices[0] ?? null };
        } catch { return { symbol: h.symbol, price: null }; }
      }),
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, number> = {};
      results.forEach(({ symbol, price }) => { if (price !== null) map[symbol] = price; });
      setRefPrices(map);
    });
    return () => { cancelled = true; };
  }, [timespan, holdings]);

  // Fetch dividends
  useEffect(() => {
    if (holdings.length === 0) return;
    setDivLoading(true);
    const nowTs = Date.now() / 1000;
    const nowYear = new Date().getFullYear();
    Promise.all(
      holdings.map(async (h) => {
        if (h.symbol.startsWith('CASH_')) return [];
        try {
          const [divs, fhDeclared, divHistory] = await Promise.all([
            getDividends(h.symbol).catch(() => [] as { amount: number; date: number }[]),
            getDeclaredDividends(h.symbol).catch(() => [] as { amount: number; date: number }[]),
            getDividendHistory(h.symbol).catch(() => [] as { exDate: number; payDate: number | null; amount: number }[]),
          ]);
          const getPayDate = (exDate: number): number | null => {
            const match = divHistory.find(d => Math.abs(d.exDate - exDate) < 3 * 86400);
            return match?.payDate ?? null;
          };
          const sorted = [...divs].sort((a, b) => b.date - a.date);
          const freqDays = deriveFreqDays(sorted);

          const buyTxs = transactions.filter((t) => t.symbol === h.symbol && t.type === 'buy');
          const sellTxs = transactions.filter((t) => t.symbol === h.symbol && t.type === 'sell');
          const firstBuyTs = buyTxs.length > 0
            ? Math.min(...buyTxs.map((t) => new Date(t.date).getTime() / 1000))
            : new Date(h.purchaseDate).getTime() / 1000;

          const sharesAtDate = (ts: number): number => {
            if (buyTxs.length === 0) return ts >= firstBuyTs ? h.shares : 0;
            const bought = buyTxs.filter((t) => new Date(t.date).getTime() / 1000 <= ts).reduce((s, t) => s + t.shares, 0);
            const sold = sellTxs.filter((t) => new Date(t.date).getTime() / 1000 <= ts).reduce((s, t) => s + t.shares, 0);
            return Math.max(0, bought - sold);
          };

          const currentShares = sharesAtDate(nowTs);
          const paid: DivEntry[] = sorted
            .filter((d) => d.date >= firstBuyTs && d.date <= nowTs)
            .map((d) => {
              const sharesOwned = sharesAtDate(d.date);
              if (sharesOwned <= 0) return null;
              return { symbol: h.symbol, name: h.name, shares: sharesOwned, amount: d.amount, total: sharesOwned * d.amount, timestamp: d.date, payDate: getPayDate(d.date), year: new Date(d.date * 1000).getFullYear(), status: 'paid' as DivStatus };
            }).filter(Boolean) as DivEntry[];

          const declared: DivEntry[] = fhDeclared.filter((d) => d.date > nowTs).map((d) => ({
            symbol: h.symbol, name: h.name, shares: currentShares, amount: d.amount, total: currentShares * d.amount,
            timestamp: d.date, payDate: getPayDate(d.date), year: new Date(d.date * 1000).getFullYear(), status: 'declared' as DivStatus,
          }));
          const declaredTimes = declared.map((d) => d.timestamp);

          const forecasted: DivEntry[] = [];
          if (freqDays && sorted.length > 0 && currentShares > 0) {
            const freqSec = freqDays * 86400;
            const horizon = new Date(nowYear + 2, 11, 31, 23, 59, 59).getTime() / 1000;
            const lastPastDiv = sorted.find((d) => d.date <= nowTs);
            if (lastPastDiv) {
              let nextTs = lastPastDiv.date + freqSec;
              while (nextTs <= nowTs) nextTs += freqSec;
              while (nextTs <= horizon) {
                if (!declaredTimes.some((dt) => Math.abs(dt - nextTs) < freqSec * 0.4)) {
                  forecasted.push({ symbol: h.symbol, name: h.name, shares: currentShares, amount: lastPastDiv.amount, total: currentShares * lastPastDiv.amount, timestamp: nextTs, payDate: nextTs + 7 * 86400, year: new Date(nextTs * 1000).getFullYear(), status: 'forecasted' });
                }
                nextTs += freqSec;
              }
            }
          }
          return [...declared, ...forecasted, ...paid];
        } catch { return []; }
      }),
    ).then((results) => {
      const flat = results.flat().sort((a, b) => b.timestamp - a.timestamp);
      setDivEntries(flat);
    }).finally(() => setDivLoading(false));
  }, [holdings, transactions]);

  // Fetch quotes on mount
  useEffect(() => {
    if (holdings.length === 0) { setQuotesLoading(false); return; }
    setQuotesLoading(true);
    Promise.all(
      holdings.map(async (h) => {
        try { return { symbol: h.symbol, q: await getStockQuote(h.symbol) }; }
        catch { return { symbol: h.symbol, q: null }; }
      }),
    ).then((results) => {
      const map: Record<string, StockQuote | null> = {};
      results.forEach(({ symbol, q }) => { map[symbol] = q; });
      setQuotes(map);
    }).finally(() => setQuotesLoading(false));
  }, [holdings]);

  // Build portfolio chart
  useEffect(() => {
    if (holdings.length === 0) return;
    setChartLoading(true);
    setFullData({ prices: [], timestamps: [] });
    setChartVisiblePrices([]);

    const earliestPurchaseTs = Math.floor(
      new Date(holdings.reduce((min, h) => (h.purchaseDate < min ? h.purchaseDate : min), holdings[0].purchaseDate)).getTime() / 1000,
    );
    const { range, interval } = CHART_PARAMS[selectedPeriod];

    Promise.all([
      Promise.all(holdings.map(async (h) => {
        if (h.symbol.startsWith('CASH_')) return { h, d: { prices: [] as number[], timestamps: [] as number[] } };
        try { return { h, d: await getHistoricalData(h.symbol, range, interval) }; }
        catch { return { h, d: { prices: [] as number[], timestamps: [] as number[] } }; }
      })),
      getHistoricalData('SPY', range, interval).catch(() => ({ prices: [] as number[], timestamps: [] as number[] })),
    ]).then(([results, spyData]) => {
      const ref = results.reduce((best, r) => r.d.timestamps.length > best.d.timestamps.length ? r : best);
      let filterTs = earliestPurchaseTs;
      if (interval === '1mo') {
        const d = new Date(earliestPurchaseTs * 1000);
        filterTs = Math.floor(new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000);
      }
      let refTs = ref.d.timestamps.filter((ts) => ts >= filterTs);
      if (interval === '1h' || interval === '5m') {
        refTs = refTs.filter((ts) => {
          const d = new Date(ts * 1000);
          const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
          return utcMin >= 13 * 60 + 30 && utcMin <= 20 * 60 + 30;
        });
      }
      if (refTs.length < 2) return;

      const dataRangeSec = (() => {
        if (range === 'max') return Infinity;
        const n = parseInt(range);
        if (range.endsWith('d')) return n * 86400;
        if (range.endsWith('mo')) return n * 30 * 86400;
        if (range.endsWith('y')) return n * 365 * 86400;
        return Infinity;
      })();
      if (refTs[0] > earliestPurchaseTs && (refTs[0] - earliestPurchaseTs) <= dataRangeSec) {
        refTs = [earliestPurchaseTs, ...refTs];
      }

      const portfolioPrices = refTs.map((ts) =>
        results.reduce((sum, { h, d }) => {
          const symTxs = transactions.filter((t) => t.symbol === h.symbol).sort((a, b) => a.date.localeCompare(b.date));
          let sharesAtTs = 0;
          for (const t of symTxs) {
            if (new Date(t.date).getTime() / 1000 > ts) break;
            sharesAtTs += t.type === 'buy' ? t.shares : -t.shares;
          }
          sharesAtTs = Math.max(0, sharesAtTs);
          if (symTxs.length === 0) {
            sharesAtTs = ts >= Math.floor(new Date(h.purchaseDate).getTime() / 1000) ? h.shares : 0;
          }
          if (sharesAtTs <= 0) return sum;
          if (d.timestamps.length === 0) return sum + h.avgPrice * sharesAtTs;
          let closest = 0;
          let minDiff = Math.abs(d.timestamps[0] - ts);
          for (let i = 1; i < d.timestamps.length; i++) {
            const diff = Math.abs(d.timestamps[i] - ts);
            if (diff < minDiff) { minDiff = diff; closest = i; }
          }
          const barPrice = d.prices[closest] ?? h.avgPrice;
          return sum + barPrice * sharesAtTs;
        }, 0),
      );

      let firstValid = portfolioPrices.findIndex((p) => p > 0);
      if (firstValid === -1) firstValid = 0;
      const combinedPrices = portfolioPrices.slice(firstValid);
      const combinedTimestamps = refTs.slice(firstValid);
      setFullData({ prices: combinedPrices, timestamps: combinedTimestamps });

      // SPY benchmark overlay
      if (spyData.timestamps.length > 0 && combinedPrices.length > 0) {
        const spyAt = (ts: number) => {
          let c = 0; let md = Math.abs(spyData.timestamps[0] - ts);
          for (let i = 1; i < spyData.timestamps.length; i++) {
            const diff = Math.abs(spyData.timestamps[i] - ts);
            if (diff < md) { md = diff; c = i; }
          }
          return spyData.prices[c] ?? 0;
        };
        // Compute invested amount at each combined timestamp for benchmark sizing
        const totalInvested = holdings.reduce((s, h) => s + h.avgPrice * h.shares, 0);
        const benchmarkRaw = combinedTimestamps.map((ts) => spyAt(ts));
        if (benchmarkRaw[0] > 0) {
          const spyOverlay = benchmarkRaw.map((p) => (p / benchmarkRaw[0]) * totalInvested);
          setSpxOverlay(spyOverlay);
        }
      }
    }).catch(() => {}).finally(() => setChartLoading(false));
  }, [selectedPeriod, holdings, transactions]);

  // Portfolio value calculations
  const totalValue = useMemo(() =>
    holdings.reduce((sum, h) => {
      const q = quotes[h.symbol];
      const price = q ? effectivePrice(q) : h.avgPrice;
      return sum + price * h.shares;
    }, 0),
    [holdings, quotes],
  );

  const totalCost = useMemo(() =>
    holdings.reduce((sum, h) => sum + h.avgPrice * h.shares, 0),
    [holdings],
  );

  const totalGain = totalValue - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
  const isPositive = totalGain >= 0;

  // Period gain (chart-based)
  const periodGain = useMemo(() => {
    if (fullData.prices.length === 0) return { gain: totalGain, pct: totalGainPct };
    const nPoints = pointsForPeriod(fullData.timestamps, selectedPeriod);
    const startIdx = nPoints >= fullData.prices.length ? 0 : fullData.prices.length - nPoints;
    const ref = fullData.prices[startIdx] ?? fullData.prices[0];
    const cur = crosshairVisible ? chPrice : totalValue;
    const g = cur - ref;
    const pct = ref > 0 ? (g / ref) * 100 : 0;
    return { gain: g, pct };
  }, [fullData, selectedPeriod, totalValue, totalGain, totalGainPct, crosshairVisible, chPrice]);

  const periodPos = periodGain.gain >= 0;

  // Holding reference price based on timespan
  const holdingRefPrice = useCallback((h: Holding) => {
    if (timespan === 'since_buy') return h.avgPrice;
    if (timespan === 'daily') {
      const q = quotes[h.symbol];
      if (h.purchaseDate) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        if (new Date(h.purchaseDate + 'T00:00:00') >= yesterday) return h.avgPrice;
      }
      return q?.pc ?? h.avgPrice;
    }
    if (refPrices[h.symbol] != null) {
      const now = new Date();
      const cutoffs: Record<string, Date> = {
        year:  new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()),
        ytd:   new Date(now.getFullYear(), 0, 1),
        month: new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()),
        week:  new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      };
      const refCutoff = cutoffs[timespan] ?? cutoffs.month;
      if (h.purchaseDate && new Date(h.purchaseDate) > refCutoff) return h.avgPrice;
      return refPrices[h.symbol];
    }
    return h.avgPrice;
  }, [timespan, quotes, refPrices]);

  // Holdings with enriched data (timespan-aware gain)
  const enrichedHoldings = useMemo(() =>
    holdings.map((h) => {
      const q = quotes[h.symbol];
      const currentPrice = q ? effectivePrice(q) : h.avgPrice;
      const currentValue = currentPrice * h.shares;
      const refPrice = holdingRefPrice(h);
      const gain = (currentPrice - refPrice) * h.shares;
      const gainPct = refPrice > 0 ? ((currentPrice - refPrice) / refPrice) * 100 : 0;
      const allTimeGain = currentValue - h.avgPrice * h.shares;
      const allTimeGainPct = h.avgPrice > 0 ? ((currentPrice - h.avgPrice) / h.avgPrice) * 100 : 0;
      const allocPct = totalValue > 0 ? currentValue / totalValue : 0;
      return { ...h, currentPrice, currentValue, gain, gainPct, allTimeGain, allTimeGainPct, allocPct };
    }),
    [holdings, quotes, holdingRefPrice, totalValue],
  );

  // Sorted holdings
  const sortedHoldings = useMemo(() => {
    return [...enrichedHoldings].sort((a, b) => {
      if (sortBy === 'relative') return b.gainPct - a.gainPct;
      if (sortBy === 'absolute') return b.gain - a.gain;
      return b.currentValue - a.currentValue;
    });
  }, [enrichedHoldings, sortBy]);

  // Allocation bars (by position size, top 10 + other)
  const allocItems = useMemo(() => {
    const byValue = [...enrichedHoldings].sort((a, b) => b.currentValue - a.currentValue);
    const significant = byValue.filter(h => h.allocPct >= 0.01);
    const small = byValue.filter(h => h.allocPct < 0.01);
    const top = significant.map((h, i) => ({
      symbol: h.symbol, pct: h.allocPct, color: ALLOC_COLORS[i % ALLOC_COLORS.length], value: h.currentValue,
    }));
    const otherPct = small.reduce((s, h) => s + h.allocPct, 0);
    const otherVal = small.reduce((s, h) => s + h.currentValue, 0);
    if (otherPct > 0.001) top.push({ symbol: 'Other', pct: otherPct, color: '#475569', value: otherVal });
    return top;
  }, [enrichedHoldings]);

  const filterLabel = `${({ since_buy: 'Since buy', year: 'Year', ytd: 'YTD', month: 'Month', week: 'Week', daily: 'Daily' } as Record<Timespan, string>)[timespan]} · ${({ relative: '%', absolute: '$', position: '≡' } as Record<SortMode, string>)[sortBy]}`;

  // ---- Dividend calendar computed data ----
  const nowYear = new Date().getFullYear();
  const divAllSymbols = useMemo(() => Array.from(new Set(divEntries.map(e => e.symbol))), [divEntries]);
  const divColorOf = useCallback((sym: string) => DIV_COLORS[divAllSymbols.indexOf(sym) % DIV_COLORS.length], [divAllSymbols]);
  const divYears = useMemo(() => Array.from(new Set(divEntries.map(e => e.year))).sort((a, b) => a - b), [divEntries]);

  // By month (specific year selected)
  const divByMonth = useMemo(() => {
    const year = selectedDivYear === 'all' ? nowYear : selectedDivYear;
    const yearEntries = divEntries.filter(e => e.year === year);
    return Array.from({ length: 12 }, (_, m) => {
      const all = yearEntries.filter(e => new Date((e.payDate ?? e.timestamp) * 1000).getMonth() === m);
      const bySymbol = Array.from(
        all.reduce((map, e) => {
          const cur = map.get(e.symbol) ?? { paid: 0, forecasted: 0 };
          if (e.status === 'paid') cur.paid += e.total; else cur.forecasted += e.total;
          map.set(e.symbol, cur);
          return map;
        }, new Map<string, { paid: number; forecasted: number }>()),
      ).map(([symbol, v]) => ({ symbol, paid: v.paid, forecasted: v.forecasted, total: v.paid + v.forecasted }))
        .sort((a, b) => a.total - b.total);
      return { total: bySymbol.reduce((s, v) => s + v.total, 0), bySymbol };
    });
  }, [divEntries, selectedDivYear, nowYear]);

  // By year (All view)
  const divByYear = useMemo(() => divYears.map(y => {
    const all = divEntries.filter(e => e.year === y);
    const bySymbol = Array.from(
      all.reduce((map, e) => {
        const cur = map.get(e.symbol) ?? { paid: 0, forecasted: 0 };
        if (e.status === 'paid') cur.paid += e.total; else cur.forecasted += e.total;
        map.set(e.symbol, cur);
        return map;
      }, new Map<string, { paid: number; forecasted: number }>()),
    ).map(([symbol, v]) => ({ symbol, paid: v.paid, forecasted: v.forecasted, total: v.paid + v.forecasted }))
      .sort((a, b) => a.total - b.total);
    return { year: y, total: bySymbol.reduce((s, v) => s + v.total, 0), bySymbol, symbols: all.map(e => e.symbol) };
  }), [divEntries, divYears]);

  const divBarMaxH = 72;
  const divMaxVal = selectedDivYear === 'all'
    ? Math.max(...divByYear.map(y => y.total), 0.01)
    : Math.max(...divByMonth.map(m => m.total), 0.01);

  const divTTM = useMemo(() => {
    const cutoff = Date.now() / 1000 - 365 * 86400;
    return divEntries.filter(e => e.status === 'paid' && e.timestamp >= cutoff).reduce((s, e) => s + e.total, 0);
  }, [divEntries]);

  const divUpcoming = useMemo(() => {
    const nowTs = Date.now() / 1000;
    const horizonTs = nowTs + 180 * 86400;
    return divEntries
      .filter(e => e.status !== 'paid' && e.timestamp >= nowTs && e.timestamp <= horizonTs)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, 12);
  }, [divEntries]);

  const divSelectedTotal = selectedDivYear === 'all'
    ? divByYear.reduce((s, y) => s + y.total, 0)
    : divByMonth.reduce((s, m) => s + m.total, 0);
  const divSelectedPaid = selectedDivYear === 'all'
    ? divByYear.reduce((s, y) => s + y.bySymbol.reduce((a, b) => a + b.paid, 0), 0)
    : divByMonth.reduce((s, m) => s + m.bySymbol.reduce((a, b) => a + b.paid, 0), 0);
  const divSelectedFcast = divSelectedTotal - divSelectedPaid;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{name}</Text>
        <Text style={styles.headerSub}>Shared portfolio · read-only</Text>
      </View>

      {/* Hero value */}
      <View style={styles.heroSection}>
        {crosshairVisible && chDateStr
          ? <Text style={styles.heroLabel}>{chDateStr}</Text>
          : null
        }
        <BlurValue hidden={hideValues}>
          <Text style={styles.heroValue}>
            {quotesLoading ? '—' : fmtMoney(crosshairVisible ? chPrice : totalValue)}
          </Text>
        </BlurValue>
        {(() => {
          const g = gainMode === 'alltime' ? totalGain : periodGain.gain;
          const gPct = gainMode === 'alltime' ? totalGainPct : periodGain.pct;
          const pos = g >= 0;
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              <BlurValue hidden={hideValues} tint={pos ? 'green' : 'red'}>
                <Text style={[styles.heroGain, { color: pos ? '#22c55e' : '#ef4444' }]}>
                  {pos ? '+' : ''}{fmtMoney(g)} ({pos ? '+' : ''}{gPct.toFixed(2)}%)
                </Text>
              </BlurValue>
              {gainMode === 'period' && <Text style={styles.heroLabel}>this period</Text>}
              <TouchableOpacity
                onPress={() => setGainMode(m => m === 'period' ? 'alltime' : 'period')}
                style={{ backgroundColor: gainMode === 'alltime' ? '#23282d' : '#1b2023', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: gainMode === 'alltime' ? '#4b5563' : '#303841' }}
              >
                <Text style={{ color: gainMode === 'alltime' ? '#f5f7fa' : '#8f99aa', fontSize: 10, fontWeight: '700' }}>
                  {gainMode === 'alltime' ? 'Performance' : 'Value'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })()}
        <BlurValue hidden={hideValues}>
          <Text style={styles.heroCost}>
            Invested: {fmtMoney(totalCost)} · All-time: {isPositive ? '+' : ''}{fmtMoney(totalGain)} ({isPositive ? '+' : ''}{totalGainPct.toFixed(2)}%)
          </Text>
        </BlurValue>
      </View>

      {/* Period selector */}
      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.periodBtn, selectedPeriod === p && styles.periodBtnActive]}
            onPress={() => setSelectedPeriod(p)}
          >
            <Text style={[styles.periodLabel, selectedPeriod === p && styles.periodLabelActive]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Desktop: chart (left) + stats panel (right) */}
      {isDesktop ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 0, paddingHorizontal: 0 }}>
          {/* Chart — left side */}
          <View style={{ flex: 3, minWidth: 0 }}>
            <View style={styles.chartContainer}>
              {chartLoading && fullData.prices.length === 0
                ? <ActivityIndicator color="#6366f1" style={{ marginVertical: 60 }} />
                : (
                  <InteractiveChart
                    key={`${selectedPeriod}-${fullData.timestamps.length}`}
                    prices={fullData.prices}
                    timestamps={fullData.timestamps}
                    initialPoints={pointsForPeriod(fullData.timestamps, selectedPeriod)}
                    color={periodPos ? '#22c55e' : '#ef4444'}
                    overlayPrices={spxOverlay.length === fullData.prices.length ? spxOverlay : undefined}
                    loading={chartLoading}
                    onVisibleChange={(vp) => setChartVisiblePrices(vp)}
                    onCrosshairChange={(visible, price, ts) => {
                      setCrosshairVisible(visible);
                      setChPrice(price);
                      setChDateStr(visible && ts ? new Date(ts * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
                    }}
                  />
                )
              }
              {spxOverlay.length > 0 && (
                <View style={styles.chartLegend}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: periodPos ? '#22c55e' : '#ef4444' }]} />
                    <Text style={styles.legendLabel}>Portfolio</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: 'rgba(148,163,184,0.7)' }]} />
                    <Text style={styles.legendLabel}>S&P 500</Text>
                  </View>
                </View>
              )}
            </View>

            {/* Positions — desktop, same width as chart */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitleInline}>Positions ({holdings.length})</Text>
              <View ref={filterBtnRef}>
                <TouchableOpacity style={styles.filterPill} onPress={openFilter}>
                  <Text style={styles.filterPillText}>{filterLabel}</Text>
                  <Ionicons name="chevron-down" size={10} color="#8f99aa" />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.holdingsTable}>
              <View style={styles.holdingRow}>
                <Text style={[styles.holdingCell, { flex: 2, color: '#64748b' }]}>Symbol</Text>
                <Text style={[styles.holdingCell, { flex: 1.5, color: '#64748b', textAlign: 'right' }]}>Value</Text>
                <Text style={[styles.holdingCell, { flex: 1.5, color: '#64748b', textAlign: 'right' }]}>Gain</Text>
                <Text style={[styles.holdingCell, { flex: 1, color: '#64748b', textAlign: 'right' }]}>Weight</Text>
              </View>
              {quotesLoading
                ? <ActivityIndicator color="#6366f1" style={{ marginVertical: 24 }} />
                : sortedHoldings.map((h) => (
                  <View key={h.symbol} style={styles.holdingRow}>
                    <View style={{ flex: 2 }}>
                      <Text style={styles.holdingSymbol}>{h.symbol}</Text>
                      <Text style={styles.holdingName} numberOfLines={1}>{h.name}</Text>
                    </View>
                    <View style={{ flex: 1.5, alignItems: 'flex-end' }}>
                      <BlurValue hidden={hideValues}>
                        <Text style={styles.holdingCell}>{fmtMoney(h.currentValue)}</Text>
                      </BlurValue>
                      <Text style={styles.holdingSubtext}>{h.shares} × {fmtMoney(h.currentPrice)}</Text>
                    </View>
                    <View style={{ flex: 1.5, alignItems: 'flex-end' }}>
                      <BlurValue hidden={hideValues} tint={h.gain >= 0 ? 'green' : 'red'}>
                        <Text style={[styles.holdingCell, { color: h.gain >= 0 ? '#22c55e' : '#ef4444' }]}>
                          {h.gain >= 0 ? '+' : ''}{fmtMoney(h.gain)}
                        </Text>
                      </BlurValue>
                      <Text style={[styles.holdingSubtext, { color: h.gain >= 0 ? '#22c55e' : '#ef4444' }]}>
                        {h.gain >= 0 ? '+' : ''}{h.gainPct.toFixed(2)}%
                      </Text>
                    </View>
                    <Text style={[styles.holdingCell, { flex: 1, textAlign: 'right' }]}>
                      {(h.allocPct * 100).toFixed(1)}%
                    </Text>
                  </View>
                ))
              }
            </View>

            <View style={{ height: 32 }} />

            {/* Dividend calendar — desktop */}
            <Text style={styles.sectionTitle}>Dividend calendar</Text>
            {divLoading
              ? <ActivityIndicator color="#6366f1" style={{ marginVertical: 20 }} />
              : divEntries.length === 0
                ? <Text style={[styles.heroLabel, { marginHorizontal: 20, marginBottom: 8 }]}>No dividend data available.</Text>
                : (
                  <View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 6, paddingBottom: 8 }}>
                      <TouchableOpacity
                        onPress={() => setSelectedDivYear('all')}
                        style={[styles.yearTab, selectedDivYear === 'all' && styles.yearTabActive]}
                      >
                        <Text style={[styles.yearTabTxt, selectedDivYear === 'all' && styles.yearTabTxtActive]}>All</Text>
                      </TouchableOpacity>
                      {divYears.map(y => (
                        <TouchableOpacity
                          key={y}
                          onPress={() => setSelectedDivYear(y)}
                          style={[styles.yearTab, selectedDivYear === y && styles.yearTabActive]}
                        >
                          <Text style={[styles.yearTabTxt, selectedDivYear === y && styles.yearTabTxtActive]}>{y}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 12 }}>
                      {divSelectedTotal > 0 && (
                        <View style={styles.statCard}>
                          <Text style={styles.statLabel}>{selectedDivYear === 'all' ? 'All-time' : String(selectedDivYear)}</Text>
                          <BlurValue hidden={hideValues}><Text style={styles.statValue}>${fmtMoney(divSelectedTotal)}</Text></BlurValue>
                        </View>
                      )}
                      {divSelectedPaid > 0 && (
                        <View style={styles.statCard}>
                          <Text style={styles.statLabel}>Paid</Text>
                          <BlurValue hidden={hideValues} tint="green"><Text style={[styles.statValue, { color: '#22c55e' }]}>${fmtMoney(divSelectedPaid)}</Text></BlurValue>
                        </View>
                      )}
                      {divSelectedFcast > 0 && (
                        <View style={styles.statCard}>
                          <Text style={styles.statLabel}>Forecasted</Text>
                          <BlurValue hidden={hideValues}><Text style={[styles.statValue, { color: MUTED }]}>${fmtMoney(divSelectedFcast)}</Text></BlurValue>
                        </View>
                      )}
                      {divTTM > 0 && selectedDivYear === 'all' && (
                        <View style={styles.statCard}>
                          <Text style={styles.statLabel}>TTM</Text>
                          <BlurValue hidden={hideValues}><Text style={styles.statValue}>${fmtMoney(divTTM)}</Text></BlurValue>
                        </View>
                      )}
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 4, paddingBottom: 4 }}>
                      {selectedDivYear === 'all'
                        ? divByYear.map((y) => (
                          <TouchableOpacity key={y.year} onPress={() => setSelectedDivYear(y.year)} style={{ alignItems: 'center', width: 52 }}>
                            <View style={{ height: divBarMaxH, justifyContent: 'flex-end', alignItems: 'center' }}>
                              {y.bySymbol.filter(s => s.total > 0).map(s => {
                                const segH = Math.max((s.total / divMaxVal) * divBarMaxH, 3);
                                const color = divColorOf(s.symbol);
                                if (s.paid === 0) return (
                                  <View key={s.symbol} style={{ width: 28, height: segH, backgroundColor: color + '22', borderWidth: 1, borderColor: color + '55' }} />
                                );
                                return <View key={s.symbol} style={{ width: 28, height: segH, backgroundColor: color }} />;
                              })}
                              {y.total === 0 && <View style={{ width: 2, height: 4, backgroundColor: BORDER, borderRadius: 1 }} />}
                            </View>
                            <Text style={{ color: MUTED, fontSize: 9, marginTop: 4 }}>{y.year}</Text>
                            {y.total > 0 && <BlurValue hidden={hideValues}><Text style={{ color: TEXT, fontSize: 9, fontWeight: '700', marginTop: 1 }}>${fmtMoney(y.total, 0)}</Text></BlurValue>}
                          </TouchableOpacity>
                        ))
                        : divByMonth.map((m, idx) => (
                          <View key={idx} style={{ alignItems: 'center', width: 44 }}>
                            <View style={{ height: divBarMaxH, justifyContent: 'flex-end', alignItems: 'center' }}>
                              {m.bySymbol.filter(s => s.total > 0).map(s => {
                                const segH = Math.max((s.total / divMaxVal) * divBarMaxH, 3);
                                const color = divColorOf(s.symbol);
                                if (s.paid === 0) return (
                                  <View key={s.symbol} style={{ width: 26, height: segH, backgroundColor: color + '22', borderWidth: 1, borderColor: color + '55' }} />
                                );
                                return <View key={s.symbol} style={{ width: 26, height: segH, backgroundColor: color }} />;
                              })}
                              {m.total === 0 && <View style={{ width: 2, height: 4, backgroundColor: BORDER, borderRadius: 1 }} />}
                            </View>
                            <Text style={{ color: MUTED, fontSize: 9, marginTop: 4 }}>{MONTHS_SHORT[idx]}</Text>
                            {m.total > 0 && <BlurValue hidden={hideValues}><Text style={{ color: TEXT, fontSize: 9, fontWeight: '700', marginTop: 1 }}>${fmtMoney(m.total, 0)}</Text></BlurValue>}
                          </View>
                        ))
                      }
                    </ScrollView>
                    {divAllSymbols.length > 0 && (
                      <View style={[styles.allocLegend, { marginTop: 8 }]}>
                        {divAllSymbols.map((sym) => (
                          <View key={sym} style={styles.allocLegendItem}>
                            <View style={[styles.allocDot, { backgroundColor: divColorOf(sym) }]} />
                            <Text style={styles.allocLegendLabel}>{sym}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {divUpcoming.length > 0 && (
                      <>
                        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Upcoming (next 6 months)</Text>
                        <View style={[styles.holdingsTable, { marginTop: 0 }]}>
                          {divUpcoming.map((e, i) => {
                            const dateTs = e.payDate ?? e.timestamp;
                            const dateStr = new Date(dateTs * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                            return (
                              <View key={`${e.symbol}-${e.timestamp}-${i}`} style={styles.holdingRow}>
                                <View style={{ flex: 2 }}>
                                  <Text style={styles.holdingSymbol}>{e.symbol}</Text>
                                  <Text style={styles.holdingSubtext}>{e.status === 'declared' ? 'Declared' : 'Est.'} · {e.shares} shares</Text>
                                </View>
                                <View style={{ flex: 1.5, alignItems: 'flex-end' }}>
                                  <BlurValue hidden={hideValues} tint="green"><Text style={[styles.holdingCell, { color: '#22c55e' }]}>${fmtMoney(e.total)}</Text></BlurValue>
                                  <Text style={styles.holdingSubtext}>${fmtMoney(e.amount, 4)}/sh</Text>
                                </View>
                                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                                  <Text style={styles.holdingCell}>{dateStr}</Text>
                                  <Text style={[styles.holdingSubtext, { color: e.status === 'declared' ? '#22c55e' : MUTED }]}>
                                    {e.status === 'declared' ? 'confirmed' : 'forecast'}
                                  </Text>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      </>
                    )}
                  </View>
                )
            }

            <View style={{ height: 40 }} />
          </View>

          {/* Stats + Donut — right side */}
          <View style={{ flex: 1, minWidth: 260, paddingTop: 12, paddingRight: 16, gap: 10 }}>
            <StatRight label="Total value" value={fmtMoney(totalValue)} blur={hideValues} />
            <StatRight label="Total invested" value={fmtMoney(totalCost)} blur={hideValues} />
            <StatRight
              label="Total gain"
              value={`${isPositive ? '+' : ''}${fmtMoney(totalGain)}`}
              color={isPositive ? '#22c55e' : '#ef4444'}
              blur={hideValues}
            />
            <StatRight
              label="Return"
              value={`${isPositive ? '+' : ''}${totalGainPct.toFixed(2)}%`}
              color={isPositive ? '#22c55e' : '#ef4444'}
            />
            {enrichedHoldings.length > 0 && (() => {
              const best = [...enrichedHoldings].sort((a, b) => b.gainPct - a.gainPct)[0];
              return (
                <StatRight label="Best position" value={best.symbol} sub={`+${best.gainPct.toFixed(1)}%`} subColor="#22c55e" />
              );
            })()}
            {enrichedHoldings.length > 0 && (() => {
              const worst = [...enrichedHoldings].sort((a, b) => a.gainPct - b.gainPct)[0];
              return (
                <StatRight label="Worst position" value={worst.symbol} sub={`${worst.gainPct.toFixed(1)}%`} subColor="#ef4444" />
              );
            })()}
            {/* Donut below stats */}
            <View style={{ alignItems: 'center', marginTop: 8 }}>
              <DonutChart
                items={allocItems.map(a => ({ symbol: a.symbol, pct: a.pct, color: a.color }))}
                centerLabel="allocation"
                centerValue={mv(totalValue)}
                centerGain={`${isPositive ? '+' : ''}${totalGainPct.toFixed(1)}%`}
                isPositive={isPositive}
                size={280}
                hideValues={hideValues}
              />
              <View style={[styles.allocLegend, { marginTop: 6 }]}>
                {allocItems.map((item) => (
                  <View key={item.symbol} style={styles.allocLegendItem}>
                    <View style={[styles.allocDot, { backgroundColor: item.color }]} />
                    <Text style={styles.allocLegendLabel}>{item.symbol}</Text>
                    <Text style={styles.allocLegendPct}>{(item.pct * 100).toFixed(1)}%</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>
      ) : (
        /* Mobile: chart full-width, then stats grid below */
        <>
          <View style={styles.chartContainer}>
            {chartLoading && fullData.prices.length === 0
              ? <ActivityIndicator color="#6366f1" style={{ marginVertical: 60 }} />
              : (
                <InteractiveChart
                  key={`${selectedPeriod}-${fullData.timestamps.length}`}
                  prices={fullData.prices}
                  timestamps={fullData.timestamps}
                  initialPoints={pointsForPeriod(fullData.timestamps, selectedPeriod)}
                  color={periodPos ? '#22c55e' : '#ef4444'}
                  overlayPrices={spxOverlay.length === fullData.prices.length ? spxOverlay : undefined}
                  loading={chartLoading}
                  onVisibleChange={(vp) => setChartVisiblePrices(vp)}
                  onCrosshairChange={(visible, price, ts) => {
                    setCrosshairVisible(visible);
                    setChPrice(price);
                    setChDateStr(visible && ts ? new Date(ts * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
                  }}
                />
              )
            }
            {spxOverlay.length > 0 && (
              <View style={styles.chartLegend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: periodPos ? '#22c55e' : '#ef4444' }]} />
                  <Text style={styles.legendLabel}>Portfolio</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: 'rgba(148,163,184,0.7)' }]} />
                  <Text style={styles.legendLabel}>S&P 500</Text>
                </View>
              </View>
            )}
          </View>

          {/* Performance stats grid (mobile) */}
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Total value</Text>
              <BlurValue hidden={hideValues}>
                <Text style={styles.statValue}>{fmtMoney(totalValue)}</Text>
              </BlurValue>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Total invested</Text>
              <BlurValue hidden={hideValues}>
                <Text style={styles.statValue}>{fmtMoney(totalCost)}</Text>
              </BlurValue>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Total gain</Text>
              <BlurValue hidden={hideValues} tint={isPositive ? 'green' : 'red'}>
                <Text style={[styles.statValue, { color: isPositive ? '#22c55e' : '#ef4444' }]}>
                  {isPositive ? '+' : ''}{fmtMoney(totalGain)}
                </Text>
              </BlurValue>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Return</Text>
              <Text style={[styles.statValue, { color: isPositive ? '#22c55e' : '#ef4444' }]}>
                {isPositive ? '+' : ''}{totalGainPct.toFixed(2)}%
              </Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Best position</Text>
              {enrichedHoldings.length > 0 && (() => {
                const best = [...enrichedHoldings].sort((a, b) => b.gainPct - a.gainPct)[0];
                return (<><Text style={styles.statValue}>{best.symbol}</Text><Text style={{ color: '#22c55e', fontSize: 11 }}>+{best.gainPct.toFixed(1)}%</Text></>);
              })()}
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Worst position</Text>
              {enrichedHoldings.length > 0 && (() => {
                const worst = [...enrichedHoldings].sort((a, b) => a.gainPct - b.gainPct)[0];
                return (<><Text style={styles.statValue}>{worst.symbol}</Text><Text style={{ color: '#ef4444', fontSize: 11 }}>{worst.gainPct.toFixed(1)}%</Text></>);
              })()}
            </View>
          </View>
          {/* Donut allocation (mobile) */}
          <View style={{ alignItems: 'center', paddingVertical: 16 }}>
            <DonutChart
              items={allocItems.map(a => ({ symbol: a.symbol, pct: a.pct, color: a.color }))}
              centerLabel="allocation"
              centerValue={mv(totalValue)}
              centerGain={`${isPositive ? '+' : ''}${totalGainPct.toFixed(1)}%`}
              isPositive={isPositive}
              size={300}
              hideValues={hideValues}
            />
            <View style={[styles.allocLegend, { marginTop: 8 }]}>
              {allocItems.map((item) => (
                <View key={item.symbol} style={styles.allocLegendItem}>
                  <View style={[styles.allocDot, { backgroundColor: item.color }]} />
                  <Text style={styles.allocLegendLabel}>{item.symbol}</Text>
                  <Text style={styles.allocLegendPct}>{(item.pct * 100).toFixed(1)}%</Text>
                </View>
              ))}
            </View>
          </View>
        </>
      )}

      {!isDesktop && (
        <>
          {/* Holdings positions list — mobile */}

          <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitleInline}>Positions ({holdings.length})</Text>
        <View ref={filterBtnRef}>
          <TouchableOpacity style={styles.filterPill} onPress={openFilter}>
            <Text style={styles.filterPillText}>{filterLabel}</Text>
            <Ionicons name="chevron-down" size={10} color="#8f99aa" />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.holdingsTable}>
        {/* Header */}
        <View style={styles.holdingRow}>
          <Text style={[styles.holdingCell, { flex: 2, color: '#64748b' }]}>Symbol</Text>
          <Text style={[styles.holdingCell, { flex: 1.5, color: '#64748b', textAlign: 'right' }]}>Value</Text>
          <Text style={[styles.holdingCell, { flex: 1.5, color: '#64748b', textAlign: 'right' }]}>Gain</Text>
          <Text style={[styles.holdingCell, { flex: 1, color: '#64748b', textAlign: 'right' }]}>Weight</Text>
        </View>
        {quotesLoading
          ? <ActivityIndicator color="#6366f1" style={{ marginVertical: 24 }} />
          : sortedHoldings.map((h) => (
            <View key={h.symbol} style={styles.holdingRow}>
              <View style={{ flex: 2 }}>
                <Text style={styles.holdingSymbol}>{h.symbol}</Text>
                <Text style={styles.holdingName} numberOfLines={1}>{h.name}</Text>
              </View>
              <View style={{ flex: 1.5, alignItems: 'flex-end' }}>
                <BlurValue hidden={hideValues}>
                  <Text style={styles.holdingCell}>{fmtMoney(h.currentValue)}</Text>
                </BlurValue>
                <Text style={styles.holdingSubtext}>{h.shares} × {fmtMoney(h.currentPrice)}</Text>
              </View>
              <View style={{ flex: 1.5, alignItems: 'flex-end' }}>
                <BlurValue hidden={hideValues} tint={h.gain >= 0 ? 'green' : 'red'}>
                  <Text style={[styles.holdingCell, { color: h.gain >= 0 ? '#22c55e' : '#ef4444' }]}>
                    {h.gain >= 0 ? '+' : ''}{fmtMoney(h.gain)}
                  </Text>
                </BlurValue>
                <Text style={[styles.holdingSubtext, { color: h.gain >= 0 ? '#22c55e' : '#ef4444' }]}>
                  {h.gain >= 0 ? '+' : ''}{h.gainPct.toFixed(2)}%
                </Text>
              </View>
              <Text style={[styles.holdingCell, { flex: 1, textAlign: 'right' }]}>
                {(h.allocPct * 100).toFixed(1)}%
              </Text>
            </View>
          ))
        }
      </View>

      <View style={{ height: 32 }} />

      {/* Dividend calendar */}
      <Text style={styles.sectionTitle}>Dividend calendar</Text>
      {divLoading
        ? <ActivityIndicator color="#6366f1" style={{ marginVertical: 20 }} />
        : divEntries.length === 0
          ? <Text style={[styles.heroLabel, { marginHorizontal: 20, marginBottom: 8 }]}>No dividend data available.</Text>
          : (
            <View>
              {/* Year tabs */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 6, paddingBottom: 8 }}>
                <TouchableOpacity
                  onPress={() => setSelectedDivYear('all')}
                  style={[styles.yearTab, selectedDivYear === 'all' && styles.yearTabActive]}
                >
                  <Text style={[styles.yearTabTxt, selectedDivYear === 'all' && styles.yearTabTxtActive]}>All</Text>
                </TouchableOpacity>
                {divYears.map(y => (
                  <TouchableOpacity
                    key={y}
                    onPress={() => setSelectedDivYear(y)}
                    style={[styles.yearTab, selectedDivYear === y && styles.yearTabActive]}
                  >
                    <Text style={[styles.yearTabTxt, selectedDivYear === y && styles.yearTabTxtActive]}>{y}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Summary pills */}
              <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 12 }}>
                {divSelectedTotal > 0 && (
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>{selectedDivYear === 'all' ? 'All-time' : String(selectedDivYear)}</Text>
                    <BlurValue hidden={hideValues}><Text style={styles.statValue}>${fmtMoney(divSelectedTotal)}</Text></BlurValue>
                  </View>
                )}
                {divSelectedPaid > 0 && (
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Paid</Text>
                    <BlurValue hidden={hideValues} tint="green"><Text style={[styles.statValue, { color: '#22c55e' }]}>${fmtMoney(divSelectedPaid)}</Text></BlurValue>
                  </View>
                )}
                {divSelectedFcast > 0 && (
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Forecasted</Text>
                    <BlurValue hidden={hideValues}><Text style={[styles.statValue, { color: MUTED }]}>${fmtMoney(divSelectedFcast)}</Text></BlurValue>
                  </View>
                )}
                {divTTM > 0 && selectedDivYear === 'all' && (
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>TTM</Text>
                    <BlurValue hidden={hideValues}><Text style={styles.statValue}>${fmtMoney(divTTM)}</Text></BlurValue>
                  </View>
                )}
              </View>

              {/* Bar chart */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 4, paddingBottom: 4 }}>
                {selectedDivYear === 'all'
                  ? divByYear.map((y) => (
                    <TouchableOpacity key={y.year} onPress={() => setSelectedDivYear(y.year)} style={{ alignItems: 'center', width: 52 }}>
                      <View style={{ height: divBarMaxH, justifyContent: 'flex-end', alignItems: 'center' }}>
                        {y.bySymbol.filter(s => s.total > 0).map(s => {
                          const segH = Math.max((s.total / divMaxVal) * divBarMaxH, 3);
                          const color = divColorOf(s.symbol);
                          if (s.paid === 0) return (
                            <View key={s.symbol} style={{ width: 28, height: segH, backgroundColor: color + '22', borderWidth: 1, borderColor: color + '55' }} />
                          );
                          return <View key={s.symbol} style={{ width: 28, height: segH, backgroundColor: color }} />;
                        })}
                        {y.total === 0 && <View style={{ width: 2, height: 4, backgroundColor: BORDER, borderRadius: 1 }} />}
                      </View>
                      <Text style={{ color: MUTED, fontSize: 9, marginTop: 4 }}>{y.year}</Text>
                      {y.total > 0 && <BlurValue hidden={hideValues}><Text style={{ color: TEXT, fontSize: 9, fontWeight: '700', marginTop: 1 }}>${fmtMoney(y.total, 0)}</Text></BlurValue>}
                    </TouchableOpacity>
                  ))
                  : divByMonth.map((m, idx) => (
                    <View key={idx} style={{ alignItems: 'center', width: 44 }}>
                      <View style={{ height: divBarMaxH, justifyContent: 'flex-end', alignItems: 'center' }}>
                        {m.bySymbol.filter(s => s.total > 0).map(s => {
                          const segH = Math.max((s.total / divMaxVal) * divBarMaxH, 3);
                          const color = divColorOf(s.symbol);
                          if (s.paid === 0) return (
                            <View key={s.symbol} style={{ width: 26, height: segH, backgroundColor: color + '22', borderWidth: 1, borderColor: color + '55' }} />
                          );
                          return <View key={s.symbol} style={{ width: 26, height: segH, backgroundColor: color }} />;
                        })}
                        {m.total === 0 && <View style={{ width: 2, height: 4, backgroundColor: BORDER, borderRadius: 1 }} />}
                      </View>
                      <Text style={{ color: MUTED, fontSize: 9, marginTop: 4 }}>{MONTHS_SHORT[idx]}</Text>
                      {m.total > 0 && <BlurValue hidden={hideValues}><Text style={{ color: TEXT, fontSize: 9, fontWeight: '700', marginTop: 1 }}>${fmtMoney(m.total, 0)}</Text></BlurValue>}
                    </View>
                  ))
                }
              </ScrollView>

              {/* Symbol legend */}
              {divAllSymbols.length > 0 && (
                <View style={[styles.allocLegend, { marginTop: 8 }]}>
                  {divAllSymbols.map((sym) => (
                    <View key={sym} style={styles.allocLegendItem}>
                      <View style={[styles.allocDot, { backgroundColor: divColorOf(sym) }]} />
                      <Text style={styles.allocLegendLabel}>{sym}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Upcoming dividends list */}
              {divUpcoming.length > 0 && (
                <>
                  <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Upcoming (next 6 months)</Text>
                  <View style={[styles.holdingsTable, { marginTop: 0 }]}>
                    {divUpcoming.map((e, i) => {
                      const dateTs = e.payDate ?? e.timestamp;
                      const dateStr = new Date(dateTs * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                      return (
                        <View key={`${e.symbol}-${e.timestamp}-${i}`} style={styles.holdingRow}>
                          <View style={{ flex: 2 }}>
                            <Text style={styles.holdingSymbol}>{e.symbol}</Text>
                            <Text style={styles.holdingSubtext}>{e.status === 'declared' ? 'Declared' : 'Est.'} · {e.shares} shares</Text>
                          </View>
                          <View style={{ flex: 1.5, alignItems: 'flex-end' }}>
                            <BlurValue hidden={hideValues} tint="green"><Text style={[styles.holdingCell, { color: '#22c55e' }]}>${fmtMoney(e.total)}</Text></BlurValue>
                            <Text style={styles.holdingSubtext}>${fmtMoney(e.amount, 4)}/sh</Text>
                          </View>
                          <View style={{ flex: 1, alignItems: 'flex-end' }}>
                            <Text style={styles.holdingCell}>{dateStr}</Text>
                            <Text style={[styles.holdingSubtext, { color: e.status === 'declared' ? '#22c55e' : MUTED }]}>
                              {e.status === 'declared' ? 'confirmed' : 'forecast'}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}
            </View>
          )
      }

          <View style={{ height: 40 }} />
        </>
      )}

      {/* Filter modal */}
      <Modal
        visible={filterVisible}
        transparent
        animationType={isDesktop ? 'none' : 'slide'}
        onRequestClose={() => setFilterVisible(false)}
      >
        {isDesktop ? (
          <Pressable style={{ flex: 1 }} onPress={() => setFilterVisible(false)}>
            <Pressable
              style={[
                styles.filterPopover,
                filterPopoverPos.top !== undefined ? { top: filterPopoverPos.top } : {},
                filterPopoverPos.bottom !== undefined ? { bottom: filterPopoverPos.bottom } : {},
                { right: filterPopoverPos.right },
              ]}
              onPress={() => {}}
            >
              <ScrollView style={{ maxHeight: filterPopoverPos.maxHeight }} showsVerticalScrollIndicator={false}>
                <Text style={styles.filterSection}>Timespan</Text>
                {(Object.entries(TIMESPAN_LABELS) as [Timespan, string][]).map(([key, label]) => (
                  <TouchableOpacity key={key} style={[styles.filterRow, { borderBottomColor: '#334155' }]} onPress={() => { setTimespan(key); setFilterVisible(false); }}>
                    <Text style={styles.filterRowTxt}>{label}</Text>
                    <View style={[styles.radioOuter, timespan === key && styles.radioOuterActive]}>
                      {timespan === key && <View style={styles.radioInner} />}
                    </View>
                  </TouchableOpacity>
                ))}
                <Text style={[styles.filterSection, { marginTop: 12 }]}>Sorting</Text>
                {(Object.entries(SORT_LABELS) as [SortMode, [string, string]][]).map(([key, [icon, label]]) => (
                  <TouchableOpacity key={key} style={[styles.filterRow, { borderBottomColor: '#334155' }]} onPress={() => { setSortBy(key); setFilterVisible(false); }}>
                    <Text style={styles.filterRowIcon}>{icon}</Text>
                    <Text style={styles.filterRowTxt}>{label}</Text>
                    <View style={[styles.radioOuter, sortBy === key && styles.radioOuterActive]}>
                      {sortBy === key && <View style={styles.radioInner} />}
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        ) : (
          <Pressable style={styles.modalOverlay} onPress={() => setFilterVisible(false)}>
            <Pressable style={styles.modalSheet} onPress={() => {}}>
              <View style={styles.modalHandle} />
              <Text style={styles.filterSection}>Timespan</Text>
              {(Object.entries(TIMESPAN_LABELS) as [Timespan, string][]).map(([key, label]) => (
                <TouchableOpacity key={key} style={styles.filterRow} onPress={() => { setTimespan(key); setFilterVisible(false); }}>
                  <Text style={styles.filterRowTxt}>{label}</Text>
                  <View style={[styles.radioOuter, timespan === key && styles.radioOuterActive]}>
                    {timespan === key && <View style={styles.radioInner} />}
                  </View>
                </TouchableOpacity>
              ))}
              <Text style={[styles.filterSection, { marginTop: 20 }]}>Sorting</Text>
              {(Object.entries(SORT_LABELS) as [SortMode, [string, string]][]).map(([key, [icon, label]]) => (
                <TouchableOpacity key={key} style={styles.filterRow} onPress={() => { setSortBy(key); setFilterVisible(false); }}>
                  <Text style={styles.filterRowIcon}>{icon}</Text>
                  <Text style={styles.filterRowTxt}>{label}</Text>
                  <View style={[styles.radioOuter, sortBy === key && styles.radioOuterActive]}>
                    {sortBy === key && <View style={styles.radioInner} />}
                  </View>
                </TouchableOpacity>
              ))}
            </Pressable>
          </Pressable>
        )}
      </Modal>
    </ScrollView>
  );
}

const BG      = '#111417';
const SURFACE = '#1b2023';
const BORDER  = '#303841';
const MUTED   = '#8f99aa';
const TEXT    = '#f5f7fa';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  content: { paddingBottom: 40 },

  header: {
    paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { color: TEXT, fontSize: 20, fontWeight: '700' },
  headerSub: { color: MUTED, fontSize: 12, marginTop: 2 },

  heroSection: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  heroLabel: { color: MUTED, fontSize: 13 },
  heroValue: { color: TEXT, fontSize: 34, fontWeight: '700', letterSpacing: -0.5 },
  heroGain: { fontSize: 14, fontWeight: '600' },
  heroCost: { color: MUTED, fontSize: 12, marginTop: 6 },

  periodRow: {
    flexDirection: 'row', paddingHorizontal: 16, gap: 4,
    marginBottom: 4, justifyContent: 'flex-end',
  },
  periodBtn: {
    paddingVertical: 4, paddingHorizontal: 10, alignItems: 'center',
    borderRadius: 6, backgroundColor: SURFACE,
  },
  periodBtnActive: { backgroundColor: '#6366f1' },
  periodLabel: { color: MUTED, fontSize: 12, fontWeight: '600' },
  periodLabelActive: { color: '#fff' },

  chartContainer: { marginBottom: 4 },
  chartLegend: {
    flexDirection: 'row', gap: 16, paddingHorizontal: 20,
    paddingBottom: 8, paddingTop: 4,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 16, height: 2, borderRadius: 1 },
  legendLabel: { color: MUTED, fontSize: 11 },

  statsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    paddingHorizontal: 16, marginTop: 12, marginBottom: 4,
  },
  statCard: {
    backgroundColor: SURFACE, borderRadius: 10, padding: 14,
    flex: 1, minWidth: 100,
  },
  statLabel: { color: MUTED, fontSize: 11, marginBottom: 4 },
  statValue: { color: TEXT, fontSize: 15, fontWeight: '700' },

  sectionTitle: {
    color: MUTED, fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 1, marginHorizontal: 20, marginTop: 24, marginBottom: 12,
  },
  sectionTitleInline: {
    color: MUTED, fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 1,
  },

  allocBar: {
    flexDirection: 'row', height: 10, borderRadius: 6, overflow: 'hidden',
    marginHorizontal: 20, gap: 1,
  },
  allocSegment: { height: 10 },
  allocLegend: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    paddingHorizontal: 20, marginTop: 10,
  },
  allocLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  allocDot: { width: 8, height: 8, borderRadius: 4 },
  allocLegendLabel: { color: TEXT, fontSize: 12 },
  allocLegendPct: { color: MUTED, fontSize: 11, marginLeft: 2 },

  holdingsTable: {
    marginHorizontal: 16, backgroundColor: SURFACE,
    borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: BORDER,
  },
  holdingRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  holdingCell: { color: TEXT, fontSize: 13 },
  holdingSymbol: { color: TEXT, fontSize: 13, fontWeight: '700' },
  holdingName: { color: MUTED, fontSize: 11, marginTop: 1, maxWidth: 100 },
  holdingSubtext: { color: MUTED, fontSize: 11, marginTop: 1 },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, marginTop: 24, marginBottom: 12,
  },
  filterPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#1b2023', borderRadius: 6, paddingHorizontal: 9, paddingVertical: 4,
    borderWidth: 1, borderColor: '#303841',
  },
  filterPillText: { color: '#8f99aa', fontSize: 11, fontWeight: '600' },

  // Filter modal
  filterPopover: {
    position: 'absolute', right: 16,
    backgroundColor: '#1e293b', borderRadius: 12,
    paddingTop: 8, paddingBottom: 8, paddingHorizontal: 12,
    minWidth: 230, shadowColor: '#000', shadowOpacity: 0.5,
    shadowRadius: 20, shadowOffset: { width: 0, height: 6 },
  },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#1e293b', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: '#475569',
    alignSelf: 'center', marginBottom: 16,
  },
  filterSection: {
    color: '#64748b', fontSize: 12, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, marginTop: 12,
  },
  filterRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#0f172a',
  },
  filterRowIcon: { color: '#94a3b8', fontSize: 15, width: 22, fontWeight: '700' },
  filterRowTxt: { flex: 1, color: '#f8fafc', fontSize: 15 },
  radioOuter: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: '#475569',
    justifyContent: 'center', alignItems: 'center',
  },
  radioOuterActive: { borderColor: '#6366f1' },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#6366f1' },

  // Dividend year tabs
  yearTab: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
  },
  yearTabActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  yearTabTxt: { color: MUTED, fontSize: 13, fontWeight: '600' },
  yearTabTxtActive: { color: '#fff' },
});
