import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Dimensions,
} from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { getDividendHistory, DividendHistoryEntry } from '../services/api';
import { useSettings } from '../context/SettingsContext';

type Props = NativeStackScreenProps<RootStackParamList, 'StockDividendHistory'>;

interface EntryDisplay extends DividendHistoryEntry {
  forecasted: boolean;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtDate = (ts: number | null) => {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return `${d.getDate()}. ${MONTHS[d.getMonth()]}`;
};

const BAR_H = 100;
const BAR_PADDING = 20;
const BAR_SLOT_W = 60;
const FORECAST_YEARS = 2;

function detectPaymentsPerYear(entries: DividendHistoryEntry[]): number {
  if (entries.length < 2) return 1;
  const sorted = [...entries].sort((a, b) => a.exDate - b.exDate);
  const recent = sorted.slice(-8);
  const intervals: number[] = [];
  for (let i = 1; i < recent.length; i++) intervals.push(recent[i].exDate - recent[i - 1].exDate);
  const avgInterval = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;

  if (avgInterval < 45 * 86400) return 12;
  if (avgInterval < 135 * 86400) return 4;
  if (avgInterval < 270 * 86400) return 2;
  return 1;
}

function buildForecast(entries: DividendHistoryEntry[]): EntryDisplay[] {
  const nowTs = Date.now() / 1000;

  // Mark entries that come from the source already in the future
  const withFlag: EntryDisplay[] = entries.map(e => ({ ...e, forecasted: e.exDate > nowTs }));

  if (entries.length < 2) return withFlag;

  // Detect frequency from sorted historical entries
  const sorted = [...entries].sort((a, b) => a.exDate - b.exDate);
  const recent = sorted.slice(-8);
  const intervals: number[] = [];
  for (let i = 1; i < recent.length; i++) intervals.push(recent[i].exDate - recent[i - 1].exDate);
  const avgInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;

  let freqSec: number;
  if (avgInterval < 45 * 86400)       freqSec = 30 * 86400;   // monthly
  else if (avgInterval < 135 * 86400) freqSec = 91 * 86400;   // quarterly
  else if (avgInterval < 270 * 86400) freqSec = 182 * 86400;  // semi-annual
  else                                 freqSec = 365 * 86400;  // annual

  const lastAmount = sorted[sorted.length - 1].amount;
  const lastExDate = sorted[sorted.length - 1].exDate;
  const endTs = nowTs + FORECAST_YEARS * 365 * 86400;
  const PAY_OFFSET = 7 * 86400; // ~1 week after ex-date

  let nextEx = lastExDate + freqSec;
  while (nextEx <= endTs) {
    withFlag.push({
      exDate: Math.round(nextEx),
      payDate: Math.round(nextEx + PAY_OFFSET),
      amount: lastAmount,
      forecasted: true,
    });
    nextEx += freqSec;
  }

  return withFlag.sort((a, b) => b.exDate - a.exDate);
}

export default function StockDividendHistoryScreen({ route, navigation }: Props) {
  const { symbol, name, currentPrice, currency } = route.params;
  const currSym = currency === 'EUR' ? '€' : '$';
  const { applyDividendTax } = useSettings();
  const chartScrollRef = useRef<ScrollView | null>(null);

  const [loading, setLoading] = useState(true);
  const [allEntries, setAllEntries] = useState<EntryDisplay[]>([]);

  useEffect(() => {
    getDividendHistory(symbol)
      .then(raw => setAllEntries(buildForecast(raw)))
      .finally(() => setLoading(false));
  }, [symbol]);

  const nowTs = Date.now() / 1000;
  // Only real entries for TTM/avg
  const entries = allEntries.filter(e => !e.forecasted);
  const paymentsPerYear = detectPaymentsPerYear(entries);

  // --- Annual totals for bar chart (include forecast) ---
  const byYear: Record<number, number> = {};
  const forecastYears = new Set<number>();
  for (const e of allEntries) {
    const y = new Date(e.exDate * 1000).getFullYear();
    byYear[y] = (byYear[y] ?? 0) + applyDividendTax(e.amount);
    if (e.forecasted) forecastYears.add(y);
  }
  const chartYears = Object.keys(byYear)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((year) => {
      const yearEntries = allEntries.filter(e => new Date(e.exDate * 1000).getFullYear() === year);
      const isAllForecast = yearEntries.length > 0 && yearEntries.every(e => e.forecasted);
      return !isAllForecast || yearEntries.length >= paymentsPerYear;
    });
  const years = [...chartYears].sort((a, b) => b - a);
  const maxAnnual = Math.max(...chartYears.map(y => byYear[y]), 0.001);
  const chartGrowthByYear: Record<number, number | null> = {};
  chartYears.forEach((year, index) => {
    if (index === 0) {
      chartGrowthByYear[year] = null;
      return;
    }
    const prevYear = chartYears[index - 1];
    const prevTotal = byYear[prevYear] ?? 0;
    const currentTotal = byYear[year] ?? 0;
    chartGrowthByYear[year] = prevTotal > 0 ? ((currentTotal - prevTotal) / prevTotal) * 100 : null;
  });

  // Annual payout (TTM) — historical only
  const ttm = entries.filter(e => e.exDate >= nowTs - 365 * 86400).reduce((s, e) => s + applyDividendTax(e.amount), 0);

  // Average dividend per payment — historical only
  const avg = entries.length > 0 ? entries.reduce((s, e) => s + applyDividendTax(e.amount), 0) / entries.length : 0;

  const screenW = Dimensions.get('window').width;
  const chartW = Math.max(screenW - 40, chartYears.length * BAR_SLOT_W);
  const barW = 36;

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={s.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerName} numberOfLines={1}>{name}</Text>
        <Text style={s.headerSub}>Dividend History</Text>
        {ttm > 0 && (
          <Text style={s.headerTotal}>{currSym}{ttm.toFixed(2)} <Text style={s.headerTotalSub}>/ ano</Text></Text>
        )}
        {avg > 0 && (
          <Text style={s.headerAvg}>Ø {currSym}{avg.toFixed(3)}</Text>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />
      ) : entries.length === 0 ? (
        <Text style={s.empty}>Sem histórico de dividendos</Text>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Bar chart */}
          {chartYears.length > 0 && (
            <ScrollView
              ref={chartScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginTop: 8 }}
              contentContainerStyle={{ paddingHorizontal: 20 }}
              onContentSizeChange={() => chartScrollRef.current?.scrollToEnd({ animated: false })}
            >
              <View style={{ width: chartW }}>
                <Svg width={chartW} height={BAR_H}>
                  {chartYears.map((yr, i) => {
                    const val = byYear[yr];
                    const bh = Math.max((val / maxAnnual) * BAR_H, 4);
                    const x = i * BAR_SLOT_W + (BAR_SLOT_W - barW) / 2;
                    const y = BAR_H - bh;
                    const isFuture = forecastYears.has(yr) && !years.filter(y2 => !forecastYears.has(y2)).includes(yr);
                    const isCurrentYear = yr === new Date().getFullYear();
                    return (
                      <Rect
                        key={yr}
                        x={x} y={y} width={barW} height={bh}
                        fill={isFuture ? '#3730a3' : isCurrentYear ? '#6366f1' : '#3b82f6'}
                        rx={4}
                        opacity={isFuture ? 0.6 : isCurrentYear ? 0.85 : 1}
                      />
                    );
                  })}
                </Svg>
                <View style={s.chartMetaRow}>
                  {chartYears.map((yr) => {
                    const growth = chartGrowthByYear[yr];
                    const isFuture = forecastYears.has(yr) && !years.filter(y2 => !forecastYears.has(y2)).includes(yr);
                    return (
                      <View key={yr} style={s.chartMetaItem}>
                        <Text style={[s.chartYear, isFuture && s.chartYearFuture]}>{yr}</Text>
                        <Text style={s.chartAmount}>{currSym}{byYear[yr].toFixed(2)}</Text>
                        <Text style={[s.chartGrowth, growth == null ? s.chartGrowthMuted : growth >= 0 ? s.chartGrowthUp : s.chartGrowthDown]}>
                          {growth != null ? `${growth >= 0 ? '+' : ''}${growth.toFixed(2)}%` : ' '}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </ScrollView>
          )}

          {/* Table header */}
          <View style={s.tableHeader}>
            <Text style={[s.colHead, { flex: 1.1 }]}>Ex-date</Text>
            <Text style={[s.colHead, { flex: 1.1 }]}>Pay Date</Text>
            <Text style={[s.colHead, { flex: 0.8, textAlign: 'right' }]}>Yield</Text>
            <Text style={[s.colHead, { flex: 0.8, textAlign: 'right' }]}>Amount</Text>
          </View>

          {/* Rows grouped by year */}
          {years.map(yr => {
            const yearEntries = allEntries.filter(e => new Date(e.exDate * 1000).getFullYear() === yr);
            const yearTotal = yearEntries.reduce((sum, e) => sum + applyDividendTax(e.amount), 0);
            const isAllForecast = yearEntries.every(e => e.forecasted);
            // YoY change — compare with previous real year
            const prevRealYear = years.filter(y => !forecastYears.has(y) || y < yr).reverse().find(y => y < yr);
            const prevTotal = prevRealYear != null ? byYear[prevRealYear] : undefined;
            const yoy = prevTotal != null && prevTotal > 0 ? ((yearTotal - prevTotal) / prevTotal) * 100 : null;

            return (
              <View key={yr}>
                {/* Year header row — 4 cols matching data rows exactly */}
                <View style={s.yearRow}>
                  <Text style={[s.yearLabel, { flex: 1.1 }]}>{yr}</Text>
                  <Text style={[s.cell, { flex: 1.1 }]} />
                  <View style={{ flex: 0.8 }} />
                  <Text style={[s.yearTotal, { flex: 0.8, textAlign: 'right' }]}>{currSym}{yearTotal.toFixed(2)}</Text>
                </View>
                {/* Forecasted badge — own line, left-aligned */}
                {isAllForecast && (
                  <View style={s.forecastBadgeRow}>
                    <View style={s.forecastBadgeYear}>
                      <Text style={s.forecastBadgeText}>Forecasted</Text>
                    </View>
                  </View>
                )}

                {yearEntries.map((e, idx) => {
                  const netAmount = applyDividendTax(e.amount);
                  const yieldPct = currentPrice > 0 ? (netAmount / currentPrice) * 100 : null;
                  return (
                    <View key={idx}>
                      {e.forecasted && !isAllForecast && (
                        <View style={s.forecastBadgeRow}>
                          <View style={s.forecastBadgeYear}>
                            <Text style={s.forecastBadgeText}>Forecasted</Text>
                          </View>
                        </View>
                      )}
                      <View style={[s.row, idx % 2 === 1 && s.rowAlt, e.forecasted && s.rowForecast]}>
                        <Text style={[s.cell, { flex: 1.1 }, e.forecasted && s.cellForecast]}>{fmtDate(e.exDate)}</Text>
                        <Text style={[s.cell, { flex: 1.1 }, e.forecasted ? s.cellForecast : { color: e.payDate ? '#e2e8f0' : '#475569' }]}>{fmtDate(e.payDate)}</Text>
                        <Text style={[s.cell, { flex: 0.8, textAlign: 'right', color: '#22c55e' }]}>
                          {yieldPct != null ? `${yieldPct.toFixed(2)}%` : '—'}
                        </Text>
                        <Text style={[s.cell, { flex: 0.8, textAlign: 'right', fontWeight: '600', color: e.forecasted ? '#818cf8' : '#f8fafc' }]}>
                          {currSym}{netAmount.toFixed(3)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  backBtn: { marginBottom: 10 },
  backBtnText: { color: '#6366f1', fontSize: 14, fontWeight: '600' },
  headerName: { color: '#f8fafc', fontSize: 17, fontWeight: '700' },
  headerSub: { color: '#64748b', fontSize: 13, marginTop: 2 },
  headerTotal: { color: '#f8fafc', fontSize: 26, fontWeight: '700', marginTop: 8 },
  headerTotalSub: { color: '#94a3b8', fontSize: 14, fontWeight: '400' },
  headerAvg: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  chartMetaRow: { flexDirection: 'row', paddingTop: 8 },
  chartMetaItem: { width: BAR_SLOT_W, alignItems: 'center' },
  chartYear: { color: '#8f99aa', fontSize: 11 },
  chartYearFuture: { color: '#6366f1' },
  chartAmount: { color: '#e2e8f0', fontSize: 11, marginTop: 6 },
  chartGrowth: { fontSize: 11, marginTop: 4 },
  chartGrowthMuted: { color: 'transparent' },
  chartGrowthUp: { color: '#22c55e' },
  chartGrowthDown: { color: '#ef4444' },

  tableHeader: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#1e293b', marginTop: 12,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#334155',
  },
  colHead: { color: '#94a3b8', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },

  yearRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10, marginTop: 6,
    backgroundColor: '#0f172a',
  },
  yearLabel: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  yearTotal: { color: '#f8fafc', fontSize: 14, fontWeight: '600', marginLeft: 8 },
  yearYoy: { fontSize: 12, fontWeight: '600', marginRight: 4 },

  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11 },
  rowAlt: { backgroundColor: '#ffffff08' },
  rowForecast: { opacity: 0.75 },
  cell: { color: '#94a3b8', fontSize: 13 },
  cellForecast: { color: '#6366f1' },

  forecastBadgeRow: { paddingHorizontal: 16, paddingBottom: 4 },
  forecastBadgeYear: {
    alignSelf: 'flex-start', marginLeft: 8,
    backgroundColor: '#312e81', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  forecastBadgeText: { color: '#818cf8', fontSize: 11, fontWeight: '600' },

  empty: { color: '#8f99aa', textAlign: 'center', marginTop: 60, fontSize: 15 },
});
