import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, SectionList, FlatList, ActivityIndicator,
  TouchableOpacity, RefreshControl, Linking, ScrollView, Image, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { usePortfolio } from '../context/PortfolioContext';
import { fmp, getFmpKey } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CAL_CACHE_KEY  = 'financial_calendar_v7';
const CAL_TTL_MS     = 6 * 60 * 60 * 1000; // 6 horas
const NEWS_CACHE_KEY = 'financial_news_v1';
const NEWS_TTL_MS    = 30 * 60 * 1000;     // 30 min
const AV_KEY         = 'DAZQBTW5WH6CYCCI';
const av            = axios.create({ baseURL: 'https://www.alphavantage.co' });
const fh            = axios.create({ baseURL: 'https://finnhub.io/api/v1' });

// ─── Types ────────────────────────────────────────────────────────────────────

type EventType  = 'earnings' | 'macro';
type FilterType = EventType | 'news';

type MacroPeriod = 'ontem' | 'hoje' | 'amanha' | 'semana' | 'proxsemana';

interface CalEvent {
  id: string;
  type: EventType;
  title: string;
  subtitle?: string;
  time?: string;           // "BMO" | "AMC" | "09:30"
  impact?: 'high' | 'medium' | 'low';
  impactLevel?: 1 | 2 | 3; // 1=low 2=med 3=high
  actual?: string;
  estimate?: string;
  previous?: string;
  logo?: string;
  country?: string;        // "US", "EU", "GB" …
  unit?: string;
  inPortfolio?: boolean;
}

interface NewsArticle {
  id: string;
  headline: string;
  source: string;
  url: string;
  datetime: number;  // unix seconds
  summary?: string;
  image?: string;
}

