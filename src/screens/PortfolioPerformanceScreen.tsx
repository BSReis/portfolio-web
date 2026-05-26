import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator, StyleSheet,
  TouchableOpacity, Dimensions, RefreshControl, Alert,
} from 'react-native';
import { Svg, Rect, Line as SvgLine, Text as SvgText, G } from 'react-native-svg';
import { usePortfolio } from '../context/PortfolioContext';
import { useSettings } from '../context/SettingsContext';
import { getStockQuote, getDividends, getHistoricalData, StockQuote, Dividend, HistoricalData, effectivePrice } from '../services/api';
import { calcFifo } from '../utils/format';
import { BlurValue } from '../utils/blurValue';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── IRR via Newton-Raphson ──────────────────────────────────────────────────
function calculateIRR(flows: { amount: number; yearFrac: number }[]): number | null {
  if (flows.length < 2) return null;
  let r = 0.1;
  for (let iter = 0; iter < 300; iter++) {
    let npv = 0;
    let dnpv = 0;
    for (const cf of flows) {
      if (cf.yearFrac === 0) {
        npv += cf.amount;
        continue;
      }
      const denom = Math.pow(1 + r, cf.yearFrac);
      npv += cf.amount / denom;
      dnpv -= (cf.yearFrac * cf.amount) / (denom * (1 + r));
    }
    if (Math.abs(npv) < 0.01) break;
    if (Math.abs(dnpv) < 1e-10) break;
    r -= npv / dnpv;
    if (r <= -0.999) r = -0.5;
  }
  return isFinite(r) && r > -1 ? r : null;
}

// ── Formatters ────────────────────────────────────────────────────────────
function fmtMoney(v: number, sym: string): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : v > 0 ? '+' : '';
  const fmt = (n: number, d = 2) => {
    const [int, dec] = n.toFixed(d).split('.');
    return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
  };
  if (abs >= 1e9) return `${sign}${fmt(abs / 1e9)}B ${sym}`;
  if (abs >= 1e6) return `${sign}${fmt(abs / 1e6)}M ${sym}`;
  return `${sign}${fmt(abs)} ${sym}`;
}

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

// ── Types ─────────────────────────────────────────────────────────────────
interface YearBar {
  year: number;
  gainPct: number;
  gain: number;
  startValue: number;
  endValue: number;
  buyFlows: number;
}

interface Metrics {
  capitalInvested: number;
  currentValue: number;
  priceGain: number;
  priceGainPct: number;
  brokerageFees: number;
  brokerageFeesPct: number;
  realizedGain: number;
  realizedGainPct: number;
  dividends: number;
  dividendsPct: number;
  totalReturn: number;
  totalReturnPct: number;
  irr: number | null;
  cagr: number | null; // Compound Annual Growth Rate
  cagrYears: number;   // period length used for CAGR
}

