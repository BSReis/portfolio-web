import React, { useState } from 'react';
import {
  View, Text, Modal, ScrollView, TouchableOpacity,
  StyleSheet, Image, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface DivEntry {
  symbol: string;
  name: string;
  total: number;
  timestamp: number;
  payDate: number | null;
  year: number;
  status: 'paid' | 'forecasted' | 'declared';
}

interface Props {
  visible: boolean;
  onClose: () => void;
  entries: DivEntry[];
  currencySymbol: string;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const SYMBOL_COLORS = ['#6366f1','#3b82f6','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];
const symbolColor = (s: string) => SYMBOL_COLORS[s.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % SYMBOL_COLORS.length];
const logoUrl = (symbol: string) => `https://images.financialmodelingprep.com/symbol/${symbol}.png`;
const logoSize = (count: number) => count <= 1 ? 28 : count <= 4 ? 18 : count <= 9 ? 13 : 10;

const BAR_MAX_H = 90;

export default function DividendCalendarModal({ visible, onClose, entries, currencySymbol }: Props) {
  const nowYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number | 'all'>(nowYear);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [logoErrors, setLogoErrors] = useState<Record<string, boolean>>({});

  const years = Array.from(new Set(entries.map(e => e.year))).sort((a, b) => a - b);

  // Assign unique colors to each symbol globally (first-seen order), no repeats
  const allSymbols = Array.from(new Set(entries.map(e => e.symbol)));
  const colorOf = (sym: string) => SYMBOL_COLORS[allSymbols.indexOf(sym) % SYMBOL_COLORS.length];

  const yearEntries = selectedYear === 'all' ? entries : entries.filter(e => e.year === selectedYear);
  const symbols = Array.from(new Set(yearEntries.map(e => e.symbol)));

  // By month (used when a specific year is selected) — group by payDate if available
  const byMonth = Array.from({ length: 12 }, (_, m) => {
    const all = yearEntries.filter(e => new Date((e.payDate ?? e.timestamp) * 1000).getMonth() === m);
    const symMap = new Map<string, { paid: number; forecasted: number }>();
    all.forEach(e => {
      const cur = symMap.get(e.symbol) ?? { paid: 0, forecasted: 0 };
      if (e.status === 'paid') cur.paid += e.total; else cur.forecasted += e.total;
      symMap.set(e.symbol, cur);
    });
    const bySymbol = Array.from(symMap.entries())
      .map(([symbol, v]) => ({ symbol, paid: v.paid, forecasted: v.forecasted, total: v.paid + v.forecasted }))
      .sort((a, b) => a.total - b.total);
    const total = bySymbol.reduce((s, v) => s + v.total, 0);
    return {
      paid: all.filter(e => e.status === 'paid').reduce((s, e) => s + e.total, 0),
      forecasted: all.filter(e => e.status !== 'paid').reduce((s, e) => s + e.total, 0),
      total,
      all,
      symbols: Array.from(new Set(all.map(e => e.symbol))),
      bySymbol,
    };
  });

  // By year (used in "All" mode)
  const allYears = Array.from(new Set(entries.map(e => e.year))).sort((a, b) => a - b);
  const byYear = allYears.map(y => {
    const all = entries.filter(e => e.year === y);
    const symMap = new Map<string, { paid: number; forecasted: number }>();
    all.forEach(e => {
      const cur = symMap.get(e.symbol) ?? { paid: 0, forecasted: 0 };
      if (e.status === 'paid') cur.paid += e.total; else cur.forecasted += e.total;
      symMap.set(e.symbol, cur);
    });
    const bySymbol = Array.from(symMap.entries())
      .map(([symbol, v]) => ({ symbol, paid: v.paid, forecasted: v.forecasted, total: v.paid + v.forecasted }))
      .sort((a, b) => a.total - b.total);
    const total = bySymbol.reduce((s, v) => s + v.total, 0);
    return {
      year: y,
      paid: all.filter(e => e.status === 'paid').reduce((s, e) => s + e.total, 0),
      forecasted: all.filter(e => e.status !== 'paid').reduce((s, e) => s + e.total, 0),
      total,
      symbols: Array.from(new Set(all.map(e => e.symbol))),
      bySymbol,
    };
  });

  const maxVal = selectedYear === 'all'
    ? Math.max(...byYear.map(y => y.total), 0.01)
    : Math.max(...byMonth.map(m => m.total), 0.01);
  const fmtAmt = (v: number) => {
    if (v < 0.01) return '';
    const [int, dec] = v.toFixed(2).split('.');
    const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${currencySymbol}${intFmt},${dec}`;
  };
  const fmtTotal = (v: number) => {
    const [int, dec] = v.toFixed(2).split('.');
    const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${currencySymbol}${intFmt},${dec}`;
  };

  const totalYear = yearEntries.reduce((s, e) => s + e.total, 0);
  const totalPaid = yearEntries.filter(e => e.status === 'paid').reduce((s, e) => s + e.total, 0);
  const totalFcast = yearEntries.filter(e => e.status !== 'paid').reduce((s, e) => s + e.total, 0);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={cs.container}>
        {/* Fixed top section */}
        <View>
          {/* Header */}
          <View style={cs.header}>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="arrow-back" size={24} color="#f8fafc" />
            </TouchableOpacity>
            <Text style={cs.headerTitle}>Dividend Calendar</Text>
            <View style={{ width: 24 }} />
          </View>

          {/* Year tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={cs.yearTabScroll} contentContainerStyle={cs.yearTabRow}>
            <TouchableOpacity onPress={() => { setSelectedYear('all'); setSelectedSymbol(null); }} style={[cs.yearTab, selectedYear === 'all' && cs.yearTabActive]}>
              <Text style={[cs.yearTabTxt, selectedYear === 'all' && cs.yearTabTxtActive]}>All</Text>
            </TouchableOpacity>
            {years.map(y => (
              <TouchableOpacity key={y} onPress={() => { setSelectedYear(y); setSelectedSymbol(null); }} style={[cs.yearTab, selectedYear === y && cs.yearTabActive]}>
                <Text style={[cs.yearTabTxt, selectedYear === y && cs.yearTabTxtActive]}>{y}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

        {/* Year summary */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, gap: 12 }}>
          <View style={cs.summaryPill}>
            <Text style={cs.summaryLabel}>Total</Text>
            <Text style={cs.summaryValue}>{fmtTotal(totalYear)}</Text>
          </View>
          {totalPaid > 0 && (
            <View style={cs.summaryPill}>
              <Text style={cs.summaryLabel}>Paid</Text>
              <Text style={[cs.summaryValue, { color: '#22c55e' }]}>{fmtTotal(totalPaid)}</Text>
            </View>
          )}
          {totalFcast > 0 && (
            <View style={cs.summaryPill}>
              <Text style={cs.summaryLabel}>Forecasted</Text>
              <Text style={[cs.summaryValue, { color: '#94a3b8' }]}>{fmtTotal(totalFcast)}</Text>
            </View>
          )}
        </View>

        {/* Company filter pills */}
        {symbols.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 48, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => setSelectedSymbol(null)} style={[cs.pill, selectedSymbol === null && cs.pillActive]}>
              <Text style={[cs.pillTxt, selectedSymbol === null && cs.pillTxtActive]}>All</Text>
            </TouchableOpacity>
            {symbols.map(sym => {
              const isSelected = selectedSymbol === sym;
              return (
                <TouchableOpacity
                  key={sym}
                  onPress={() => setSelectedSymbol(isSelected ? null : sym)}
                  style={[cs.pill, isSelected && { backgroundColor: '#6366f133', borderColor: '#6366f1' }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    {logoErrors[sym] ? (
                      <View style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: isSelected ? '#6366f155' : '#33415555', alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 7, color: isSelected ? '#6366f1' : '#64748b', fontWeight: '700' }}>{sym.slice(0, 1)}</Text>
                      </View>
                    ) : (
                      <Image source={{ uri: logoUrl(sym) }} style={{ width: 16, height: 16, borderRadius: 3 }} onError={() => setLogoErrors(prev => ({ ...prev, [sym]: true }))} />
                    )}
                    <Text style={[cs.pillTxt, isSelected && { color: '#6366f1' }]}>{sym}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
        </View>{/* end fixed top section */}

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          {/* Bar chart — by year (All) or by month (specific year) */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 16, paddingBottom: 8 }}>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {selectedYear === 'all' ? byYear.map((a) => {
                const total = a.total;
                const filteredTotal = selectedSymbol ? (a.bySymbol.find(s => s.symbol === selectedSymbol)?.total ?? 0) : total;
                const dimmed = selectedSymbol !== null && !a.symbols.includes(selectedSymbol);
                const displayAmt = selectedSymbol ? filteredTotal : total;
                return (
                  <View key={a.year} style={{ alignItems: 'center', width: 52 }}>
                    <View style={{ height: BAR_MAX_H, justifyContent: 'flex-end', alignItems: 'center', gap: 0 }}>
                      {a.bySymbol.filter(s => s.total > 0).map(s => {
                        const segH = Math.max((s.total / maxVal) * BAR_MAX_H, 4);
                        const segDimmed = selectedSymbol !== null && selectedSymbol !== s.symbol;
                        const color = colorOf(s.symbol);
                        const isForecast = s.paid === 0 && !segDimmed;
                        if (isForecast) {
                          const stripes = Math.ceil((30 + segH) / 7) + 2;
                          return (
                            <View key={s.symbol} style={{ width: 30, height: segH, backgroundColor: color + '22', overflow: 'hidden' }}>
                              {Array.from({ length: stripes }, (_, idx) => (
                                <View key={idx} style={{ position: 'absolute', left: -20, top: idx * 7 - 20, width: 80, height: 2, backgroundColor: color, opacity: 0.55, transform: [{ rotate: '-45deg' }] }} />
                              ))}
                            </View>
                          );
                        }
                        return (
                          <View key={s.symbol} style={{ width: 30, height: segH, backgroundColor: segDimmed ? '#1e293b' : color }} />
                        );
                      })}
                      {total === 0 && <View style={{ width: 2, height: 4, backgroundColor: '#1e293b', borderRadius: 1 }} />}
                    </View>
                    <Text style={{ color: dimmed ? '#334155' : '#64748b', fontSize: 10, marginTop: 5 }}>{a.year}</Text>
                    <Text style={{ color: dimmed ? '#334155' : (displayAmt > 0 ? '#e2e8f0' : '#334155'), fontSize: 10, fontWeight: '600', marginTop: 2 }} numberOfLines={1}>
                      {displayAmt > 0 ? fmtAmt(displayAmt) : '—'}
                    </Text>
                    <View style={{ marginTop: 6, borderWidth: 1, borderColor: '#1e293b', borderRadius: 5, padding: 3, width: 46, height: 56, alignSelf: 'center', justifyContent: 'center' }}>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 2 }}>
                        {a.symbols.map(sym => {
                          const color = colorOf(sym);
                          const isHighlighted = selectedSymbol === null || selectedSymbol === sym;
                          const sz = logoSize(a.symbols.length);
                          return (
                            <TouchableOpacity key={sym} onPress={() => setSelectedSymbol(selectedSymbol === sym ? null : sym)}>
                              {logoErrors[sym] ? (
                                <View style={{ width: sz, height: sz, borderRadius: 3, backgroundColor: color + (isHighlighted ? '44' : '11'), alignItems: 'center', justifyContent: 'center' }}>
                                  <Text style={{ fontSize: sz * 0.38, color: isHighlighted ? color : '#334155', fontWeight: '700' }}>{sym.slice(0, 2)}</Text>
                                </View>
                              ) : (
                                <Image source={{ uri: logoUrl(sym) }} style={{ width: sz, height: sz, borderRadius: 3, opacity: isHighlighted ? 1 : 0.2 }} onError={() => setLogoErrors(prev => ({ ...prev, [sym]: true }))} />
                              )}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                );
              }) : byMonth.map((m, i) => {
                const total = m.total;
                const filteredTotal = selectedSymbol ? (m.bySymbol.find(s => s.symbol === selectedSymbol)?.total ?? 0) : total;
                const dimmed = selectedSymbol !== null && !m.symbols.includes(selectedSymbol);
                const displayAmt = selectedSymbol ? filteredTotal : total;
                return (
                  <View key={i} style={{ alignItems: 'center', width: 52 }}>
                    <View style={{ height: BAR_MAX_H, justifyContent: 'flex-end', alignItems: 'center', gap: 0 }}>
                      {m.bySymbol.filter(s => s.total > 0).map(s => {
                        const segH = Math.max((s.total / maxVal) * BAR_MAX_H, 4);
                        const segDimmed = selectedSymbol !== null && selectedSymbol !== s.symbol;
                        const color = colorOf(s.symbol);
                        const isForecast = s.paid === 0 && !segDimmed;
                        if (isForecast) {
                          const stripes = Math.ceil((30 + segH) / 7) + 2;
                          return (
                            <View key={s.symbol} style={{ width: 30, height: segH, backgroundColor: color + '22', overflow: 'hidden' }}>
                              {Array.from({ length: stripes }, (_, idx) => (
                                <View key={idx} style={{ position: 'absolute', left: -20, top: idx * 7 - 20, width: 80, height: 2, backgroundColor: color, opacity: 0.55, transform: [{ rotate: '-45deg' }] }} />
                              ))}
                            </View>
                          );
                        }
                        return (
                          <View key={s.symbol} style={{ width: 30, height: segH, backgroundColor: segDimmed ? '#1e293b' : color }} />
                        );
                      })}
                      {total === 0 && <View style={{ width: 2, height: 4, backgroundColor: '#1e293b', borderRadius: 1 }} />}
                    </View>
                    <Text style={{ color: dimmed ? '#334155' : '#64748b', fontSize: 10, marginTop: 5 }}>{MONTHS[i]}</Text>
                    <Text style={{ color: dimmed ? '#334155' : (displayAmt > 0 ? '#e2e8f0' : '#334155'), fontSize: 10, fontWeight: '600', marginTop: 2 }} numberOfLines={1}>
                      {displayAmt > 0 ? fmtAmt(displayAmt) : '—'}
                    </Text>
                    <View style={{ marginTop: 6, borderWidth: 1, borderColor: '#1e293b', borderRadius: 5, padding: 3, width: 46, height: 56, alignSelf: 'center', justifyContent: 'center' }}>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 2 }}>
                        {m.symbols.map(sym => {
                          const color = colorOf(sym);
                          const isHighlighted = selectedSymbol === null || selectedSymbol === sym;
                          const sz = logoSize(m.symbols.length);
                          return (
                            <TouchableOpacity key={sym} onPress={() => setSelectedSymbol(selectedSymbol === sym ? null : sym)}>
                              {logoErrors[sym] ? (
                                <View style={{ width: sz, height: sz, borderRadius: 3, backgroundColor: color + (isHighlighted ? '44' : '11'), alignItems: 'center', justifyContent: 'center' }}>
                                  <Text style={{ fontSize: sz * 0.38, color: isHighlighted ? color : '#334155', fontWeight: '700' }}>{sym.slice(0, 2)}</Text>
                                </View>
                              ) : (
                                <Image source={{ uri: logoUrl(sym) }} style={{ width: sz, height: sz, borderRadius: 3, opacity: isHighlighted ? 1 : 0.2 }} onError={() => setLogoErrors(prev => ({ ...prev, [sym]: true }))} />
                              )}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>

          {/* Monthly detail list — hidden in All mode */}
          {selectedYear !== 'all' && byMonth.map((m, i) => {
            const monthEntries = selectedSymbol
              ? m.all.filter(e => e.symbol === selectedSymbol)
              : m.all;
            if (monthEntries.length === 0) return null;
            const monthTotal = monthEntries.reduce((s, e) => s + e.total, 0);
            const monthLabel = `${MONTHS[i]} ${selectedYear}`;

            return (
              <View key={i}>
                <View style={cs.monthHeader}>
                  <Text style={cs.monthTitle}>{monthLabel}</Text>
                  <Text style={cs.monthTotal}>{fmtTotal(monthTotal)}</Text>
                </View>

                {monthEntries.map((e, idx) => {
                  const color = colorOf(e.symbol);
                  const isFuture = e.status !== 'paid';
                  const displayTs = e.payDate ?? e.timestamp;
                  const d = new Date(displayTs * 1000);
                  const day = d.getDate();
                  const yearSuffix = '';
                  return (
                    <View key={idx} style={cs.entryRow}>
                      {logoErrors[e.symbol] ? (
                        <View style={{ width: 38, height: 38, borderRadius: 8, backgroundColor: color + '33', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{e.symbol.slice(0, 2)}</Text>
                        </View>
                      ) : (
                        <Image
                          source={{ uri: logoUrl(e.symbol) }}
                          style={{ width: 38, height: 38, borderRadius: 8 }}
                          onError={() => setLogoErrors(prev => ({ ...prev, [e.symbol]: true }))}
                        />
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={cs.entryName} numberOfLines={1}>{e.name}</Text>
                        <Text style={cs.entryDate}>{MONTHS[i]} {day}{yearSuffix} · {e.symbol}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[cs.entryAmt, { color: isFuture ? '#64748b' : '#f8fafc' }]}>
                          {fmtTotal(e.total)}
                        </Text>
                        <View style={[cs.badge, isFuture ? cs.badgeFcast : cs.badgePaid]}>
                          <Text style={[cs.badgeTxt, isFuture ? cs.badgeFcastTxt : cs.badgePaidTxt]}>
                            {e.status === 'declared' ? 'Declared' : isFuture ? 'Forecasted' : 'Paid'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
                <View style={cs.sep} />
              </View>
            );
          })}

          {selectedYear !== 'all' && yearEntries.length === 0 && (
            <Text style={cs.empty}>No dividends for {selectedYear}.</Text>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const cs = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700' },

  yearTabScroll: { maxHeight: 44, flexGrow: 0 },
  yearTabRow: { paddingHorizontal: 16, gap: 8, flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  yearTab: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
  yearTabActive: { backgroundColor: '#1e293b' },
  yearTabTxt: { color: '#64748b', fontSize: 14, fontWeight: '600' },
  yearTabTxtActive: { color: '#f8fafc' },

  summaryPill: { flex: 1, backgroundColor: '#1e293b', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  summaryLabel: { color: '#64748b', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  summaryValue: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },

  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  pillActive: { backgroundColor: '#6366f133', borderColor: '#6366f1' },
  pillTxt: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  pillTxtActive: { color: '#6366f1' },

  monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, marginTop: 10 },
  monthTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },
  monthTotal: { color: '#f8fafc', fontSize: 14, fontWeight: '600' },

  entryRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  entryName: { color: '#e2e8f0', fontSize: 14, fontWeight: '600', maxWidth: 160 },
  entryDate: { color: '#64748b', fontSize: 12, marginTop: 2 },
  entryAmt: { fontSize: 14, fontWeight: '600' },

  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, marginTop: 3 },
  badgePaid: { backgroundColor: '#166534' },
  badgePaidTxt: { color: '#4ade80' },
  badgeFcast: { backgroundColor: '#312e81' },
  badgeFcastTxt: { color: '#a5b4fc' },
  badgeTxt: { fontSize: 10, fontWeight: '600' },

  sep: { height: 1, backgroundColor: '#1e293b', marginHorizontal: 16, marginTop: 4 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 60, fontSize: 15 },
});
