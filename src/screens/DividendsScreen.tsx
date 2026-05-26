import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Image, Modal, Pressable,
} from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { getDividends, getDeclaredDividends, getStockQuote, getDividendHistory, StockQuote, effectivePrice } from '../services/api';
import { usePortfolio } from '../context/PortfolioContext';
import { useSettings } from '../context/SettingsContext';
import DividendCalendarModal from '../components/DividendCalendarModal';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../../App';
import { Ionicons } from '@expo/vector-icons';

type Status = 'paid' | 'forecasted' | 'declared';

interface DivEntry {
  symbol: string;
  name: string;
  shares: number;
  amount: number;        // per share
  total: number;         // shares * amount * fxRate
  timestamp: number;     // ex-date unix seconds
  payDate: number | null; // payment date unix seconds
  year: number;
  status: Status;
  yoyGrowth: number | null;
}

// Seed-based colour per symbol (used as fallback bg)
const SYMBOL_COLORS = ['#6366f1','#3b82f6','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];
const symbolColor = (s: string) => SYMBOL_COLORS[s.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % SYMBOL_COLORS.length];
const logoUrl = (symbol: string) => `https://images.financialmodelingprep.com/symbol/${symbol}.png`;

// Derive payment frequency from sorted dividends (desc) — use median of all gaps
const deriveFreqDays = (divs: { date: number }[]): number | null => {
  if (divs.length < 2) return null;
  // Use only the most recent 8 dividends to reflect current payment schedule
  const recent = divs.slice(0, 8);
  const gaps: number[] = [];
  for (let i = 0; i < recent.length - 1; i++) {
    gaps.push((recent[i].date - recent[i + 1].date) / 86400);
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median < 20) return 7;
  if (median < 45) return 30;
  if (median < 100) return 91;
  if (median < 200) return 183;
  return 365;
};

const getDisplayDateMeta = (entry: DivEntry): { timestamp: number | null; label: string } => {
  if (entry.payDate != null) {
    return {
      timestamp: entry.payDate,
      label: entry.status === 'forecasted' ? 'Est. pay date' : 'Pay date',
    };
  }
  if (entry.status === 'paid') {
    return { timestamp: null, label: 'Pay date unavailable' };
  }
  return { timestamp: entry.timestamp, label: 'Ex-date' };
};

export default function DividendsScreen() {
  const { holdings, transactions } = usePortfolio();
  const { currency, getRateFor, applyDividendTax, fhKey, fmpKey } = useSettings();
  const currencySymbol = currency === 'EUR' ? '€' : '$';
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const [logoErrors, setLogoErrors] = useState<Record<string, boolean>>({});
  const [infoModal, setInfoModal] = useState<{ title: string; text: string } | null>(null);
  const [entries, setEntries] = useState<DivEntry[]>([]);
  const [cagrAnnuals, setCagrAnnuals] = useState<{ year: number; paid: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [quotes, setQuotes] = useState<Record<string, StockQuote | null>>({});

  const nowTs = Date.now() / 1000;
  const nowYear = new Date().getFullYear();

  useEffect(() => {
    if (holdings.length === 0) return;
    setLoading(true);

    Promise.all(
      holdings.map(async (h) => {
        const rate = getRateFor(h.currency ?? 'USD');
        const [divs, fhDeclared, divHistory] = await Promise.all([
          getDividends(h.symbol).catch(() => [] as { amount: number; date: number }[]),
          getDeclaredDividends(h.symbol).catch(() => [] as { amount: number; date: number }[]),
          getDividendHistory(h.symbol).catch(() => [] as { exDate: number; payDate: number | null; amount: number }[]),
        ]);
        // Map exDate → payDate (match within ±3 days tolerance)
        const getPayDate = (exDate: number): number | null => {
          const match = divHistory.find(d => Math.abs(d.exDate - exDate) < 3 * 86400);
          return match?.payDate ?? null;
        };
        const sorted = [...divs].sort((a, b) => b.date - a.date);
        const freqDays = deriveFreqDays(sorted);

        // Find earliest buy transaction for this symbol → only count dividends from that date onwards
        const buyTxs = transactions.filter((t) => t.symbol === h.symbol && t.type === 'buy');
        const sellTxs = transactions.filter((t) => t.symbol === h.symbol && t.type === 'sell');
        const firstBuyTs = buyTxs.length > 0
          ? Math.min(...buyTxs.map((t) => new Date(t.date).getTime() / 1000))
          : new Date(h.purchaseDate).getTime() / 1000;

        // Calculate shares owned at a specific timestamp (buys - sells up to that date)
        const sharesAtDate = (ts: number): number => {
          if (buyTxs.length === 0) {
            // No detailed transactions → use holding's purchase date and shares directly
            return ts >= firstBuyTs ? h.shares : 0;
          }
          const bought = buyTxs
            .filter((t) => new Date(t.date).getTime() / 1000 <= ts)
            .reduce((sum, t) => sum + t.shares, 0);
          const sold = sellTxs
            .filter((t) => new Date(t.date).getTime() / 1000 <= ts)
            .reduce((sum, t) => sum + t.shares, 0);
          return Math.max(0, bought - sold);
        };

        // Build paid entries — only dividends on or after first buy date
        const displayFrom = firstBuyTs;
        const paid: DivEntry[] = sorted
          .filter((d) => d.date >= displayFrom && d.date <= nowTs)
          .map((d) => {
            const sharesOwned = sharesAtDate(d.date);
            if (sharesOwned <= 0) return null;
            return {
              symbol: h.symbol,
              name: h.name,
              shares: sharesOwned,
              amount: applyDividendTax(d.amount),
              total: sharesOwned * applyDividendTax(d.amount) * rate,
              timestamp: d.date,
              payDate: getPayDate(d.date),
              year: new Date(d.date * 1000).getFullYear(),
              status: 'paid' as Status,
              yoyGrowth: null,
            };
          }).filter((d): d is NonNullable<typeof d> => d !== null) as DivEntry[];

        // Declared: officially announced future dividends from Finnhub calendar
        const currentShares = sharesAtDate(nowTs);
        const declared: DivEntry[] = fhDeclared
          .filter((d) => d.date > nowTs)
          .map((d) => ({
          symbol: h.symbol,
          name: h.name,
          shares: currentShares,
          amount: applyDividendTax(d.amount),
          total: currentShares * applyDividendTax(d.amount) * rate,
          timestamp: d.date,
          payDate: getPayDate(d.date),
          year: new Date(d.date * 1000).getFullYear(),
          status: 'declared' as Status,
          yoyGrowth: null,
        }));
        const declaredTimes = declared.map((d) => d.timestamp);

        // Project future dividends — full calendar years: nowYear+1 and nowYear+2
        const forecasted: DivEntry[] = [];
        if (freqDays && sorted.length > 0) {
          const freqSec = freqDays * 86400;
          const endYear = nowYear + 2;
          const horizon = new Date(endYear, 11, 31, 23, 59, 59).getTime() / 1000;
          // Anchor from the most recent *past* dividend — ignore any future declared divs
          const lastPastDiv = sorted.find((d) => d.date <= nowTs);
          if (!lastPastDiv) return { entries: [...declared, ...forecasted, ...paid], cagrAnnualData: [] };
          let nextTs = lastPastDiv.date + freqSec;
          while (nextTs <= nowTs) nextTs += freqSec;
          const lastAmt = lastPastDiv.amount;

          // Derive annual dividend growth rate using calendar-year totals (standard DGR method)
          // Only complete years (< nowYear) are used — partial years distort the calculation
          const annualDivTotals: Record<number, number> = {};
          for (const d of sorted.filter((d) => d.date <= nowTs)) {
            const y = new Date(d.date * 1000).getFullYear();
            if (y < nowYear) annualDivTotals[y] = (annualDivTotals[y] ?? 0) + d.amount;
          }
          const completeYears = Object.entries(annualDivTotals)
            .map(([y, amt]) => ({ year: Number(y), amt }))
            .sort((a, b) => a.year - b.year)
            .filter((a) => a.amt > 0);

          let annualGrowthRate = 0;
          if (completeYears.length >= 2) {
            // Use up to last 5 complete years for CAGR
            const slice = completeYears.slice(-5);
            const oldest = slice[0];
            const newest = slice[slice.length - 1];
            const span = newest.year - oldest.year;
            if (span >= 1) {
              const rawRate = Math.pow(newest.amt / oldest.amt, 1 / span) - 1;
              // Cap between -20% and +30% to avoid outlier distortion
              annualGrowthRate = Math.max(-0.20, Math.min(0.30, rawRate));
            }
          }

          // Per-payment growth rate derived from annualGrowthRate and frequency
          const paymentsPerYear = Math.round(365 / freqDays);
          const perPaymentGrowthRate = paymentsPerYear > 1
            ? Math.pow(1 + annualGrowthRate, 1 / paymentsPerYear) - 1
            : annualGrowthRate;

          let paymentOffset = 0;

          while (nextTs <= horizon) {
            // Skip projected dates already covered by an officially declared dividend
            const hasDeclared = declaredTimes.some((dt) => Math.abs(dt - nextTs) < freqSec * 0.4);
            if (!hasDeclared) {
            const payYear = new Date(nextTs * 1000).getFullYear();
            const projectedAmt = lastAmt * Math.pow(1 + perPaymentGrowthRate, paymentOffset + 1);
            const netProjectedAmt = applyDividendTax(projectedAmt);
            forecasted.push({
              symbol: h.symbol,
              name: h.name,
              shares: currentShares,
              amount: netProjectedAmt,
              total: currentShares * netProjectedAmt * rate,
              timestamp: nextTs,
              payDate: nextTs + 7 * 86400,
              year: payYear,
              status: 'forecasted',
              yoyGrowth: annualGrowthRate * 100,
            });
            paymentOffset++;
            } // end hasDeclared check
            nextTs += freqSec;
          }
        }

        // Also compute CAGR annuals here using the same divs (avoid a second getDividends call)
        const cagrAnnualData = divs
          .filter((d) => d.date <= nowTs)
          .map((d) => ({
            year: new Date(d.date * 1000).getFullYear(),
            total: h.shares * applyDividendTax(d.amount) * rate,
          }));

        return { entries: [...declared, ...forecasted, ...paid], cagrAnnualData };
      }))
      .then(results => {
        const flat = results.flatMap(r => r.entries).sort((a, b) => b.timestamp - a.timestamp);
        setEntries(flat);

        // CAGR annuals — collected from same fetch
        const allPaid = results.flatMap(r => r.cagrAnnualData);
        const byYear: Record<number, number> = {};
        for (const { year, total } of allPaid) byYear[year] = (byYear[year] ?? 0) + total;
        const cagrSorted = Object.entries(byYear)
          .map(([y, paid]) => ({ year: Number(y), paid }))
          .sort((a, b) => a.year - b.year);
        setCagrAnnuals(cagrSorted);
      })
      .finally(() => setLoading(false));
  }, [holdings, transactions, getRateFor, applyDividendTax, fhKey, fmpKey]);

  // Fetch current prices for Yield TTM
  useEffect(() => {
    if (holdings.length === 0) return;
    Promise.all(
      holdings.map(async h => {
        const q = await getStockQuote(h.symbol).catch(() => null);
        return { symbol: h.symbol, quote: q };
      })
    ).then(results => {
      setQuotes(Object.fromEntries(results.map(r => [r.symbol, r.quote])));
    });
  }, [holdings]);

  // Year tabs
  const years = Array.from(new Set(entries.map(e => e.year))).sort((a, b) => b - a);
  const tabs: (number | 'all')[] = ['all', ...years];

  const filtered = selectedYear === 'all' ? entries : entries.filter(e => e.year === selectedYear);

  // Total received (paid only) for selected filter
  const totalPaid = filtered.filter(e => e.status === 'paid').reduce((s, e) => s + e.total, 0);
  const totalForecasted = filtered.filter(e => e.status === 'forecasted' || e.status === 'declared').reduce((s, e) => s + e.total, 0);
  // Footer "previsto": when all-time view, only show remainder of current year to keep it comparable with totalPaid
  const forecastedForFooter = selectedYear === 'all'
    ? entries.filter(e => (e.status === 'forecasted' || e.status === 'declared') && e.year === nowYear).reduce((s, e) => s + e.total, 0)
    : totalForecasted;

  // Annual bar chart data — ascending order (oldest → newest, left → right)
  const annualTotals = [...years].reverse().map(y => ({
    year: y,
    paid: entries.filter(e => e.year === y && e.status === 'paid').reduce((s, e) => s + e.total, 0),
    forecasted: entries.filter(e => e.year === y && e.status === 'forecasted').reduce((s, e) => s + e.total, 0),
  }));
  const maxBar = Math.max(...annualTotals.map(a => a.paid + a.forecasted), 1);

  // Group filtered entries by year (desc)
  const grouped: { year: number; items: DivEntry[] }[] = [];
  const seenYears = new Set<number>();
  for (const e of filtered) {
    if (!seenYears.has(e.year)) {
      seenYears.add(e.year);
      grouped.push({ year: e.year, items: [] });
    }
    grouped[grouped.length - 1].items.push(e);
  }

  const fmtAmt = (v: number) => {
    const [int, dec] = Math.abs(v).toFixed(2).split('.');
    const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${currencySymbol}${intFmt},${dec}`;
  };

  // --- Metrics ---
  const ttm12ago = nowTs - 365 * 86400;
  const ttmDivs = entries.filter(e => e.status === 'paid' && e.timestamp >= ttm12ago).reduce((s, e) => s + e.total, 0);

  // CAGR: uses full paid history (all years since first buy, not limited to display window)
  const cagrValue = (() => {
    const paidYears = cagrAnnuals.filter(a => a.paid > 0);
    if (paidYears.length < 2) return null;
    const oldest = paidYears[0];
    const newest = paidYears[paidYears.length - 1];
    const span = newest.year - oldest.year;
    if (span < 1) return null;
    return (Math.pow(newest.paid / oldest.paid, 1 / span) - 1) * 100;
  })();

  // Yield TTM = TTM divs / current market value
  const marketValue = holdings.reduce((s, h) => {
    const quote = quotes[h.symbol];
    const price = quote ? effectivePrice(quote) : h.avgPrice;
    return s + h.shares * price * getRateFor(quote?.currency ?? h.currency ?? 'USD');
  }, 0);
  const yieldTTM = marketValue > 0 ? (ttmDivs / marketValue) * 100 : null;

  // YoC TTM = TTM divs / cost basis
  const costBasis = holdings.reduce((s, h) => s + h.shares * h.avgPrice * getRateFor(h.currency ?? 'USD'), 0);
  const yocTTM = costBasis > 0 ? (ttmDivs / costBasis) * 100 : null;

  // Average paid per year — uses full cagrAnnuals history (all years since first div, not just display window)
  const avgPerYear = cagrAnnuals.length > 0
    ? cagrAnnuals.reduce((s, a) => s + a.paid, 0) / cagrAnnuals.length
    : 0;
  const BAR_H = 80;
  const BAR_W = 32;
  const CHART_W = Math.max(annualTotals.length * (BAR_W + 12) + 16, 200);

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Dividends</Text>
        <TouchableOpacity onPress={() => navigation.navigate('DividendCalendar', { entries, currencySymbol })} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="calendar-outline" size={24} color="#94a3b8" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />
      ) : holdings.length === 0 ? (
        <Text style={s.empty}>Add stocks to the portfolio to see dividends.</Text>
      ) : (
        <>
          {/* Year tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabsScroll} contentContainerStyle={s.tabsRow}>
            {tabs.map(t => (
              <TouchableOpacity key={String(t)} onPress={() => setSelectedYear(t)} style={[s.tab, selectedYear === t && s.tabActive]}>
                <Text style={[s.tabTxt, selectedYear === t && s.tabTxtActive]}>
                  {t === 'all' ? 'All-Time' : String(t)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 120, 148) }} showsVerticalScrollIndicator={false}>
            {/* Bar chart */}
            {annualTotals.length > 0 && (
              <View style={s.chartCard}>
                {/* CAGR + Average header */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <View>
                    <Text style={{ color: '#94a3b8', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>CAGR</Text>
                    <Text style={{ color: cagrValue != null ? (cagrValue >= 0 ? '#22c55e' : '#ef4444') : '#64748b', fontSize: 16, fontWeight: '700' }}>
                      {cagrValue != null ? `${cagrValue >= 0 ? '↗' : '↘'}${Math.abs(cagrValue).toFixed(1)}%` : '—'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: '#94a3b8', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>Average / year</Text>
                    <Text style={{ color: '#e2e8f0', fontSize: 16, fontWeight: '700' }}>{avgPerYear > 0 ? fmtAmt(avgPerYear) : '—'}</Text>
                  </View>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <Svg width={CHART_W} height={BAR_H + 30}>
                      {annualTotals.map((a, i) => {
                        const x = i * (BAR_W + 12) + 8;
                        const paidH = Math.max((a.paid / maxBar) * BAR_H, a.paid > 0 ? 3 : 0);
                        const fcastH = Math.max((a.forecasted / maxBar) * BAR_H, a.forecasted > 0 ? 3 : 0);
                        const totalH = paidH + fcastH;
                        const isSelected = selectedYear === a.year;
                        return (
                          <React.Fragment key={a.year}>
                            {/* Forecasted part (top, darker) */}
                            {fcastH > 0 && (
                              <Rect x={x} y={BAR_H - totalH} width={BAR_W} height={fcastH} rx={4} fill={isSelected ? '#6366f1aa' : '#334155'} />
                            )}
                            {/* Paid part (bottom, bright) */}
                            {paidH > 0 && (
                              <Rect x={x} y={BAR_H - paidH} width={BAR_W} height={paidH} rx={4} fill={isSelected ? '#6366f1' : '#3b82f6'} />
                            )}
                            {/* Year label */}
                            <SvgText x={x + BAR_W / 2} y={BAR_H + 16} textAnchor="middle" fill="#64748b" fontSize={10}>{a.year}</SvgText>
                          </React.Fragment>
                        );
                      })}
                    </Svg>
                </ScrollView>
              </View>
            )}

            {/* Grouped list */}
            {grouped.map(group => {
              const groupPaid = group.items.filter(e => e.status === 'paid').reduce((s, e) => s + e.total, 0);
              const groupFcast = group.items.filter(e => e.status === 'forecasted' || e.status === 'declared').reduce((s, e) => s + e.total, 0);
              return (
                <View key={group.year}>
                  {/* Year header */}
                  <View style={s.yearHeader}>
                    <Text style={s.yearLabel}>{group.year}</Text>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={s.yearTotal}>{fmtAmt(groupPaid + groupFcast)}</Text>
                      {groupFcast > 0 && groupPaid > 0 && (
                        <Text style={{ color: '#64748b', fontSize: 11 }}>{fmtAmt(groupPaid)} paid</Text>
                      )}
                    </View>
                  </View>

                  {/* Entries */}
                  {group.items.map((e, idx) => {
                    const isFuture = e.status !== 'paid';
                    const isFirst = idx === 0;
                    const isLast = idx === group.items.length - 1;
                    const nextIsFuture = idx + 1 < group.items.length && group.items[idx + 1].status !== 'paid';
                    const color = symbolColor(e.symbol);
                    const LINE_COLOR = '#3b82f6';
                    const DOT = 10;
                    const { timestamp: displayTs, label: dateLabel } = getDisplayDateMeta(e);
                    const mon = displayTs != null ? new Date(displayTs * 1000).toLocaleString('en-US', { month: 'short' }) : null;
                    const day = displayTs != null ? new Date(displayTs * 1000).getDate() : null;
                    return (
                      <View key={`${e.symbol}-${e.timestamp}`} style={[s.entryRow, { alignItems: 'stretch', paddingHorizontal: 16, paddingVertical: 0, gap: 0 }]}>
                        {/* Timeline column */}
                        <View style={{ width: 20, alignItems: 'center' }}>
                          {isFirst
                            ? <View style={{ flex: 1 }} />
                            : <View style={isFuture
                                ? { flex: 1, width: 2, borderLeftWidth: 2, borderStyle: 'dashed', borderColor: LINE_COLOR }
                                : { flex: 1, width: 2, backgroundColor: LINE_COLOR }
                              } />
                          }
                          <View style={{
                            width: DOT, height: DOT, borderRadius: DOT / 2,
                            backgroundColor: isFuture ? 'transparent' : LINE_COLOR,
                            borderWidth: 2, borderColor: LINE_COLOR,
                          }} />
                          {isLast
                            ? <View style={{ flex: 1 }} />
                            : <View style={(isFuture || nextIsFuture)
                                ? { flex: 1, width: 2, borderLeftWidth: 2, borderStyle: 'dashed', borderColor: LINE_COLOR }
                                : { flex: 1, width: 2, backgroundColor: LINE_COLOR }
                              } />
                          }
                        </View>
                        {/* Logo circle + content */}
                        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 10, paddingVertical: 10 }}>
                        <View style={[s.logo, { backgroundColor: logoErrors[e.symbol] ? color + '33' : '#1e293b' }]}>
                          {logoErrors[e.symbol] ? (
                            <Text style={[s.logoTxt, { color }]}>{e.symbol.slice(0, 2)}</Text>
                          ) : (
                            <Image
                              source={{ uri: logoUrl(e.symbol) }}
                              style={{ width: 28, height: 28, borderRadius: 6 }}
                              onError={() => setLogoErrors(prev => ({ ...prev, [e.symbol]: true }))}
                            />
                          )}
                        </View>
                        {/* Info */}
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={s.entryName} numberOfLines={1}>{e.name}</Text>
                            <View style={[s.badge, e.status === 'declared' ? s.badgeDeclared : isFuture ? s.badgeForecasted : s.badgePaid]}>
                              <Text style={[s.badgeTxt, e.status === 'declared' ? s.badgeDeclaredTxt : isFuture ? s.badgeFcastTxt : s.badgePaidTxt]}>
                                {e.status === 'declared' ? 'Declared' : isFuture ? 'Forecasted' : 'Paid'}
                              </Text>
                            </View>
                          </View>
                          <Text style={s.entryDate}>
                            {displayTs != null ? `${dateLabel}: ${mon} ${day}` : dateLabel}  ·  <Text style={s.entryShares}>×{e.shares % 1 === 0 ? e.shares.toFixed(0) : e.shares.toFixed(4).replace(/\.?0+$/, '')}</Text>
                          </Text>
                        </View>
                        {/* Amount */}
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={[s.entryAmt, { color: isFuture ? '#64748b' : '#f8fafc' }]}>{fmtAmt(e.total)}</Text>
                          {e.status === 'forecasted' && e.yoyGrowth != null && (
                            <Text style={{ fontSize: 11, color: e.yoyGrowth >= 0 ? '#22c55e' : '#ef4444' }}>
                              {e.yoyGrowth >= 0 ? '↗' : '↘'}{Math.abs(e.yoyGrowth).toFixed(2)}%
                            </Text>
                          )}
                        </View>
                        </View>{/* close logo+content wrapper */}
                      </View>
                    );
                  })}
                </View>
              );
            })}

            {filtered.length === 0 && (
              <Text style={s.empty}>No dividends for this period.</Text>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={s.footer}>
            <View style={{ flex: 1 }}>
              <Text style={s.footerLabel}>Total received</Text>
              {forecastedForFooter > 0 && (
                <Text style={{ color: '#64748b', fontSize: 11 }}>
                  + {fmtAmt(forecastedForFooter)} forecast{selectedYear === 'all' ? ` (${nowYear})` : ''}
                </Text>
              )}
            </View>
            <Text style={s.footerTotal}>{fmtAmt(totalPaid)}</Text>
          </View>
          {/* Yield / YoC pills */}
          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom + 92, 108), backgroundColor: '#0f0f0f' }}>
            <View style={s.metricPill}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={s.metricPillLabel}>Yield (TTM)</Text>
                <TouchableOpacity onPress={() => setInfoModal({ title: 'Dividend Yield (TTM)', text: 'Dividendos recebidos nos últimos 12 meses a dividir pelo valor de mercado atual do portfólio.\n\nMede o retorno em dividendos face ao preço atual das ações.' })} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={{ color: '#64748b', fontSize: 12 }}>ⓘ</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.metricPillValue}>{yieldTTM != null ? `${yieldTTM.toFixed(2)}%` : '—'}</Text>
            </View>
            <View style={s.metricPill}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={s.metricPillLabel}>YoC (TTM)</Text>
                <TouchableOpacity onPress={() => setInfoModal({ title: 'Yield on Cost (TTM)', text: 'Dividendos recebidos nos últimos 12 meses a dividir pelo custo de aquisição total do portfólio.\n\nMede o retorno em dividendos face ao preço médio que pagaste pelas ações.' })} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={{ color: '#64748b', fontSize: 12 }}>ⓘ</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.metricPillValue}>{yocTTM != null ? `${yocTTM.toFixed(2)}%` : '—'}</Text>
            </View>
          </View>

          {/* Info modal */}
          <Modal visible={infoModal !== null} transparent animationType="fade" onRequestClose={() => setInfoModal(null)}>
            <Pressable style={s.modalOverlay} onPress={() => setInfoModal(null)}>
              <Pressable style={s.modalCard} onPress={() => {}}>
                <Text style={s.modalTitle}>{infoModal?.title}</Text>
                <Text style={s.modalText}>{infoModal?.text}</Text>
                <TouchableOpacity style={s.modalBtn} onPress={() => setInfoModal(null)}>
                  <Text style={s.modalBtnTxt}>OK</Text>
                </TouchableOpacity>
              </Pressable>
            </Pressable>
          </Modal>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: '#f8fafc', fontSize: 22, fontWeight: '700' },

  tabsScroll: { maxHeight: 44, flexGrow: 0 },
  tabsRow: { paddingHorizontal: 16, paddingBottom: 4, gap: 8, flexDirection: 'row', alignItems: 'center' },
  tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: 'transparent' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#f8fafc', borderRadius: 0 },
  tabTxt: { color: '#64748b', fontSize: 14, fontWeight: '600' },
  tabTxtActive: { color: '#f8fafc' },

  chartCard: { marginHorizontal: 16, marginTop: 8, marginBottom: 4, padding: 12, backgroundColor: '#1e293b', borderRadius: 14 },

  yearHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 10, marginTop: 8 },
  yearLabel: { color: '#f8fafc', fontSize: 18, fontWeight: '700' },
  yearTotal: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },

  entryRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: 2 },
  logo: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  logoTxt: { fontSize: 13, fontWeight: '700' },
  entryName: { color: '#e2e8f0', fontSize: 15, fontWeight: '600', maxWidth: 120 },
  entryDate: { color: '#8f99aa', fontSize: 12, marginTop: 2 },
  entryShares: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  entryAmt: { fontSize: 15, fontWeight: '600' },

  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  badgePaid: { backgroundColor: '#166534' },
  badgePaidTxt: { color: '#4ade80' },
  badgeForecasted: { backgroundColor: '#312e81' },
  badgeFcastTxt: { color: '#a5b4fc' },
  badgeDeclared: { backgroundColor: '#78350f' },
  badgeDeclaredTxt: { color: '#fbbf24' },
  badgeTxt: { fontSize: 11, fontWeight: '600' },

  footer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, backgroundColor: '#0f0f0f', borderTopWidth: 1, borderTopColor: '#1e293b' },
  footerLabel: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  footerTotal: { color: '#f8fafc', fontSize: 20, fontWeight: '700' },

  metricPill: { flex: 1, backgroundColor: '#1e293b', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 },
  metricPillLabel: { color: '#94a3b8', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  metricPillValue: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },

  empty: { color: '#8f99aa', textAlign: 'center', marginTop: 40, fontSize: 15 },

  modalOverlay: { flex: 1, backgroundColor: '#00000088', justifyContent: 'center', alignItems: 'center', padding: 32 },
  modalCard: { backgroundColor: '#1e293b', borderRadius: 16, padding: 24, width: '100%' },
  modalTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '700', marginBottom: 10 },
  modalText: { color: '#94a3b8', fontSize: 14, lineHeight: 22 },
  modalBtn: { marginTop: 20, alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 20, backgroundColor: '#6366f1', borderRadius: 10 },
  modalBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