// ── Monthly return grid ───────────────────────────────────────────────────
interface MonthCell {
  year: number;
  month: number; // 0-11
  pct: number | null;
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const PAGE_BG = '#0f0f0f';
const SURFACE = '#1b2023';
const SURFACE_ALT = '#23282d';
const BORDER = '#303841';
const TEXT_MUTED = '#8f99aa';
const TEXT_SECONDARY = '#c3cad5';
const TEXT_PRIMARY = '#f5f7fa';

// Modified Dietz: r = (V_end - V_start - F) / (V_start + sum(F_t * W_t))
// W_t = (D - t) / D  where D = calendar days in month
function modDietz(
  vStart: number, vEnd: number,
  flows: { amount: number; dayOfMonth: number }[], daysInMonth: number
): number | null {
  if (vStart <= 0 && flows.length === 0) return null;
  const F = flows.reduce((s, f) => s + f.amount, 0);
  const weightedF = flows.reduce((s, f) => s + f.amount * (daysInMonth - f.dayOfMonth) / daysInMonth, 0);
  const denom = vStart + weightedF;
  if (Math.abs(denom) < 0.01) return null;
  return (vEnd - vStart - F) / denom;
}

// Colour for a heatmap cell
function heatColor(pct: number): string {
  const abs = Math.min(Math.abs(pct), 25); // cap at 25% for colour scale
  const intensity = abs / 25;
  if (pct >= 0) {
    // green: #166534 (dim) → #22c55e (bright)
    const r = Math.round(22  + (34  - 22)  * intensity);
    const g = Math.round(197 + (101 - 197) * (1 - intensity));
    const b = Math.round(94  + (52  - 94)  * (1 - intensity));
    return `rgb(${r},${g},${b})`;
  } else {
    // red: #7f1d1d (dim) → #ef4444 (bright)
    const r = Math.round(127 + (239 - 127) * intensity);
    const g = Math.round(29  + (68  - 29)  * (1 - intensity));
    const b = Math.round(29  + (68  - 29)  * (1 - intensity));
    return `rgb(${r},${g},${b})`;
  }
}

export default function PortfolioPerformanceScreen({ scrollEnabled = true }: { scrollEnabled?: boolean }) {
  const { holdings, transactions, deleteTransaction, activePortfolioId, loading: ctxLoading } = usePortfolio();
  const isCombinedPortfolio = activePortfolioId === '__combined__';
  const { currency, getRateFor, hideValues, applyDividendTax } = useSettings();
  const sym = currency === 'EUR' ? '€' : '$';
  // Helper: get rate for a holding by symbol
  const rateFor = (symbol: string) => {
    const h = holdings.find((x) => x.symbol === symbol);
    return getRateFor(h?.currency ?? 'USD');
  };
  const marketRateFor = (symbol: string) => {
    const h = holdings.find((x) => x.symbol === symbol);
    return getRateFor(quotes[symbol]?.currency ?? h?.currency ?? 'USD');
  };

  const [quotes, setQuotes] = useState<Record<string, StockQuote | null>>({});
  const [divsBySymbol, setDivsBySymbol] = useState<Record<string, Dividend[]>>({});
  const [monthlyData, setMonthlyData] = useState<Record<string, HistoricalData>>({});
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [chartType, setChartType] = useState<'bar' | 'heatmap'>('bar');
  const [chartContainerW, setChartContainerW] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [showAllTx, setShowAllTx] = useState(false);

  // Hoisted: shares held at a given unix-second timestamp
  // Augment real transactions with synthetic buys for holdings that have no transaction history
  const effectiveTxForBars = useMemo(() => {
    const txSymbols = new Set(transactions.map(t => t.symbol));
    const currentYearStart = `${new Date().getFullYear()}-01-01`;
    const synthetic = holdings
      .filter(h => !txSymbols.has(h.symbol) && h.shares > 0)
      .map(h => ({
        id: `__synth_${h.symbol}`,
        symbol: h.symbol,
        type: 'buy' as const,
        shares: h.shares,
        price: h.avgPrice,
        // Use purchaseDate if valid, otherwise fall back to current year start
        date: (h.purchaseDate && h.purchaseDate.length >= 4) ? h.purchaseDate : currentYearStart,
      }));
    return [...transactions, ...synthetic];
  }, [transactions, holdings]);

  const sharesAtDate = useCallback((symbol: string, atUnixSec: number): number => {
    const symTxs = effectiveTxForBars
      .filter((t) => t.symbol === symbol)
      .sort((a, b) => a.date.localeCompare(b.date));
    let held = 0;
    for (const t of symTxs) {
      const tSec = new Date(t.date).getTime() / 1000;
      if (tSec > atUnixSec) break;
      held += t.type === 'buy' ? t.shares : -t.shares;
    }
    return Math.max(0, held);
  }, [effectiveTxForBars]);

  // Fetch current quotes + dividend history
  useEffect(() => {
    if (holdings.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all(
      holdings.map(async (h) => ({
        symbol: h.symbol,
        quote: await getStockQuote(h.symbol),
        divs: await getDividends(h.symbol).catch(() => [] as Dividend[]),
      }))
    ).then((results) => {
      const qmap: Record<string, StockQuote | null> = {};
      const dmap: Record<string, Dividend[]> = {};
      results.forEach(({ symbol, quote, divs }) => {
        qmap[symbol] = quote;
        dmap[symbol] = divs;
      });
      setQuotes(qmap);
      setDivsBySymbol(dmap);
    }).finally(() => setLoading(false));
  }, [holdings, refreshTick]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setMonthlyData({});
    setRefreshTick((t) => t + 1);
    setRefreshing(false);
  }, []);

  // Ref guard: only re-fetch when symbols actually change or user explicitly refreshes
  const lastFetchRef = useRef({ symbols: '', tick: -1 });

  // Fetch monthly historical prices (used by both bar chart and heatmap)
  useEffect(() => {
    const symbolsKey = [...new Set(holdings.map(h => h.symbol))].sort().join(',');
    if (!symbolsKey) return;
    // Skip if already fetched for same symbols+tick
    if (lastFetchRef.current.symbols === symbolsKey && lastFetchRef.current.tick === refreshTick) return;
    lastFetchRef.current = { symbols: symbolsKey, tick: refreshTick };

    setHeatmapLoading(true);
    const symbols = symbolsKey.split(',');
    Promise.all(
      symbols.map(async (symbol) => ({
        symbol,
        data: await getHistoricalData(symbol, 'max', '1mo').catch(() => ({ prices: [], timestamps: [] } as HistoricalData)),
      }))
    ).then((results) => {
      const map: Record<string, HistoricalData> = {};
      results.forEach(({ symbol, data }) => { map[symbol] = data; });
      setMonthlyData(map);
    }).finally(() => setHeatmapLoading(false));
  }, [holdings, refreshTick]);

  // All-time available years — derived from real transactions + synthetic holding buys
  const years = useMemo<number[]>(() => {
    if (effectiveTxForBars.length === 0) return [];
    const txYears = effectiveTxForBars
      .map((t) => new Date(t.date).getFullYear())
      .filter((y) => isFinite(y) && y > 1970 && y <= new Date().getFullYear() + 1);
    if (txYears.length === 0) return [];
    const first = Math.min(...txYears);
    const current = new Date().getFullYear();
    return Array.from({ length: current - first + 1 }, (_, i) => first + i);
  }, [effectiveTxForBars]);

  // ── Monthly return grid for heatmap ─────────────────────────────────────
  const monthGrid = useMemo<MonthCell[]>(() => {
    if (Object.keys(monthlyData).length === 0) return [];
    const symbols = [...new Set(transactions.map((t) => t.symbol))];

    // Build a lookup: symbol → Map<'YYYY-MM' → price>
    const priceMap: Record<string, Map<string, number>> = {};
    symbols.forEach((sym) => {
      const hd = monthlyData[sym];
      if (!hd) return;
      const m = new Map<string, number>();
      hd.timestamps.forEach((ts, i) => {
        const d = new Date(ts * 1000);
        const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2,'0')}`;
        m.set(key, hd.prices[i]);
      });
      priceMap[sym] = m;
    });

    // Collect all year-month keys that appear
    const allKeys = new Set<string>();
    Object.values(priceMap).forEach((m) => m.forEach((_, k) => allKeys.add(k)));
    if (allKeys.size === 0) return [];

    const sortedKeys = Array.from(allKeys).sort();
    const cells: MonthCell[] = [];

    for (let ki = 1; ki < sortedKeys.length; ki++) {
      const prevKey = sortedKeys[ki - 1];
      const currKey = sortedKeys[ki];
      const [ky, km] = currKey.split('-').map(Number);

      // Portfolio value at start of this month = end-of-prev-month prices × shares held
      let vStart = 0;
      let vEnd = 0;
      let flowsDietz: { amount: number; dayOfMonth: number }[] = [];
      let anyPrice = false;

      symbols.forEach((symbol) => {
        const pm = priceMap[symbol];
        if (!pm) return;
        const pPrev = pm.get(prevKey);
        const pCurr = pm.get(currKey);
        if (pPrev == null || pCurr == null) return;
        anyPrice = true;

        // Shares at start/end of month
        const monthStartTs = new Date(ky, km, 1).getTime() / 1000;
        const monthEndTs   = new Date(ky, km + 1, 0, 23, 59, 59).getTime() / 1000;
        const sharesStart  = sharesAtDate(symbol, monthStartTs);
        const sharesEnd    = sharesAtDate(symbol, monthEndTs);

        vStart += pPrev * sharesStart * rateFor(symbol);
        vEnd   += pCurr * sharesEnd   * rateFor(symbol);

        // Net flows (buys positive, sells negative) during this month
        transactions
          .filter((t) => {
            const td = new Date(t.date);
            return t.symbol === symbol && td.getFullYear() === ky && td.getMonth() === km;
          })
          .forEach((t) => {
            const dom = new Date(t.date).getDate();
            const amount = (t.type === 'buy' ? 1 : -1) * t.shares * t.price * rateFor(t.symbol);
            flowsDietz.push({ amount, dayOfMonth: dom });
          });
      });

      if (!anyPrice) continue;

      const daysInMonth = new Date(ky, km + 1, 0).getDate();
      const pct = modDietz(vStart, vEnd, flowsDietz, daysInMonth);
      cells.push({ year: ky, month: km, pct: pct != null ? pct * 100 : null });
    }
    return cells;
  }, [monthlyData, transactions, getRateFor, holdings]);

  // Group monthGrid by year — only from first buy year onwards
  const firstBuyYear = useMemo(() => {
    if (effectiveTxForBars.length === 0) return 0;
    return Math.min(...effectiveTxForBars
      .filter((t) => t.type === 'buy')
      .map((t) => new Date(t.date).getFullYear())
    );
  }, [effectiveTxForBars]);

  const heatmapYears = useMemo(() => {
    const map = new Map<number, (number | null)[]>();
    monthGrid.forEach(({ year, month, pct }) => {
      if (year < firstBuyYear) return; // skip before first purchase
      if (!map.has(year)) map.set(year, Array(12).fill(null));
      map.get(year)![month] = pct;
    });
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0]);
  }, [monthGrid, firstBuyYear]);

  const yearlyBars = useMemo<YearBar[]>(() => {
    const currentYear = new Date().getFullYear();
    const symbols = [...new Set(effectiveTxForBars.filter(t => t.type === 'buy').map(t => t.symbol))];

    // Build price lookup: symbol → Map<'YYYY-M' (0-indexed month) → price>
    const priceMap: Record<string, Map<string, number>> = {};
    symbols.forEach(sym => {
      const hd = monthlyData[sym];
      if (!hd || hd.prices.length === 0) return;
      const m = new Map<string, number>();
      hd.timestamps.forEach((ts, i) => {
        const d = new Date(ts * 1000);
        m.set(`${d.getFullYear()}-${d.getMonth()}`, hd.prices[i]);
      });
      priceMap[sym] = m;
    });

    // Helper: find closest available price at/before a given year-month (0-indexed)
    // Searches backwards up to 3 months (handles missing months / non-trading periods)
    const getPrice = (sym: string, yr: number, mon: number): number | null => {
      const pm = priceMap[sym];
      if (!pm) return null;
      // Search backwards up to 3 months within same year, then try previous year
      for (let delta = 0; delta <= 3; delta++) {
        let y = yr;
        let m = mon - delta;
        if (m < 0) { y = yr - 1; m = 12 + m; }
        const v = pm.get(`${y}-${m}`);
        if (v != null) return v;
      }
      return null;
    };

    return years.map(year => {
      const yearStartUnix = new Date(year, 0, 1).getTime() / 1000;
      const yearEndUnix   = year === currentYear
        ? Date.now() / 1000
        : new Date(year, 11, 31, 23, 59, 59).getTime() / 1000;

      let vStart = 0;
      let vEnd   = 0;
      let flowsDietz: { amount: number; dayOfMonth: number }[] = [];
      let hasPosition = false;
      let buyFlows = 0;

      symbols.forEach(symbol => {
        const sharesStart = sharesAtDate(symbol, yearStartUnix);
        const sharesEnd   = sharesAtDate(symbol, yearEndUnix);
        if (sharesStart === 0 && sharesEnd === 0) return;
        const rate = rateFor(symbol);

        // Start price: December of previous year (with avg-cost fallback if monthlyData not loaded)
        let pStart = getPrice(symbol, year - 1, 11);
        if (pStart == null && sharesStart > 0) {
          // Fallback: use weighted avg cost of all buys before this year
          const priorBuys = effectiveTxForBars.filter(
            t => t.symbol === symbol && t.type === 'buy' &&
            new Date(t.date).getFullYear() < year
          );
          if (priorBuys.length > 0) {
            const totalCost = priorBuys.reduce((s, t) => s + t.shares * t.price, 0);
            const totalSh = priorBuys.reduce((s, t) => s + t.shares, 0);
            if (totalSh > 0) pStart = totalCost / totalSh;
          }
        }
        // End price: December of this year, or current quote for current year
        let pEnd = year === currentYear
          ? (quotes[symbol] ? effectivePrice(quotes[symbol]!) : getPrice(symbol, year, 11))
          : getPrice(symbol, year, 11);
        // Last resort fallback for current year: use avgPrice from holding (shows 0% return but at least renders a bar)
        if (pEnd == null && year === currentYear) {
          const holding = holdings.find(h => h.symbol === symbol);
          if (holding && holding.avgPrice > 0) pEnd = holding.avgPrice;
        }

        // Skip symbol entirely if no end price — avoids pulling buy cost into denominator with 0 value
        if (pEnd == null) return;
        hasPosition = true;

        if (pStart != null && sharesStart > 0) vStart += pStart * sharesStart * rate;
        if (sharesEnd > 0) vEnd += pEnd * sharesEnd * rate;

        // Cash flows (buys/sells) this year
        effectiveTxForBars
          .filter(t => t.symbol === symbol && new Date(t.date).getFullYear() === year)
          .forEach(t => {
            const flowAmount = (t.type === 'buy' ? 1 : -1) * t.shares * t.price * rate;
            if (t.type === 'buy') buyFlows += t.shares * t.price * rate;
            flowsDietz.push({
              amount: flowAmount,
              dayOfMonth: 1, // not used for simple return
            });
          });
      });

      if (!hasPosition) return { year, gain: 0, gainPct: 0, startValue: 0, endValue: 0, buyFlows: 0 };

      // Simple (unweighted) return: avoids time-weighting amplification for late-year buys
      // R = (vEnd - vStart - netBuys) / (vStart + netBuys)
      const netBuys = flowsDietz.reduce((s, f) => s + f.amount, 0);
      const denom = vStart + netBuys;
      const gain = vEnd - vStart - netBuys;
      const gainPct = denom > 0.01 ? (gain / denom) * 100 : 0;
      return { year, gain, gainPct, startValue: vStart, endValue: vEnd, buyFlows };
    });
  }, [years, monthlyData, effectiveTxForBars, holdings, quotes, getRateFor]);

  // ── Aggregate metrics (year-aware) ──────────────────────────────────────
  const metrics = useMemo<Metrics>(() => {
    const now = new Date();
    const isAllTime = selectedYear === 'all';
    const selectedYearBar = !isAllTime
      ? yearlyBars.find((b) => b.year === selectedYear) ?? null
      : null;

    // ── Capital Invested ──
    // All Time → current cost basis of open positions (avgPrice already in display currency)
    // Per year → sum of buy transactions executed in that year
    const scopedBuys = transactions.filter(
      (t) => t.type === 'buy' && (isAllTime || new Date(t.date).getFullYear() === selectedYear)
    );
    const capitalInvested = isAllTime
      ? holdings.reduce((s, h) => s + h.avgPrice * getRateFor(h.currency ?? 'USD') * h.shares, 0)
      : ((selectedYearBar?.startValue ?? 0) + (selectedYearBar?.buyFlows ?? 0));

    // ── Current Value + proportional cost basis (per-year only) ──
    let currentValue: number;
    let proportionalCostBasis: number; // cost of still-held shares attributed to this year
    if (isAllTime) {
      currentValue = holdings.reduce((s, h) => {
        const p = (quotes[h.symbol] ? effectivePrice(quotes[h.symbol]!) : h.avgPrice) * marketRateFor(h.symbol);
        return s + p * h.shares;
      }, 0);
      // For all-time the cost basis is simply avgPrice * shares (already correct)
      proportionalCostBasis = capitalInvested;
    } else {
      currentValue = selectedYearBar?.endValue ?? 0;
      proportionalCostBasis = capitalInvested;
    }

    // ── Price Gain (unrealized) ──
    // priceGain = current market value of still-held year-Y shares minus their cost
    const priceGain = isAllTime
      ? (currentValue - proportionalCostBasis)
      : (selectedYearBar?.gain ?? 0);
    const priceGainPct = isAllTime
      ? (proportionalCostBasis > 0 ? (priceGain / proportionalCostBasis) * 100 : 0)
      : (selectedYearBar?.gainPct ?? 0);

    const scopedTxs = transactions.filter(
      (t) => isAllTime || new Date(t.date).getFullYear() === selectedYear
    );
    const brokerageFees = scopedTxs.reduce(
      (sum, tx) => sum + ((tx.fee ?? 0) * rateFor(tx.symbol)),
      0,
    );
    const brokerageFeesPct = capitalInvested > 0 ? (brokerageFees / capitalInvested) * 100 : 0;

    // ── Realized Gain — FIFO (Portuguese standard) ──
    let realizedGain = 0;
    let realizedCost = 0;
    const sellSymbols = [...new Set(
      transactions
        .filter((t) => t.type === 'sell' && (isAllTime || new Date(t.date).getFullYear() === selectedYear))
        .map((t) => t.symbol)
    )];
    sellSymbols.forEach((symbol) => {
      const cutoff = isAllTime ? '9999-12-31' : `${selectedYear}-12-31`;
      const symTxs = transactions
        .filter((t) => t.symbol === symbol && t.date <= cutoff);
      const { lots } = calcFifo(symTxs);
      // Match sell transactions to FIFO lots consumed
      // realizedGain from calcFifo includes ALL sells up to cutoff — for per-year we need only year sells
      const rate = rateFor(symbol);
      if (isAllTime) {
        realizedGain += calcFifo(symTxs).realizedGain * rate;
        // realizedCost = sum of cost of sold lots (converted)
        lots.forEach(l => {
          const buyTx = symTxs.find(t => t.id === l.txId);
          if (buyTx) realizedCost += l.soldShares * buyTx.price * rate;
        });
      } else {
        // For per-year: replay FIFO up to year-end, compare with FIFO up to year-start
        const yearStartCutoff = `${selectedYear as number}-01-01`;
        const beforeYear = transactions.filter((t) => t.symbol === symbol && t.date < yearStartCutoff);
        const throughYear = transactions.filter((t) => t.symbol === symbol && t.date <= cutoff);
        const gainBefore = calcFifo(beforeYear).realizedGain;
        const gainThrough = calcFifo(throughYear).realizedGain;
        realizedGain += (gainThrough - gainBefore) * rate;
        // realizedCost for the year (converted)
        const lotsBefore = new Map(calcFifo(beforeYear).lots.map(l => [l.txId, l.soldShares]));
        calcFifo(throughYear).lots.forEach(l => {
          const buyTx = throughYear.find(t => t.id === l.txId);
          if (!buyTx) return;
          const soldBefore = lotsBefore.get(l.txId) ?? 0;
          const soldThisYear = l.soldShares - soldBefore;
          if (soldThisYear > 0) realizedCost += soldThisYear * buyTx.price * rate;
        });
      }
    });
    const realizedGainPct = realizedCost > 0 ? (realizedGain / realizedCost) * 100 : 0;

    // ── Dividends ──
    // For each dividend payment, work out shares held at that moment by replaying
    // that symbol's transactions chronologically. This avoids using current shares
    // for historical dividends where the position size was different.

    let dividends = 0;
    const allSymbols = [...new Set(transactions.map((t) => t.symbol))];
    if (isAllTime) {
      allSymbols.forEach((symbol) => {
        // Earliest buy date for this symbol
        const firstBuyTs = transactions
          .filter((t) => t.type === 'buy' && t.symbol === symbol)
          .reduce((min, t) => {
            const ts = new Date(t.date).getTime() / 1000;
            return ts < min ? ts : min;
          }, Infinity);
        (divsBySymbol[symbol] ?? []).forEach((d) => {
          if (d.date >= firstBuyTs) {
            const held = sharesAtDate(symbol, d.date);
            if (held > 0) dividends += applyDividendTax(d.amount) * held * rateFor(symbol);
          }
        });
      });
    } else {
      const yearStart = new Date(selectedYear as number, 0, 1).getTime() / 1000;
      const yearEnd   = new Date((selectedYear as number) + 1, 0, 1).getTime() / 1000;
      allSymbols.forEach((symbol) => {
        (divsBySymbol[symbol] ?? []).forEach((d) => {
          if (d.date >= yearStart && d.date < yearEnd) {
            const held = sharesAtDate(symbol, d.date);
            if (held > 0) dividends += applyDividendTax(d.amount) * held * rateFor(symbol);
          }
        });
      });
    }
    const dividendsPct = capitalInvested > 0 ? (dividends / capitalInvested) * 100 : 0;

    // ── Total Return ──
    const totalReturn = isAllTime ? (priceGain + realizedGain + dividends) : (priceGain + dividends);
    const totalReturnPct = capitalInvested > 0 ? (totalReturn / capitalInvested) * 100 : 0;

    // ── IRR (Money-Weighted Return) ──
    let irr: number | null = null;
    if (isAllTime) {
      // All buys = outflows, all sells = inflows, current portfolio = terminal inflow
      if (transactions.length > 0) {
        const t0ms = Math.min(...transactions.map((t) => new Date(t.date).getTime()));
        const daysTot = (now.getTime() - t0ms) / (1000 * 3600 * 24);
        const irrFlows = transactions.map((t) => ({
          amount: (t.type === 'buy' ? -1 : 1) * t.shares * t.price * rateFor(t.symbol),
          yearFrac: (new Date(t.date).getTime() - t0ms) / (1000 * 3600 * 24 * 365.25),
        }));
        // Dividend inflows — use shares held at each payment date
        allSymbols.forEach((symbol) => {
          const firstBuyTs = transactions
            .filter((t) => t.type === 'buy' && t.symbol === symbol)
            .reduce((min, t) => { const ts = new Date(t.date).getTime() / 1000; return ts < min ? ts : min; }, Infinity);
          (divsBySymbol[symbol] ?? []).forEach((d) => {
            if (d.date >= firstBuyTs) {
              const held = sharesAtDate(symbol, d.date);
              if (held > 0) irrFlows.push({
                amount: applyDividendTax(d.amount) * held * rateFor(symbol),
                yearFrac: (d.date * 1000 - t0ms) / (1000 * 3600 * 24 * 365.25),
              });
            }
          });
        });
        // Terminal: liquidate entire portfolio today
        irrFlows.push({ amount: currentValue, yearFrac: daysTot / 365.25 });
        irr = calculateIRR(irrFlows);
      }
    } else {
      // Per-year: outflows = year-Y buys; terminal = still-held value + realized gain today
      // (simplification: realized proceeds from future sells treated as received today)
      if (scopedBuys.length > 0) {
        const t0ms = Math.min(...scopedBuys.map((t) => new Date(t.date).getTime()));
        const daysTot = (now.getTime() - t0ms) / (1000 * 3600 * 24);
        const irrFlows = scopedBuys.map((t) => ({
          amount: -t.shares * t.price * rateFor(t.symbol),
          yearFrac: (new Date(t.date).getTime() - t0ms) / (1000 * 3600 * 24 * 365.25),
        }));
        // Year-Y dividends as inflows — use shares held at each payment date
        const yearStart = new Date(selectedYear as number, 0, 1).getTime() / 1000;
        const yearEnd   = new Date((selectedYear as number) + 1, 0, 1).getTime() / 1000;
        allSymbols.forEach((symbol) => {
          (divsBySymbol[symbol] ?? []).forEach((d) => {
            if (d.date >= yearStart && d.date < yearEnd) {
              const held = sharesAtDate(symbol, d.date);
              if (held > 0) irrFlows.push({
                amount: applyDividendTax(d.amount) * held * rateFor(symbol),
                yearFrac: (d.date * 1000 - t0ms) / (1000 * 3600 * 24 * 365.25),
              });
            }
          });
        });
        // Terminal: still-held value + booked realized gain (treated as received today)
        const terminal = currentValue + realizedGain;
        if (terminal > 0) {
          irrFlows.push({ amount: terminal, yearFrac: daysTot / 365.25 });
          irr = calculateIRR(irrFlows);
        }
      }
    }

    // ── CAGR (Compound Annual Growth Rate) ──
    // = (1 + totalReturn/capitalInvested)^(1/years) - 1
    // Uses time from first scoped buy to today
    let cagr: number | null = null;
    let cagrYears = 0;
    const cagrBuys = isAllTime ? transactions.filter((t) => t.type === 'buy') : scopedBuys;
    if (cagrBuys.length > 0 && capitalInvested > 0) {
      const firstBuyMs = Math.min(...cagrBuys.map((t) => new Date(t.date).getTime()));
      cagrYears = (now.getTime() - firstBuyMs) / (1000 * 3600 * 24 * 365.25);
      if (cagrYears >= 0.08) { // only meaningful if holding > ~1 month
        const totalGrowth = 1 + totalReturn / capitalInvested;
        if (totalGrowth > 0) {
          cagr = Math.pow(totalGrowth, 1 / cagrYears) - 1;
        }
      }
    }

    return {
      capitalInvested,
      currentValue,
      priceGain,
      priceGainPct,
      brokerageFees,
      brokerageFeesPct,
      realizedGain,
      realizedGainPct,
      dividends,
      dividendsPct,
      totalReturn,
      totalReturnPct,
      irr,
      cagr,
      cagrYears,
    };
  }, [selectedYear, transactions, holdings, quotes, getRateFor, yearlyBars, divsBySymbol, applyDividendTax]);

  // ── Bar chart geometry ───────────────────────────────────────────────────
  const CHART_W = chartContainerW > 0 ? chartContainerW - 16 : SCREEN_WIDTH - 48; // 16 = padding×2
  const CHART_H = 160;
  const BAR_GAP = 6;
  const LABEL_ZONE = 16;   // reserved at bottom for year labels
  const PCT_ZONE   = 12;   // reserved at top for % labels above positive bars
  const ZERO_Y     = PCT_ZONE + (CHART_H - LABEL_ZONE - PCT_ZONE) * 0.45; // zero axis slightly above centre
  const BAR_UP_MAX = ZERO_Y - PCT_ZONE;          // max height for positive bars
  const BAR_DN_MAX = CHART_H - LABEL_ZONE - ZERO_Y - 2; // max height for negative bars
  const count = yearlyBars.length || 1;
  const barW = Math.max(16, Math.min(36, (CHART_W - BAR_GAP * (count + 1)) / count));
  const rawMaxAbs = Math.max(...yearlyBars.map((b) => Math.abs(b.gainPct)).filter(isFinite), 1);
  const maxAbs = isFinite(rawMaxAbs) && rawMaxAbs > 0 ? rawMaxAbs : 1;

  if (loading || ctxLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  if (holdings.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No holdings yet.{'\n'}Add positions to see performance.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      scrollEnabled={scrollEnabled}
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#6366f1"
          colors={['#6366f1']}
        />
      }
    >

      {/* ── Year tab selector + chart toggle ─────────────────────────── */}
      <View style={styles.tabsRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 8 }}
        >
        <TouchableOpacity
          style={[styles.yearTab, selectedYear === 'all' && styles.yearTabActive]}
          onPress={() => setSelectedYear('all')}
        >
          <Text style={[styles.yearTabText, selectedYear === 'all' && styles.yearTabTextActive]}>
            All Time
          </Text>
        </TouchableOpacity>
        {[...years].reverse().map((y) => (
          <TouchableOpacity
            key={y}
            style={[styles.yearTab, selectedYear === y && styles.yearTabActive]}
            onPress={() => setSelectedYear(y)}
          >
            <Text style={[styles.yearTabText, selectedYear === y && styles.yearTabTextActive]}>
              {y}
            </Text>
          </TouchableOpacity>
        ))}
        </ScrollView>
        {/* Chart type toggle button */}
        <TouchableOpacity
          style={styles.chartToggleBtn}
          onPress={() => setChartType(chartType === 'bar' ? 'heatmap' : 'bar')}
        >
          <Ionicons
            name={chartType === 'bar' ? 'grid-outline' : 'bar-chart-outline'}
            size={20}
            color="#94a3b8"
          />
          <Text style={styles.chartToggleLabel}>
            {chartType === 'bar' ? 'Heatmap' : 'Bar'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Chart area ───────────────────────────────────────────────── */}
      {chartType === 'bar' ? (
      <View style={styles.chartContainer}
        onLayout={(e) => setChartContainerW(e.nativeEvent.layout.width)}
      >
        <Svg width={CHART_W} height={CHART_H}>
          {/* Zero axis */}
          <SvgLine
            x1={0} y1={ZERO_Y} x2={CHART_W} y2={ZERO_Y}
            stroke={BORDER} strokeWidth={1}
          />
          {yearlyBars.map((bar, i) => {
            const x = BAR_GAP + i * (barW + BAR_GAP);
            const isPos = bar.gainPct >= 0;
            const maxH = isPos ? BAR_UP_MAX : BAR_DN_MAX;
            const rawH = isFinite(bar.gainPct) ? (Math.abs(bar.gainPct) / maxAbs) * maxH : 0;
            const h = Math.max(8, rawH);
            const isSelected = selectedYear === bar.year;
            const barColor = isSelected
              ? (isPos ? '#22c55e' : '#ef4444')         // selected year: bright
              : selectedYear === 'all'
                ? (isPos ? '#4ade80' : '#f87171')        // all-time: medium bright
                : (isPos ? '#166534' : '#7f1d1d');        // other year focused: dim
            const barY = isPos ? ZERO_Y - h : ZERO_Y;
            return (
              <G key={bar.year}>
                <Rect
                  x={x}
                  y={barY}
                  width={barW}
                  height={h}
                  fill={barColor}
                  rx={3}
                  onPress={() => setSelectedYear(bar.year)}
                />
                {/* Year label — always in the reserved bottom zone */}
                <SvgText
                  x={x + barW / 2}
                  y={CHART_H - 3}
                  fontSize={10}
                  fill={(isSelected || selectedYear === 'all') ? TEXT_PRIMARY : TEXT_MUTED}
                  textAnchor="middle"
                >
                  {String(bar.year).slice(2)}
                </SvgText>
                {/* % label: positive → above bar top; negative → just below zero axis */}
                {Math.abs(bar.gainPct) > 1 && (
                  <SvgText
                    x={x + barW / 2}
                    y={isPos ? ZERO_Y - h - 3 : ZERO_Y + 10}
                    fontSize={10}
                    fill={isPos ? '#22c55e' : '#ef4444'}
                    textAnchor="middle"
                  >
                    {bar.gainPct > 0 ? '+' : ''}{bar.gainPct.toFixed(0)}%
                  </SvgText>
                )}
              </G>
            );
          })}
        </Svg>
      </View>
      ) : (
      /* ── Heatmap ─────────────────────────────────────────────────── */
      <View style={styles.heatmapContainer}>
        {heatmapLoading ? (
          <ActivityIndicator size="small" color="#6366f1" style={{ margin: 24 }} />
        ) : heatmapYears.length === 0 ? (
          <Text style={styles.emptyText}>Loading monthly data…</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ paddingHorizontal: 8 }}>
              {/* Month header row */}
              <View style={styles.hmRow}>
                <View style={styles.hmYearCell} />
                {MONTHS_SHORT.map((m) => (
                  <View key={m} style={styles.hmCell}>
                    <Text style={styles.hmMonthLabel}>{m}</Text>
                  </View>
                ))}
              </View>
              {heatmapYears
                .filter(([year]) => selectedYear === 'all' || year === selectedYear)
                .map(([year, months]) => (
                <View key={year} style={[styles.hmRow, selectedYear === year && { backgroundColor: 'rgba(99,102,241,0.08)', borderRadius: 6 }]}> 
                  <TouchableOpacity style={styles.hmYearCell} onPress={() => setSelectedYear(selectedYear === year ? 'all' : year)}>
                    <Text style={[styles.hmYearLabel, selectedYear === year && { color: '#6366f1', fontWeight: '700' }]}>{year}</Text>
                  </TouchableOpacity>
                  {months.map((pct, mi) => (
                    <View
                      key={mi}
                      style={[
                        styles.hmCell,
                        { backgroundColor: pct != null ? heatColor(pct) : SURFACE_ALT },
                      ]}
                    >
                      {pct != null && (
                        <Text style={[
                          styles.hmCellText,
                          { fontSize: Math.abs(pct) >= 10 ? 8 : 9 },
                        ]}>
                          {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        )}
      </View>
      )}

      {/* ── Capital section ───────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>CAPITAL</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Capital Invested</Text>
          <BlurValue hidden={hideValues}>
            <Text style={styles.rowValue}>
              {metrics.capitalInvested.toFixed(2)} {sym}
            </Text>
          </BlurValue>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Current Value</Text>
          <BlurValue hidden={hideValues}>
            <Text style={[styles.rowValue, { color: TEXT_PRIMARY }]}>
              {metrics.currentValue.toFixed(2)} {sym}
            </Text>
          </BlurValue>
        </View>
      </View>

      {/* ── Performance breakdown ─────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>PERFORMANCE</Text>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>Price Gain</Text>
          <View style={styles.rowRight}>
            <Text style={[styles.rowPct, { color: metrics.priceGain >= 0 ? '#22c55e' : '#ef4444' }]}>
              {fmtPct(metrics.priceGainPct)}
            </Text>
            <BlurValue hidden={hideValues} tint={metrics.priceGain >= 0 ? 'green' : 'red'}>
              <Text style={[styles.rowMoney, { color: metrics.priceGain >= 0 ? '#22c55e' : '#ef4444' }]}>
                {fmtMoney(metrics.priceGain, sym)}
              </Text>
            </BlurValue>
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>Dividends</Text>
          <View style={styles.rowRight}>
            <Text style={[styles.rowPct, { color: metrics.dividends > 0 ? '#22c55e' : '#64748b' }]}>
              {metrics.dividends > 0 ? fmtPct(metrics.dividendsPct) : '—'}
            </Text>
            <BlurValue hidden={hideValues} tint={metrics.dividends > 0 ? 'green' : 'neutral'}>
              <Text style={[styles.rowMoney, { color: metrics.dividends > 0 ? '#22c55e' : '#64748b' }]}>
                {metrics.dividends > 0 ? fmtMoney(metrics.dividends, sym) : '0.00 ' + sym}
              </Text>
            </BlurValue>
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>Realized Gain</Text>
          <View style={styles.rowRight}>
            <Text style={[styles.rowPct, { color: metrics.realizedGain >= 0 ? '#22c55e' : '#ef4444' }]}>
              {fmtPct(metrics.realizedGainPct)}
            </Text>
            <BlurValue hidden={hideValues} tint={metrics.realizedGain >= 0 ? 'green' : 'red'}>
              <Text style={[styles.rowMoney, { color: metrics.realizedGain >= 0 ? '#22c55e' : '#ef4444' }]}>
                {fmtMoney(metrics.realizedGain, sym)}
              </Text>
            </BlurValue>
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>Brokerage Fees</Text>
          <View style={styles.rowRight}>
            <Text style={[styles.rowPct, { color: metrics.brokerageFees > 0 ? '#ef4444' : '#64748b' }]}> 
              {metrics.brokerageFees > 0 ? fmtPct(-metrics.brokerageFeesPct) : '—'}
            </Text>
            <BlurValue hidden={hideValues} tint={metrics.brokerageFees > 0 ? 'red' : 'neutral'}>
              <Text style={[styles.rowMoney, { color: metrics.brokerageFees > 0 ? '#ef4444' : '#64748b' }]}> 
                {metrics.brokerageFees > 0 ? fmtMoney(-metrics.brokerageFees, sym) : '0.00 ' + sym}
              </Text>
            </BlurValue>
          </View>
        </View>
      </View>

      {/* ── Total return ──────────────────────────────────────────────── */}
      <View style={[styles.section, styles.totalSection]}>
        <View style={styles.row}>
          <Text style={[styles.rowLabel, { fontSize: 15, fontWeight: '700', color: '#f8fafc' }]}>
            Total Return
          </Text>
          <View style={styles.rowRight}>
            <Text style={[styles.rowPct, {
              fontSize: 15, fontWeight: '700',
              color: metrics.totalReturn >= 0 ? '#22c55e' : '#ef4444',
            }]}>
              {fmtPct(metrics.totalReturnPct)}
            </Text>
            <BlurValue hidden={hideValues} tint={metrics.totalReturn >= 0 ? 'green' : 'red'}>
              <Text style={[styles.rowMoney, { fontSize: 15, fontWeight: '700', color: metrics.totalReturn >= 0 ? '#22c55e' : '#ef4444' }]}>
                {fmtMoney(metrics.totalReturn, sym)}
              </Text>
            </BlurValue>
          </View>
        </View>
      </View>

      {/* ── Per-year breakdown (only in All Time view) ───────────────── */}
      {selectedYear === 'all' && (
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>BY YEAR OF INVESTMENT</Text>
        {yearlyBars.map((bar) => (
          <TouchableOpacity
            key={bar.year}
            style={styles.row}
            onPress={() => setSelectedYear(bar.year)}
            activeOpacity={0.7}
          >
            <Text style={styles.rowLabel}>{bar.year}</Text>
            <View style={styles.rowRight}>
              <Text style={[styles.rowPct, { color: bar.gainPct >= 0 ? '#22c55e' : '#ef4444' }]}>
                {fmtPct(bar.gainPct)}
              </Text>
              <BlurValue hidden={hideValues} tint={bar.gain >= 0 ? 'green' : 'red'}>
                <Text style={[styles.rowMoney, { color: bar.gain >= 0 ? '#22c55e' : '#ef4444' }]}>
                  {fmtMoney(bar.gain, sym)}
                </Text>
              </BlurValue>
            </View>
          </TouchableOpacity>
        ))}
      </View>
      )}

      {/* ── Latest Transactions ─────────────────────────────────────── */}
      {(() => {
        const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
        const TX_LIMIT = 8;
        const visible = showAllTx ? sorted : sorted.slice(0, TX_LIMIT);
        const hasMore = !showAllTx && sorted.length > TX_LIMIT;
        const groups: { label: string; items: typeof sorted }[] = [];
        visible.forEach((t) => {
          const d = new Date(t.date);
          const label = d.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })
            .replace(/^./, (c) => c.toUpperCase());
          const last = groups[groups.length - 1];
          if (last?.label === label) last.items.push(t);
          else groups.push({ label, items: [t] });
        });
        if (groups.length === 0) return null;
        return (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>LATEST TRANSACTIONS</Text>
            {groups.map((g) => (
              <View key={g.label}>
                <Text style={styles.txGroupLabel}>{g.label}</Text>
                {g.items.map((t) => {
                  const total = t.shares * t.price;
                  const isBuy = t.type === 'buy';
                  const isOrphan = !holdings.some((h) => h.symbol === t.symbol);
                  return (
                    <View key={t.id} style={styles.txRow}>
                      <View style={styles.txIconWrap}>
                        <Text style={styles.txIconText}>{t.symbol.slice(0, 2)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.txSymbol}>{t.symbol}</Text>
                        <Text style={styles.txDesc}>
                          {isBuy ? 'Bought' : 'Sold'} x{t.shares % 1 === 0 ? t.shares.toFixed(0) : t.shares.toFixed(4)} at {t.price.toFixed(2)} {sym}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.txDate}>
                          {new Date(t.date).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                        </Text>
                        <BlurValue hidden={hideValues} tint={isBuy ? 'red' : 'green'}>
                          <Text style={[styles.txTotal, { color: isBuy ? '#ef4444' : '#22c55e' }]}>
                            {fmtMoney(isBuy ? -total : total, sym)}
                          </Text>
                        </BlurValue>
                      </View>
                      {isOrphan && (
                        <TouchableOpacity
                          onPress={() =>
                            Alert.alert(
                              'Delete transaction',
                              `${t.symbol} no longer exists in your portfolio.\n\nAre you sure you want to delete this transaction (${isBuy ? 'buy' : 'sell'} x${t.shares % 1 === 0 ? t.shares.toFixed(0) : t.shares.toFixed(4)}) from the history?`,
                              [
                                { text: 'Cancel', style: 'cancel' },
                                { text: 'Delete', style: 'destructive', onPress: () => {
                                  if (isCombinedPortfolio) {
                                    Alert.alert('Read-only', 'Select a specific portfolio before deleting transactions.');
                                    return;
                                  }
                                  deleteTransaction(t.id);
                                } },
                              ],
                            )
                          }
                          style={styles.txDeleteBtn}
                        >
                          <Ionicons name="trash-outline" size={16} color={TEXT_MUTED} />
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
            {hasMore && (
              <TouchableOpacity
                onPress={() => setShowAllTx(true)}
                style={{ alignItems: 'center', paddingVertical: 14, marginTop: 4, borderTopWidth: 1, borderTopColor: '#1e293b' }}
              >
                <Text style={{ color: '#6366f1', fontSize: 14, fontWeight: '700' }}>
                  Show more ({sorted.length - TX_LIMIT} remaining)
                </Text>
              </TouchableOpacity>
            )}
            {showAllTx && sorted.length > TX_LIMIT && (
              <TouchableOpacity
                onPress={() => setShowAllTx(false)}
                style={{ alignItems: 'center', paddingVertical: 14, marginTop: 4, borderTopWidth: 1, borderTopColor: '#1e293b' }}
              >
                <Text style={{ color: '#6366f1', fontSize: 14, fontWeight: '700' }}>Show less</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })()}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: PAGE_BG },
  centered: { flex: 1, backgroundColor: PAGE_BG, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: TEXT_MUTED, fontSize: 15, textAlign: 'center', lineHeight: 22 },

  // Year tabs
  tabs: { marginTop: 12 },
  yearTab: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, backgroundColor: SURFACE_ALT,
  },
  yearTabActive: { backgroundColor: '#6366f1' },
  yearTabText: { color: TEXT_MUTED, fontSize: 13, fontWeight: '600' },
  yearTabTextActive: { color: TEXT_PRIMARY },

  // Chart
  chartContainer: {
    marginHorizontal: 16, marginTop: 16, marginBottom: 8,
    backgroundColor: SURFACE, borderRadius: 12, padding: 8,
  },

  // Sections
  section: {
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: SURFACE, borderRadius: 12, padding: 16,
  },
  totalSection: { borderWidth: 1, borderColor: '#6366f1' },
  sectionLabel: {
    color: TEXT_MUTED, fontSize: 11, fontWeight: '700',
    letterSpacing: 1, marginBottom: 12, textTransform: 'uppercase',
  },

  // Rows
  row: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER,
  },
  rowSelected: { backgroundColor: 'rgba(99,102,241,0.08)', borderRadius: 8 },
  rowLabel: { color: TEXT_SECONDARY, fontSize: 14 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowPct: { color: TEXT_MUTED, fontSize: 13, minWidth: 60, textAlign: 'right' },
  rowValue: { color: TEXT_MUTED, fontSize: 14 },
  rowMoney: { color: TEXT_MUTED, fontSize: 13, minWidth: 80, textAlign: 'right' },
  txGroupLabel: { color: TEXT_MUTED, fontSize: 12, fontWeight: '600', letterSpacing: 0.5, paddingVertical: 8, paddingHorizontal: 4 },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: BORDER },
  txDeleteBtn: { padding: 6 },
  txIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: SURFACE_ALT, alignItems: 'center', justifyContent: 'center' },
  txIconText: { color: TEXT_MUTED, fontSize: 11, fontWeight: '700' },
  txSymbol: { color: TEXT_PRIMARY, fontSize: 14, fontWeight: '600' },
  txDesc: { color: TEXT_MUTED, fontSize: 12, marginTop: 1 },
  txDate: { color: TEXT_MUTED, fontSize: 11 },
  txTotal: { fontSize: 13, fontWeight: '600', marginTop: 2 },

  // KPI cards
  kpiRow: { flexDirection: 'row', gap: 12 },
  kpiCard: {
    flex: 1, backgroundColor: SURFACE_ALT, borderRadius: 10,
    padding: 14, alignItems: 'center',
  },
  kpiLabel: { color: TEXT_MUTED, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 6 },
  kpiValue: { fontSize: 22, fontWeight: '700', marginBottom: 2 },
  kpiSub: { color: TEXT_MUTED, fontSize: 11, textAlign: 'center' },

  // Tabs row
  tabsRow: { flexDirection: 'row', alignItems: 'center' },
  chartToggleBtn: {
    paddingHorizontal: 10, paddingVertical: 8, marginRight: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  chartToggleLabel: { color: TEXT_MUTED, fontSize: 11, marginTop: 2 },

  // Heatmap
  heatmapContainer: {
    marginHorizontal: 16, marginTop: 16, marginBottom: 8,
    backgroundColor: SURFACE, borderRadius: 12, paddingVertical: 12,
    overflow: 'hidden',
  },
  hmRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  hmYearCell: { width: 36, alignItems: 'flex-end', paddingRight: 6 },
  hmYearLabel: { color: TEXT_MUTED, fontSize: 11, fontWeight: '600' },
  hmCell: {
    width: 46, height: 28, borderRadius: 4, margin: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  hmMonthLabel: { color: TEXT_MUTED, fontSize: 10, fontWeight: '600' },
  hmCellText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
});