interface DaySection {
  date: string;        // "2026-04-25"
  label: string;       // "Hoje · Qua 25 Abr"
  data: CalEvent[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(base: string, n: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayLabel(dateStr: string, todayStr: string) {
  const diff = Math.round(
    (new Date(dateStr).getTime() - new Date(todayStr).getTime()) / 86400000
  );
  const d = new Date(dateStr);
  const formatted = d.toLocaleDateString('pt-PT', {
    weekday: 'short', day: '2-digit', month: 'short',
  });
  if (diff === 0) return `Hoje · ${formatted}`;
  if (diff === 1) return `Amanhã · ${formatted}`;
  if (diff === -1) return `Ontem · ${formatted}`;
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

const IMPACT_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#475569' };

function countryFlag(code: string): string {
  const c = (code ?? '').toUpperCase();
  if (c === 'EU') return '\uD83C\uDDEA\uD83C\uDDFA';
  if (c === 'GB') return '\uD83C\uDDEC\uD83C\uDDE7';
  if (c.length !== 2) return '\uD83C\uDF0D';
  return String.fromCodePoint(
    0x1F1E6 + c.charCodeAt(0) - 65,
    0x1F1E6 + c.charCodeAt(1) - 65,
  );
}

function impactStars(level: 1|2|3): string {
  if (level === 3) return '\u2605\u2605\u2605';
  if (level === 2) return '\u2605\u2605\u2606';
  return '\u2605\u2606\u2606';
}

function fmtVal(val: string | undefined, unit?: string): string {
  if (!val) return '—';
  return unit ? `${val} ${unit}` : val;
}
const TYPE_ICON: Record<EventType, string> = {
  earnings: 'bar-chart-outline',
  macro: 'globe-outline',
};
const TYPE_COLOR: Record<EventType, string> = {
  earnings: '#6366f1',
  macro: '#0ea5e9',
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function FinancialCalendarScreen() {
  const { holdings, watchlist } = usePortfolio();
  const { fhKey } = useSettings();
  const [sections, setSections] = useState<DaySection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('earnings');
  const [newsItems, setNewsItems]         = useState<NewsArticle[]>([]);
  const [newsLoading, setNewsLoading]     = useState(false);
  const [macroPeriod, setMacroPeriod]     = useState<MacroPeriod>('hoje');
  const [macroImpact, setMacroImpact]     = useState<0|1|2|3>(0);  // 0=todos
  const [macroSections, setMacroSections] = useState<DaySection[]>([]);
  const [macroLoading, setMacroLoading]   = useState(false);
  const [showCountryModal, setShowCountryModal] = useState(false);
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(new Set());

  // Stable string arrays for deps (Sets would be new objects every render)
  const portfolioSyms = holdings.map(h => h.symbol.toUpperCase());
  const watchlistSyms = watchlist.map(w => w.symbol.toUpperCase());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const portfolioKey = portfolioSyms.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const watchlistKey = watchlistSyms.join(',');

  const fetchData = useCallback(async (forceRefresh = false) => {
    // Compute sets inside so closure is always fresh
    const portfolioSymbols = new Set(portfolioSyms);
    const watchlistSymbols = new Set(watchlistSyms);
    const trackedSymbols   = new Set([...portfolioSymbols, ...watchlistSymbols]);

    const today = todayStr();
    const from  = addDays(today, -7);
    const to    = addDays(today, 30);

    if (!forceRefresh) {
      try {
        const raw = await AsyncStorage.getItem(CAL_CACHE_KEY);
        if (raw) {
          const { data, expiresAt, cacheDate } = JSON.parse(raw);
          if (Date.now() < expiresAt && cacheDate === today) {
            setSections(data);
            setLoading(false);
            setRefreshing(false);
            return;
          }
        }
      } catch { /* ignore */ }
    }

    try {
      const byDate: Record<string, CalEvent[]> = {};
      const ensure = (d: string) => { if (!byDate[d]) byDate[d] = []; };

      // ── 1. Earnings — Finnhub por símbolo (um pedido por ticker) ─────────────
      try {
        if (fhKey) {
          await Promise.all([...trackedSymbols].map(async (sym) => {
            try {
              // Upcoming earnings date via calendar endpoint
              const calRes = await fh.get('/calendar/earnings', {
                params: { symbol: sym, from, to, token: fhKey },
              });
              // Profile for logo + company name
              const profRes = await fh.get('/stock/profile2', {
                params: { symbol: sym, token: fhKey },
              });
              const prof = profRes.data ?? {};
              const logoUrl: string | undefined = prof.logo ? String(prof.logo) : undefined;
              const companyName: string = prof.name ? String(prof.name) : sym;

              const rows: Record<string, unknown>[] = Array.isArray(calRes.data?.earningsCalendar)
                ? calRes.data.earningsCalendar : [];
              rows.forEach(r => {
                const d = String(r.date ?? '').slice(0, 10);
                if (!d) return;
                ensure(d);
                byDate[d].push({
                  id: `earn-fh-${sym}-${d}`,
                  type: 'earnings',
                  title: sym,
                  subtitle: companyName,
                  logo: logoUrl,
                  time: String(r.hour ?? '') === 'bmo' ? 'BMO' : String(r.hour ?? '') === 'amc' ? 'AMC' : undefined,
                  estimate: r.epsEstimate != null ? `EPS est. $${Number(r.epsEstimate).toFixed(2)}` : undefined,
                  actual:   r.epsActual   != null ? `EPS real $${Number(r.epsActual).toFixed(2)}`   : undefined,
                  inPortfolio: portfolioSymbols.has(sym),
                });
              });
            } catch { /* ignore symbol */ }
          }));
        } else {
          // fallback: Alpha Vantage CSV (todos os symbols), filtrar pelos nossos
          const avRes = await av.get('/query', {
            params: { function: 'EARNINGS_CALENDAR', horizon: '3month', apikey: AV_KEY },
            responseType: 'text',
          });
          const lines: string[] = String(avRes.data ?? '').split('\n').filter(Boolean);
          lines.slice(1).forEach((line, i) => {
            const [sym, name, reportDate, , estimate, , timeOfDay] = line.split(',');
            const symU = (sym ?? '').toUpperCase();
            if (!trackedSymbols.has(symU)) return;
            const d = (reportDate ?? '').slice(0, 10);
            if (!d || d < from || d > to) return;
            ensure(d);
            byDate[d].push({
              id: `earn-av-${i}`,
              type: 'earnings',
              title: symU,
              subtitle: name ?? symU,
              time: timeOfDay?.trim() === 'pre-market' ? 'BMO' : timeOfDay?.trim() === 'post-market' ? 'AMC' : undefined,
              estimate: estimate?.trim() ? `EPS est. $${Number(estimate).toFixed(2)}` : undefined,
              inPortfolio: portfolioSymbols.has(symU),
            });
          });
        }
      } catch { /* ignore */ }

      // ── 2. Macro — fetched separately by fetchMacro() ──────────────────────

      // Sort dates and build sections
      const sorted = Object.keys(byDate).sort();
      const result: DaySection[] = sorted.map(d => ({
        date: d,
        label: dayLabel(d, today),
        data: byDate[d],
      }));

      setSections(result);
      try {
        await AsyncStorage.setItem(CAL_CACHE_KEY, JSON.stringify({
          data: result, expiresAt: Date.now() + CAL_TTL_MS, cacheDate: today,
        }));
      } catch { /* ignore */ }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [portfolioKey, watchlistKey, fhKey]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fixed list of common economic calendar countries
  const ALL_COUNTRIES: { code: string; name: string }[] = [
    { code: 'US', name: 'Estados Unidos' },
    { code: 'EU', name: 'Zona Euro' },
    { code: 'GB', name: 'Reino Unido' },
    { code: 'DE', name: 'Alemanha' },
    { code: 'FR', name: 'França' },
    { code: 'JP', name: 'Japão' },
    { code: 'CA', name: 'Canadá' },
    { code: 'AU', name: 'Austrália' },
    { code: 'CH', name: 'Suíça' },
    { code: 'CN', name: 'China' },
    { code: 'NZ', name: 'Nova Zelândia' },
    { code: 'IT', name: 'Itália' },
    { code: 'ES', name: 'Espanha' },
    { code: 'BR', name: 'Brasil' },
    { code: 'IN', name: 'Índia' },
  ];

  // Apply impact + country filters
  const filteredMacroSections = useMemo(() => {
    return macroSections.map(s => ({
      ...s,
      data: s.data.filter(e => {
        if (macroImpact !== 0 && e.impactLevel !== macroImpact) return false;
        if (selectedCountries.size > 0 && !selectedCountries.has(e.country ?? '')) return false;
        return true;
      }),
    })).filter(s => s.data.length > 0);
  }, [macroSections, macroImpact, selectedCountries]);

  const toggleCountry = (code: string) => {
    setSelectedCountries(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };
  const MACRO_PERIODS: Record<MacroPeriod, { label: string; from: (t: string) => string; to: (t: string) => string }> = {
    ontem:      { label: 'Ontem',          from: t => addDays(t,-1), to: t => addDays(t,-1) },
    hoje:       { label: 'Hoje',           from: t => t,             to: t => t             },
    amanha:     { label: 'Amanhã',         from: t => addDays(t,1),  to: t => addDays(t,1)  },
    semana:     { label: 'Esta Semana',    from: t => t,             to: t => addDays(t,6)  },
    proxsemana: { label: 'Próxima Semana', from: t => addDays(t,7),  to: t => addDays(t,13) },
  };

  const fetchMacro = useCallback(async (period: MacroPeriod, forceRefresh = false) => {
    const today = todayStr();
    const from  = MACRO_PERIODS[period].from(today);
    const to    = MACRO_PERIODS[period].to(today);
    const cacheKey = `macro_cal_v2_${period}`;

    if (!forceRefresh) {
      try {
        const raw = await AsyncStorage.getItem(cacheKey);
        if (raw) {
          const { data, expiresAt } = JSON.parse(raw);
          if (Date.now() < expiresAt) { setMacroSections(data); return; }
        }
      } catch { /* ignore */ }
    }

    setMacroLoading(true);
    try {
      // Finnhub /calendar/economic — FED, CPI, NFP, desemprego, etc.
      if (!fhKey) {
        setMacroSections([]);
        return;
      }
      const macroRes = await fh.get('/calendar/economic', {
        params: { from, to, token: fhKey },
      });
      const rows: Record<string, unknown>[] = Array.isArray(macroRes.data?.economicCalendar)
        ? macroRes.data.economicCalendar : [];
      const byDate: Record<string, CalEvent[]> = {};
      const ensure = (d: string) => { if (!byDate[d]) byDate[d] = []; };
      rows.forEach((r, i) => {
        // Finnhub time field: "2026-04-28 13:30:00" or "2026-04-28"
        const rawDate = String(r.time ?? r.date ?? '');
        const d = rawDate.slice(0, 10);
        const timeStr = rawDate.length > 10 ? rawDate.slice(11, 16) : undefined;
        if (!d) return;
        ensure(d);
        const impactStr = String(r.impact ?? '').toLowerCase();
        const impactLevel: 1|2|3 = impactStr === 'high' ? 3 : impactStr === 'medium' ? 2 : 1;
        const unit = r.unit ? String(r.unit) : undefined;
        const fmtRaw = (v: unknown) =>
          v != null && String(v).trim() !== '' ? String(v) : undefined;
        byDate[d].push({
          id: `macro-fh-${i}`,
          type: 'macro',
          title:       String(r.event ?? ''),
          country:     String(r.country ?? '').toUpperCase(),
          time:        timeStr,
          impact:      impactLevel === 3 ? 'high' : impactLevel === 2 ? 'medium' : 'low',
          impactLevel,
          unit,
          actual:      fmtRaw(r.actual),
          estimate:    fmtRaw(r.estimate),
          previous:    fmtRaw(r.prev),        // Finnhub usa "prev"
        });
      });
      const sorted = Object.keys(byDate).sort();
      const result: DaySection[] = sorted.map(d => ({
        date: d,
        label: dayLabel(d, today),
        data: byDate[d],
      }));
      setMacroSections(result);
      try {
        await AsyncStorage.setItem(cacheKey, JSON.stringify({
          data: result, expiresAt: Date.now() + CAL_TTL_MS,
        }));
      } catch { /* ignore */ }
    } catch { /* ignore */ }
    finally { setMacroLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (filter === 'macro') fetchMacro(macroPeriod); }, [filter, macroPeriod, fetchMacro]);

  // ── News fetch ─────────────────────────────────────────────────────────────
  const fetchNews = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh) {
      try {
        const raw = await AsyncStorage.getItem(NEWS_CACHE_KEY);
        if (raw) {
          const { data, expiresAt } = JSON.parse(raw);
          if (Date.now() < expiresAt) { setNewsItems(data); return; }
        }
      } catch { /* ignore */ }
    }
    setNewsLoading(true);
    try {
      let articles: NewsArticle[] = [];
      // 1) Finnhub general news
      if (fhKey) {
        try {
          const res = await fh.get('/news', { params: { category: 'general', token: fhKey } });
          const rows: Record<string, unknown>[] = Array.isArray(res.data) ? res.data : [];
          articles = rows.slice(0, 40).map((r, i) => ({
            id: `fh-news-${i}`,
            headline: String(r.headline ?? ''),
            source: String(r.source ?? 'Finnhub'),
            url: String(r.url ?? ''),
            datetime: Number(r.datetime ?? 0),
            summary: r.summary ? String(r.summary).slice(0, 160) : undefined,
            image: r.image ? String(r.image) : undefined,
          })).filter(a => a.headline);
        } catch { /* ignore */ }
      }
      // 2) FMP general market news (fallback or complement)
      if (articles.length === 0) {
        try {
          const res = await fmp.get('/stable/news', {
            params: { limit: 40, apikey: getFmpKey() },
          });
          const rows: Record<string, unknown>[] = Array.isArray(res.data) ? res.data : [];
          articles = rows.slice(0, 40).map((r, i) => ({
            id: `fmp-news-${i}`,
            headline: String(r.title ?? ''),
            source: String(r.site ?? 'FMP'),
            url: String(r.url ?? ''),
            datetime: r.publishedDate
              ? Math.floor(new Date(String(r.publishedDate)).getTime() / 1000)
              : 0,
            summary: r.text ? String(r.text).slice(0, 160) : undefined,
            image: r.image ? String(r.image) : undefined,
          })).filter(a => a.headline);
        } catch { /* ignore */ }
      }
      // Sort newest first
      articles.sort((a, b) => b.datetime - a.datetime);
      setNewsItems(articles);
      try {
        await AsyncStorage.setItem(NEWS_CACHE_KEY, JSON.stringify({
          data: articles, expiresAt: Date.now() + NEWS_TTL_MS,
        }));
      } catch { /* ignore */ }
    } finally {
      setNewsLoading(false);
    }
  }, [fhKey]);

  useEffect(() => { if (filter === 'news') fetchNews(); }, [filter, fetchNews]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData(true);
    if (filter === 'macro') fetchMacro(macroPeriod, true);
    if (filter === 'news') fetchNews(true);
  };

  // ── Filter bar ─────────────────────────────────────────────────────────────

  const FILTERS: { key: FilterType; label: string; icon: string }[] = [
    { key: 'earnings',  label: 'Earnings',   icon: 'bar-chart-outline' },
    { key: 'macro',     label: 'Macro',      icon: 'globe-outline' },
    { key: 'news',      label: 'Notícias',   icon: 'newspaper-outline' },
  ];

  // ── Rendering ──────────────────────────────────────────────────────────────

  const filteredSections = sections.map(s => ({
    ...s,
    data: s.data.filter(e => {
      if (filter === 'news') return false;
      return e.type === filter;
    }),
  })).filter(s => s.data.length > 0);

  const renderEvent = ({ item }: { item: CalEvent }) => (
    <View style={[styles.eventRow, item.inPortfolio && styles.eventRowHighlight]}>
      <View style={[styles.iconWrap, { backgroundColor: TYPE_COLOR[item.type] + '22', overflow: 'hidden' }]}>
        {item.logo ? (
          <Image
            source={{ uri: item.logo }}
            style={{ width: 28, height: 28, borderRadius: 6 }}
            onError={() => {}}
          />
        ) : (
          <Ionicons name={TYPE_ICON[item.type] as any} size={16} color={TYPE_COLOR[item.type]} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.eventTitle} numberOfLines={1}>{item.title}</Text>
          {item.inPortfolio && (
            <View style={styles.portfolioBadge}>
              <Text style={styles.portfolioBadgeTxt}>portf.</Text>
            </View>
          )}
          {!item.inPortfolio && watchlistSyms.includes(item.title) && (
            <View style={[styles.portfolioBadge, { backgroundColor: '#0ea5e922' }]}>
              <Text style={[styles.portfolioBadgeTxt, { color: '#38bdf8' }]}>watch</Text>
            </View>
          )}
          {item.impact && (
            <View style={[styles.impactDot, { backgroundColor: IMPACT_COLOR[item.impact] }]} />
          )}
        </View>
        {item.subtitle ? <Text style={styles.eventSub} numberOfLines={1}>{item.subtitle}</Text> : null}
        {(item.estimate || item.actual) ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
            {item.estimate ? <Text style={styles.eventMeta}>{item.estimate}</Text> : null}
            {item.actual   ? <Text style={[styles.eventMeta, { color: '#22c55e' }]}>{item.actual}</Text> : null}
          </View>
        ) : null}
      </View>
      {item.time ? (
        <Text style={styles.eventTime}>{item.time}</Text>
      ) : null}
    </View>
  );

  const renderSectionHeader = ({ section }: { section: DaySection }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionLabel}>{section.label}</Text>
    </View>
  );

  // ── Macro row (investing.com style) ────────────────────────────────────────

  const renderMacroEvent = ({ item }: { item: CalEvent }) => {
    const iL = item.impactLevel ?? 1;
    const starColor = iL === 3 ? '#ef4444' : iL === 2 ? '#f59e0b' : '#475569';
    const hasValues = item.actual || item.estimate || item.previous;
    return (
      <View style={styles.macroRow}>
        {/* Time + country col */}
        <View style={styles.macroLeft}>
          <Text style={styles.macroTime}>{item.time || '—'}</Text>
          <Text style={styles.macroFlag}>{countryFlag(item.country ?? '')}</Text>
          <Text style={styles.macroCountry}>{item.country ?? ''}</Text>
        </View>
        {/* Event + values */}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text style={styles.macroTitle}>{item.title}</Text>
            <Text style={[styles.macroStars, { color: starColor }]}>{impactStars(iL as 1|2|3)}</Text>
          </View>
          {hasValues && (
            <View style={styles.macroValRow}>
              <View style={styles.macroValCell}>
                <Text style={styles.macroValLabel}>Actual</Text>
                <Text style={[styles.macroValNum, item.actual ? { color: '#22c55e' } : { color: '#475569' }]}>
                  {fmtVal(item.actual, item.unit)}
                </Text>
              </View>
              <View style={styles.macroValCell}>
                <Text style={styles.macroValLabel}>Forecast</Text>
                <Text style={styles.macroValNum}>{fmtVal(item.estimate, item.unit)}</Text>
              </View>
              <View style={styles.macroValCell}>
                <Text style={styles.macroValLabel}>Previous</Text>
                <Text style={styles.macroValNum}>{fmtVal(item.previous, item.unit)}</Text>
              </View>
            </View>
          )}
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={{ color: '#64748b', marginTop: 12 }}>Loading events...</Text>
      </View>
    );
  }

  return (
    <>
    <View style={styles.container}>
      {/* Filter chips */}
      <View style={styles.filterBar}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.chip, filter === f.key && styles.chipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Ionicons name={f.icon as any} size={13} color={filter === f.key ? '#fff' : '#94a3b8'} />
            <Text style={[styles.chipTxt, filter === f.key && { color: '#fff' }]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Macro period bar */}
      {filter === 'macro' && (
        <>
          <View style={styles.periodBar}>
            {(Object.keys(MACRO_PERIODS) as MacroPeriod[]).map(p => (
              <TouchableOpacity
                key={p}
                style={[styles.periodChip, macroPeriod === p && styles.periodChipActive]}
                onPress={() => setMacroPeriod(p)}
              >
                <Text style={[styles.periodTxt, macroPeriod === p && { color: '#f8fafc' }]}>
                  {MACRO_PERIODS[p].label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {/* Impact filter */}
          <View style={styles.impactBar}>
            <View style={{ flexDirection: 'row', gap: 6, flex: 1 }}>
              {([0,3,2,1] as const).map(lvl => {
                const labels: Record<number,string> = { 0:'All', 3:'★★★', 2:'★★☆', 1:'★☆☆' };
                const colors: Record<number,string> = { 0:'#64748b', 3:'#ef4444', 2:'#f59e0b', 1:'#475569' };
                const active = macroImpact === lvl;
                return (
                  <TouchableOpacity
                    key={lvl}
                    style={[styles.impactChip, active && { borderColor: colors[lvl], backgroundColor: colors[lvl] + '22' }]}
                    onPress={() => setMacroImpact(lvl)}
                  >
                    <Text style={[styles.impactChipTxt, { color: active ? colors[lvl] : '#475569' }]}>
                      {labels[lvl]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity
              style={[styles.impactChip, {
                flexDirection: 'row', alignItems: 'center', gap: 4,
                borderColor: selectedCountries.size > 0 ? '#0ea5e9' : '#1e293b',
                backgroundColor: selectedCountries.size > 0 ? '#0ea5e922' : 'transparent',
              }]}
              onPress={() => setShowCountryModal(true)}
            >
              <Ionicons name="flag-outline" size={12} color={selectedCountries.size > 0 ? '#0ea5e9' : '#475569'} />
              <Text style={[styles.impactChipTxt, { color: selectedCountries.size > 0 ? '#0ea5e9' : '#475569' }]}>
                {selectedCountries.size > 0 ? `${selectedCountries.size} countr${selectedCountries.size > 1 ? 'ies' : 'y'}` : 'Countries'}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {filter === 'news' ? (
        newsLoading && newsItems.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#6366f1" />
            <Text style={{ color: '#64748b', marginTop: 12 }}>Loading news...</Text>
          </View>
        ) : (
          <FlatList
            data={newsItems}
            keyExtractor={item => item.id}
            contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={newsLoading} onRefresh={() => fetchNews(true)} tintColor="#6366f1" />}
            ListEmptyComponent={
              <View style={styles.center}>
                <Ionicons name="newspaper-outline" size={48} color="#334155" />
                <Text style={{ color: '#64748b', marginTop: 12 }}>No news available</Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.newsRow}
                onPress={() => item.url && Linking.openURL(item.url)}
                activeOpacity={0.75}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.newsHeadline} numberOfLines={3}>{item.headline}</Text>
                  {item.summary ? (
                    <Text style={styles.newsSummary} numberOfLines={2}>{item.summary}</Text>
                  ) : null}
                  <View style={styles.newsMeta}>
                    <Text style={styles.newsSource}>{item.source}</Text>
                    {item.datetime > 0 && (
                      <Text style={styles.newsTime}>
                        {new Date(item.datetime * 1000).toLocaleString('pt-PT', {
                          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                        })}
                      </Text>
                    )}
                  </View>
                </View>
                <Ionicons name="open-outline" size={14} color="#475569" style={{ marginLeft: 8, marginTop: 2 }} />
              </TouchableOpacity>
            )}
          />
        )
      ) : filter === 'macro' ? (
        macroLoading && macroSections.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#0ea5e9" />
            <Text style={{ color: '#64748b', marginTop: 12 }}>Loading calendar...</Text>
          </View>
        ) : macroSections.length === 0 ? (
          <View style={styles.center}>
            {!fhKey ? (
              <>
                <Ionicons name="key-outline" size={40} color="#334155" />
                <Text style={{ color: '#64748b', marginTop: 12, textAlign: 'center', paddingHorizontal: 32 }}>
                  {'Add a Finnhub API key in Settings to view the macro calendar.'}
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="globe-outline" size={48} color="#334155" />
                <Text style={{ color: '#64748b', marginTop: 12 }}>No events for this period</Text>
              </>
            )}
          </View>
        ) : (
          <SectionList
            sections={filteredMacroSections}
            keyExtractor={item => item.id}
            renderItem={renderMacroEvent}
            renderSectionHeader={renderSectionHeader}
            contentContainerStyle={{ paddingBottom: 40 }}
            stickySectionHeadersEnabled
            ListEmptyComponent={
              <View style={styles.center}>
                <Ionicons name="globe-outline" size={48} color="#334155" />
                <Text style={{ color: '#64748b', marginTop: 12 }}>No events with this impact</Text>
              </View>
            }
            refreshControl={<RefreshControl refreshing={macroLoading} onRefresh={() => fetchMacro(macroPeriod, true)} tintColor="#0ea5e9" />}
          />
        )
      ) : filteredSections.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="calendar-outline" size={48} color="#334155" />
          <Text style={{ color: '#64748b', marginTop: 12 }}>No events for this filter</Text>
        </View>
      ) : (
        <SectionList
          sections={filteredSections}
          keyExtractor={item => item.id}
          renderItem={renderEvent}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          stickySectionHeadersEnabled
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
        />
      )}
    </View>

      {showCountryModal && (
        <Pressable style={styles.modalOverlay} onPress={() => setShowCountryModal(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Filter by country</Text>
              <TouchableOpacity onPress={() => setSelectedCountries(new Set())}>
                <Text style={{ color: '#ef4444', fontSize: 13, fontWeight: '600' }}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowCountryModal(false)}>
                <Text style={{ color: '#6366f1', fontSize: 13, fontWeight: '600' }}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
              {ALL_COUNTRIES.map(({ code, name }) => {
                const selected = selectedCountries.has(code);
                return (
                  <TouchableOpacity
                    key={code}
                    style={[styles.countryRow, selected && styles.countryRowActive]}
                    onPress={() => toggleCountry(code)}
                  >
                    <Text style={styles.countryFlag}>{countryFlag(code)}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.countryName, selected && { color: '#f8fafc' }]}>{name}</Text>
                      <Text style={{ color: '#475569', fontSize: 10 }}>{code}</Text>
                    </View>
                    {selected && <Text style={{ color: '#0ea5e9', fontWeight: '700', fontSize: 16 }}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      )}
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#0f0f0f' },
  center:     { flex: 1, backgroundColor: '#0f0f0f', justifyContent: 'center', alignItems: 'center' },
  filterBar: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#0f0f0f',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1e293b',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, backgroundColor: '#171c1f',
  },
  chipActive: { backgroundColor: '#6366f1' },
  chipTxt: { fontSize: 12, color: '#94a3b8', fontWeight: '500' },
  sectionHeader: {
    backgroundColor: '#0f0f0f',
    paddingHorizontal: 4, paddingVertical: 8, marginTop: 4,
  },
  sectionLabel: { color: '#94a3b8', fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  eventRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#171c1f', borderRadius: 10,
    padding: 12, marginBottom: 6,
  },
  eventRowHighlight: { borderLeftWidth: 3, borderLeftColor: '#6366f1' },
  iconWrap: {
    width: 32, height: 32, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center',
    flexShrink: 0,
  },
  eventTitle: { color: '#f8fafc', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  eventSub:   { color: '#64748b', fontSize: 12, marginTop: 1 },
  eventMeta:  { color: '#94a3b8', fontSize: 11, marginTop: 1 },
  eventTime:  { color: '#64748b', fontSize: 11, marginLeft: 4, flexShrink: 0, marginTop: 2 },
  portfolioBadge: {
    backgroundColor: '#6366f122', borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  portfolioBadgeTxt: { color: '#818cf8', fontSize: 10, fontWeight: '700' },
  impactDot: { width: 7, height: 7, borderRadius: 4 },
  // ── Period bar (macro) ────────────────────────────────────────────────────
  periodBar: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: '#111417',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1e293b',
  },
  periodChip: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 14, backgroundColor: '#171c1f',
    borderWidth: 1, borderColor: '#22292f',
  },
  periodChipActive: { backgroundColor: 'rgba(14,165,233,0.16)', borderColor: '#0ea5e9' },
  periodTxt: { fontSize: 11, color: '#64748b', fontWeight: '600' },
  // ── Impact filter bar ────────────────────────────────────────────────────
  impactBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: '#111417',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1e293b',
  },
  impactChip: {
    paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 12, borderWidth: 1, borderColor: '#22292f',
    backgroundColor: 'transparent',
  },
  impactChipTxt: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  // ── Macro rows ────────────────────────────────────────────────────────────
  macroRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1e293b',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#0f0f0f',
  },
  macroLeft: { width: 52, alignItems: 'center', gap: 2 },
  macroTime: { color: '#64748b', fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  macroFlag: { fontSize: 18, lineHeight: 22 },
  macroCountry: { color: '#475569', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  macroTitle: { color: '#e2e8f0', fontSize: 13, fontWeight: '500', flexShrink: 1, lineHeight: 18 },
  macroStars: { fontSize: 11, letterSpacing: -1 },
  macroValRow: { flexDirection: 'row', marginTop: 6, gap: 0 },
  macroValCell: { flex: 1, alignItems: 'center' },
  macroValLabel: { color: '#334155', fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  macroValNum: { color: '#94a3b8', fontSize: 12, fontWeight: '700', marginTop: 1 },
  // ── News rows ────────────────────────────────────────────────────────────
  newsRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#171c1f', borderRadius: 10,
    padding: 12, marginBottom: 8,
  },
  newsHeadline: { color: '#f8fafc', fontSize: 14, fontWeight: '600', lineHeight: 20 },
  newsSummary:  { color: '#94a3b8', fontSize: 12, marginTop: 4, lineHeight: 17 },
  newsMeta:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  newsSource:   { color: '#6366f1', fontSize: 11, fontWeight: '700' },
  newsTime:     { color: '#475569', fontSize: 11 },
  // ── Country modal ─────────────────────────────────────────────────────────
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    zIndex: 220,
    elevation: 120,
  },
  modalSheet: {
    backgroundColor: '#171c1f', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '75%', paddingTop: 8,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#334155',
  },
  modalTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700', flex: 1 },
  countryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#22292f',
  },
  countryRowActive: { backgroundColor: '#0ea5e911' },
  countryFlag: { fontSize: 22 },
  countryName: { color: '#94a3b8', fontSize: 14, fontWeight: '500' },
});
