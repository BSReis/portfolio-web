import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Modal, Pressable, Image, RefreshControl, KeyboardAvoidingView, Platform,
  useWindowDimensions,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../../App';
import IconActionButton from '../components/IconActionButton';
import { usePortfolio } from '../context/PortfolioContext';
import { useSettings } from '../context/SettingsContext';
import {
  getStockQuote, searchStocks, effectivePrice, getStockLogo,
  getHistoricalData, getCandleData,
  StockQuote, StockSearchResult,
} from '../services/api';
import InteractiveChart from '../components/InteractiveChart';
import CandlestickChart from '../components/CandlestickChart';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type SortKey = 'symbol' | 'lastPrice' | 'change' | 'changePct' | 'extendedHours';

function fmtPrice(v: number): string {
  if (v >= 1000) return v.toFixed(2);
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

function fmtChange(v: number, pct: boolean): string {
  const s = v >= 0 ? '+' : '';
  return pct ? `${s}${v.toFixed(2)}%` : `${s}${v.toFixed(2)}`;
}

function extPrice(q: StockQuote): number | null {
  if (q.marketState === 'PRE' && q.preMarketPrice != null) return q.preMarketPrice;
  if ((q.marketState === 'POST' || q.marketState === 'POSTPOST') && q.postMarketPrice != null)
    return q.postMarketPrice;
  return null;
}

export default function WatchlistScreen() {
  const navigation = useNavigation<Nav>();
  const { watchlist, addToWatchlist, removeFromWatchlist } = usePortfolio();
  const { currency, getRateFor } = useSettings();
  const sym = currency === 'EUR' ? '€' : '$';
  const insets = useSafeAreaInsets();

  const [quotes, setQuotes] = useState<Record<string, StockQuote | null>>({});
  const [logos, setLogos]   = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('symbol');
  const [sortAsc, setSortAsc] = useState(true);
  const [sortMenuVisible, setSortMenuVisible] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  // Add stock modal
  const [addVisible, setAddVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Callback ref: stop wheel events inside the chart panel from reaching the watchlist FlatList
  const chartPanelRef = useCallback((node: any) => {
    if (!node || typeof node.addEventListener !== 'function') return;
    node.addEventListener('wheel', (e: Event) => e.stopPropagation(), { passive: false });
  }, []);

  // ── Desktop chart panel ────────────────────────────────────────────────────
  type ChartPeriod = '1D' | '1W' | '1M' | 'YTD' | '1Y' | '5Y' | 'Max' | 'Custom';
  const WL_CHART_PARAMS: Record<ChartPeriod, { range: string; interval: string }> = {
    '1D':     { range: '5d',  interval: '5m'  },
    '1W':     { range: '1mo', interval: '1h'  },
    '1M':     { range: '6mo', interval: '1d'  },
    'YTD':    { range: '2y',  interval: '1d'  },
    '1Y':     { range: '5y',  interval: '1wk' },
    '5Y':     { range: 'max', interval: '1mo' },
    'Max':    { range: 'max', interval: '1mo' },
    'Custom': { range: 'max', interval: '1d'  },
  };
  const WL_CANDLE_PARAMS: Record<ChartPeriod, { range: string; interval: string }> = {
    '1D':     { range: '5d',  interval: '1m'  },
    '1W':     { range: '1mo', interval: '5m'  },
    '1M':     { range: '1mo', interval: '30m' },
    'YTD':    { range: '2y',  interval: '1d'  },
    '1Y':     { range: '2y',  interval: '1d'  },
    '5Y':     { range: '5y',  interval: '1wk' },
    'Max':    { range: 'max', interval: '1wk' },
    'Custom': { range: 'max', interval: '1d'  },
  };

  const WL_PERIODS: ChartPeriod[] = ['1D', '1W', '1M', 'YTD', '1Y', '5Y', 'Max'];

  const [selSymbol, setSelSymbol] = useState<string | null>(null);
  const [selName,   setSelName]   = useState('');
  const [chartPrices,     setChartPrices]     = useState<number[]>([]);
  const [chartTimestamps, setChartTimestamps] = useState<number[]>([]);
  const [chartLoading,    setChartLoading]    = useState(false);
  const [chartPeriod,     setChartPeriod]     = useState<ChartPeriod>('1Y');
  const [chartInitialPts, setChartInitialPts] = useState<number | undefined>(undefined);
  const [chartType,  setChartType]  = useState<'line' | 'candle'>('line');
  const [activeTool, setActiveTool] = useState<'none' | 'ruler' | 'fib'>('none');
  const [candleOpen,  setCandleOpen]  = useState<number[]>([]);
  const [candleHigh,  setCandleHigh]  = useState<number[]>([]);
  const [candleLow,   setCandleLow]   = useState<number[]>([]);
  const [candleClose, setCandleClose] = useState<number[]>([]);
  const [candleTs,    setCandleTs]    = useState<number[]>([]);
  const [candleLoading, setCandleLoading] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');

  useEffect(() => {
    (navigation as any).setOptions({
      tabBarStyle: addVisible ? { display: 'none' } : undefined,
    });
    return () => {
      (navigation as any).setOptions({ tabBarStyle: undefined });
    };
  }, [navigation, addVisible]);

  // Fetch quotes whenever watchlist changes
  const fetchQuotes = useCallback(async (isRefresh = false) => {
    if (watchlist.length === 0) { setQuotes({}); return; }
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const results = await Promise.all(
        watchlist.map(async (item) => {
          const q = await getStockQuote(item.symbol).catch(() => null);
          const logoUrl = await getStockLogo(item.symbol).catch(() => null);
          return { symbol: item.symbol, q, logoUrl };
        })
      );
      const qmap: Record<string, StockQuote | null> = {};
      const lmap: Record<string, string | null> = {};
      results.forEach(({ symbol, q, logoUrl }) => {
        qmap[symbol] = q;
        lmap[symbol] = logoUrl;
      });
      setQuotes(qmap);
      setLogos(lmap);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [watchlist]);

  useEffect(() => { fetchQuotes(); }, [fetchQuotes]);

  useFocusEffect(
    useCallback(() => {
      fetchQuotes();
    }, [fetchQuotes])
  );

  // Auto-select first symbol on desktop when watchlist loads
  useEffect(() => {
    if (!isDesktop || watchlist.length === 0) return;
    if (!selSymbol || !watchlist.some(w => w.symbol === selSymbol)) {
      setSelSymbol(watchlist[0].symbol);
      setSelName(watchlist[0].name);
    }
  }, [isDesktop, watchlist]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch chart data when selected symbol, period, or chart type changes
  useEffect(() => {
    if (!isDesktop || !selSymbol) return;
    if (chartPeriod === 'Custom') return; // custom handled by manual trigger

    setActiveTool('none'); // clear tool on period change

    if (chartType === 'candle') {
      setCandleLoading(true);
      setCandleOpen([]); setCandleHigh([]); setCandleLow([]); setCandleClose([]); setCandleTs([]);
      const { range, interval } = WL_CANDLE_PARAMS[chartPeriod];
      getCandleData(selSymbol, range, interval)
        .then(data => {
          let o = data.open, h = data.high, l = data.low, c = data.close, ts = data.timestamps;
          if (chartPeriod === 'YTD') {
            const jan1 = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
            const idx = ts.findIndex(t => t >= jan1);
            if (idx > 0) { o = o.slice(idx); h = h.slice(idx); l = l.slice(idx); c = c.slice(idx); ts = ts.slice(idx); }
          }
          setCandleOpen(o); setCandleHigh(h); setCandleLow(l); setCandleClose(c); setCandleTs(ts);
        })
        .catch(() => {})
        .finally(() => setCandleLoading(false));
    } else {
      setChartLoading(true);
      setChartPrices([]);
      setChartTimestamps([]);
      const { range, interval } = WL_CHART_PARAMS[chartPeriod];
      getHistoricalData(selSymbol, range, interval)
        .then(data => {
          let prices = data.prices, timestamps = data.timestamps;
          if (chartPeriod === 'YTD') {
            const jan1 = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
            const idx = timestamps.findIndex(t => t >= jan1);
            if (idx > 0) { prices = prices.slice(idx); timestamps = timestamps.slice(idx); }
            setChartInitialPts(prices.length);
          } else {
            setChartInitialPts(undefined);
          }
          setChartPrices(prices);
          setChartTimestamps(timestamps);
        })
        .catch(() => {})
        .finally(() => setChartLoading(false));
    }
  }, [selSymbol, chartPeriod, chartType, isDesktop]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Custom range fetch
  const fetchCustomRange = useCallback(() => {
    if (!isDesktop || !selSymbol || !customFrom || !customTo) return;
    const fromTs = new Date(customFrom).getTime() / 1000;
    const toTs   = new Date(customTo).getTime()   / 1000;
    if (fromTs >= toTs) return;

    if (chartType === 'candle') {
      setCandleLoading(true);
      getCandleData(selSymbol, 'max', '1d')
        .then(data => {
          const idxS = data.timestamps.findIndex(t => t >= fromTs);
          const idxE = data.timestamps.findLastIndex(t => t <= toTs);
          if (idxS < 0 || idxE < idxS) return;
          setCandleOpen(data.open.slice(idxS, idxE + 1));
          setCandleHigh(data.high.slice(idxS, idxE + 1));
          setCandleLow(data.low.slice(idxS, idxE + 1));
          setCandleClose(data.close.slice(idxS, idxE + 1));
          setCandleTs(data.timestamps.slice(idxS, idxE + 1));
        })
        .catch(() => {})
        .finally(() => setCandleLoading(false));
    } else {
      setChartLoading(true);
      getHistoricalData(selSymbol, 'max', '1d')
        .then(data => {
          const idxS = data.timestamps.findIndex(t => t >= fromTs);
          const idxE = data.timestamps.findLastIndex(t => t <= toTs);
          if (idxS < 0 || idxE < idxS) return;
          const prices     = data.prices.slice(idxS, idxE + 1);
          const timestamps = data.timestamps.slice(idxS, idxE + 1);
          setChartInitialPts(prices.length);
          setChartPrices(prices);
          setChartTimestamps(timestamps);
        })
        .catch(() => {})
        .finally(() => setChartLoading(false));
    }
  }, [selSymbol, customFrom, customTo, chartType, isDesktop]);

  const handleSearch = useCallback(async (text: string) => {
    if (!text.trim()) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const data = await searchStocks(text);
      setSearchResults(data.slice(0, 20));
    } catch {
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const onChangeSearch = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => handleSearch(text), 400);
  };

  const handleAddSymbol = (result: StockSearchResult) => {
    addToWatchlist({ symbol: result.symbol, name: result.description });
    setAddVisible(false);
    setQuery('');
    setSearchResults([]);
  };

  const sorted = [...watchlist].sort((a, b) => {
    const qA = quotes[a.symbol];
    const qB = quotes[b.symbol];
    let valA: number | string = a.symbol;
    let valB: number | string = b.symbol;

    if (sortKey === 'symbol') {
      valA = a.symbol; valB = b.symbol;
    } else if (sortKey === 'lastPrice') {
      valA = qA ? effectivePrice(qA) : 0;
      valB = qB ? effectivePrice(qB) : 0;
    } else if (sortKey === 'change') {
      valA = qA ? effectivePrice(qA) - qA.pc : 0;
      valB = qB ? effectivePrice(qB) - qB.pc : 0;
    } else if (sortKey === 'changePct') {
      valA = qA && qA.pc > 0 ? ((effectivePrice(qA) - qA.pc) / qA.pc) * 100 : 0;
      valB = qB && qB.pc > 0 ? ((effectivePrice(qB) - qB.pc) / qB.pc) * 100 : 0;
    } else if (sortKey === 'extendedHours') {
      const eA = qA ? extPrice(qA) : null;
      const eB = qB ? extPrice(qB) : null;
      valA = eA != null && qA && qA.c > 0 ? ((eA - qA.c) / qA.c) * 100 : 0;
      valB = eB != null && qB && qB.c > 0 ? ((eB - qB.c) / qB.c) * 100 : 0;
    }

    if (typeof valA === 'string' && typeof valB === 'string') {
      return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return sortAsc ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
    setSortMenuVisible(false);
  };

  const SORT_OPTIONS: { key: SortKey; label: string }[] = [
    { key: 'symbol',      label: 'Sort by Symbol' },
    { key: 'lastPrice',   label: 'Sort by Last Price' },
    { key: 'change',      label: 'Sort by Change' },
    { key: 'changePct',   label: 'Sort by Change %' },
    { key: 'extendedHours', label: 'Sort by Extended Hours' },
  ];

  const renderItem = ({ item }: { item: { symbol: string; name: string } }) => {
    const q = quotes[item.symbol];
    const logo = logos[item.symbol];
    // Main line: always regular close vs previous close (TradingView behaviour)
    const current = q ? q.c : null;
    const change = q && current != null ? current - q.pc : null;
    const changePct = q && q.pc > 0 && change != null ? (change / q.pc) * 100 : null;
    // Display price: effectivePrice (shows pre/post when active)
    const displayPrice = q ? effectivePrice(q) : null;
    const extP = q ? extPrice(q) : null;
    const extChange = extP != null && q ? extP - (q.c ?? 0) : null;
    const extPct = extChange != null && q && q.c > 0 ? (extChange / q.c) * 100 : null;
    const isExt = extP != null;
    const pos = change != null && change >= 0;
    const extPos = extChange != null && extChange >= 0;
    const ms = q?.marketState;
    const isPreMarket = ms === 'PRE';
    const isPostMarket = ms === 'POST' || ms === 'POSTPOST';
    const isRegular = ms === 'REGULAR';
    const isClosed = ms === 'CLOSED' || ms === 'PREPRE';
    const marketBadge = isPreMarket ? 'PRE' : isPostMarket ? 'AFTER' : isRegular ? 'OPEN' : isClosed ? 'CLOSED' : null;
    const marketBadgeStyle = isPreMarket ? styles.marketBadgePre : isPostMarket ? styles.marketBadgePost : isRegular ? styles.marketBadgeRegular : styles.marketBadgeClosed;
    const marketBadgeTxtColor = isPreMarket ? '#fb923c' : isPostMarket ? '#93c5fd' : isRegular ? '#86efac' : '#94a3b8';

    const innerRow = (
      <TouchableOpacity
        style={[styles.row, compactMode && styles.compactRow, isDesktop && { flex: 1 },
          isDesktop && selSymbol === item.symbol && styles.selectedRow]}
        activeOpacity={0.7}
        onPress={() => {
          if (isDesktop) {
            setSelSymbol(item.symbol);
            setSelName(item.name);
          } else {
            navigation.navigate('StockDetail', {
              symbol: item.symbol, name: item.name, shares: 0, avgPrice: 0,
            });
          }
        }}
        {...(!isDesktop && { onLongPress: () => removeFromWatchlist(item.symbol) })}
      >
          <View style={[styles.logoWrap, compactMode && styles.compactLogoWrap]}>
            {logo ? (
              <Image
                source={{ uri: logo }}
                style={[styles.logo, compactMode && styles.compactLogo]}
                onError={() => setLogos(l => ({ ...l, [item.symbol]: null }))}
              />
            ) : (
              <View style={[styles.logo, styles.logoFallback, compactMode && styles.compactLogo]}>
                <Text style={[styles.logoLetter, compactMode && styles.compactLogoLetter]}>{item.symbol[0]}</Text>
              </View>
            )}
          </View>

          {compactMode ? (
            <>
              <View style={styles.compactSymbolCol}>
                <View style={styles.symbolRow}>
                  <Text style={[styles.symbolText, styles.compactSymbolText]}>{item.symbol}</Text>
                  {marketBadge && (
                    <View style={[styles.marketBadge, styles.compactMarketBadge, marketBadgeStyle]}>
                      <Text style={[styles.marketBadgeTxt, styles.compactMarketBadgeTxt, { color: marketBadgeTxtColor }]}>{marketBadge}</Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={[styles.compactValueCol, styles.compactPriceCol]}>
                <Text style={[styles.priceText, styles.compactPriceText]}>
                  {displayPrice != null ? fmtPrice(displayPrice) : '—'}
                </Text>
              </View>
              <View style={styles.compactValueCol}>
                <Text style={[styles.compactMetricText, { color: change != null ? (pos ? '#22c55e' : '#ef4444') : '#64748b' }]}>
                  {change != null ? fmtChange(change, false) : '—'}
                </Text>
              </View>
              <View style={styles.compactValueCol}>
                <Text style={[styles.compactMetricText, { color: changePct != null ? (pos ? '#22c55e' : '#ef4444') : '#64748b' }]}>
                  {changePct != null ? fmtChange(changePct, true) : '—'}
                </Text>
              </View>
              <View style={styles.compactValueCol}>
                <Text style={[styles.compactMetricText, { color: extPct != null ? (extPos ? '#22c55e' : '#ef4444') : '#64748b' }]}>
                  {extPct != null ? fmtChange(extPct, true) : '—'}
                </Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.nameCol}>
                <View style={styles.symbolRow}>
                  <Text style={styles.symbolText}>{item.symbol}</Text>
                  {marketBadge && (
                    <View style={[styles.marketBadge, marketBadgeStyle]}>
                      <Text style={[styles.marketBadgeTxt, { color: marketBadgeTxtColor }]}>{marketBadge}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.nameText} numberOfLines={1}>{item.name}</Text>
              </View>

              <View style={styles.priceCol}>
                <Text style={styles.priceText}>
                  {displayPrice != null ? fmtPrice(displayPrice) : '—'}
                </Text>
                {change != null && changePct != null ? (
                  <Text style={[styles.changeText, { color: pos ? '#22c55e' : '#ef4444' }]}>
                    {fmtChange(change, false)}{'  '}{fmtChange(changePct, true)}
                  </Text>
                ) : (
                  <Text style={styles.changeText}>—</Text>
                )}

                {isExt && extP != null && extChange != null && extPct != null ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <Ionicons name={isPreMarket ? 'sunny-outline' : 'moon-outline'} size={10} color="#94a3b8" />
                    <Text style={[styles.extText, { color: '#94a3b8' }]}>{isPreMarket ? 'Pre' : 'After'}</Text>
                    <Text style={[styles.extText, { color: '#94a3b8' }]}>{fmtPrice(extP)}</Text>
                    <Text style={[styles.extText, { color: extPos ? '#22c55e' : '#ef4444' }]}>
                      {fmtChange(extChange, false)}{'  '}{fmtChange(extPct, true)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </>
          )}
      </TouchableOpacity>
    );

    if (isDesktop) {
      return (
        <View style={styles.desktopRow}>
          {innerRow}
          <TouchableOpacity
            onPress={() => removeFromWatchlist(item.symbol)}
            style={styles.deleteBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="trash-outline" size={16} color="#94a3b8" />
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <Swipeable
        renderRightActions={() => (
          <TouchableOpacity
            onPress={() => removeFromWatchlist(item.symbol)}
            style={{ backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', width: 80, marginVertical: 1 }}
          >
            <Ionicons name="trash-outline" size={22} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 11, marginTop: 3 }}>Delete</Text>
          </TouchableOpacity>
        )}
        overshootRight={false}
        friction={2}
        rightThreshold={40}
        overshootFriction={8}
      >
        {innerRow}
      </Swipeable>
    );
  };

  // Derived values for chart panel header
  const selQ = selSymbol ? quotes[selSymbol] : null;
  const selLogo = selSymbol ? logos[selSymbol] : null;
  const selPrice   = selQ ? effectivePrice(selQ) : null;
  const selChange  = selQ && selPrice != null ? selPrice - selQ.pc : null;
  const selChangePct = selQ && selQ.pc > 0 && selChange != null ? (selChange / selQ.pc) * 100 : null;
  const selPos = selChange != null && selChange >= 0;
  const selColor = selPos ? '#22c55e' : '#ef4444';

  const listPanel = (
    <>
      {/* Toolbar */}
      <View style={styles.toolbar}>
        <Text style={styles.toolbarTitle}>Watchlist</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {loading && <ActivityIndicator size="small" color="#6366f1" />}
          <IconActionButton icon={compactMode ? 'list-outline' : 'grid-outline'} size={18} onPress={() => setCompactMode(v => !v)} />
          <IconActionButton icon="swap-vertical-outline" size={18} onPress={() => setSortMenuVisible(true)} />
          <IconActionButton icon="add" size={20} onPress={() => setAddVisible(true)} />
        </View>
      </View>

      {watchlist.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="bookmark-outline" size={40} color="#334155" />
          <Text style={styles.emptyText}>Your watchlist is empty.{"\n"}Tap + to add stocks.</Text>
        </View>
      ) : (
        <FlatList
          data={sorted}
          key={compactMode ? 'compact' : 'regular'}
          keyExtractor={i => i.symbol}
          renderItem={renderItem}
          ListHeaderComponent={compactMode ? (
            <View style={[styles.compactHeaderRow, isDesktop && { paddingRight: 48 }]}>
              <TouchableOpacity style={styles.compactHeaderSymbol} onPress={() => toggleSort('symbol')}>
                <View style={styles.compactHeaderBtnInner}>
                  <Text style={[styles.compactHeaderText, sortKey === 'symbol' && styles.compactHeaderTextActive]}>Symbol</Text>
                  {sortKey === 'symbol' && <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={10} color="#6366f1" />}
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.compactHeaderValue} onPress={() => toggleSort('lastPrice')}>
                <View style={styles.compactHeaderBtnInnerRight}>
                  <Text style={[styles.compactHeaderText, sortKey === 'lastPrice' && styles.compactHeaderTextActive]}>Last</Text>
                  {sortKey === 'lastPrice' && <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={10} color="#6366f1" />}
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.compactHeaderValue} onPress={() => toggleSort('change')}>
                <View style={styles.compactHeaderBtnInnerRight}>
                  <Text style={[styles.compactHeaderText, sortKey === 'change' && styles.compactHeaderTextActive]}>Chg</Text>
                  {sortKey === 'change' && <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={10} color="#6366f1" />}
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.compactHeaderValue} onPress={() => toggleSort('changePct')}>
                <View style={styles.compactHeaderBtnInnerRight}>
                  <Text style={[styles.compactHeaderText, sortKey === 'changePct' && styles.compactHeaderTextActive]}>Chg%</Text>
                  {sortKey === 'changePct' && <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={10} color="#6366f1" />}
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.compactHeaderValue} onPress={() => toggleSort('extendedHours')}>
                <View style={styles.compactHeaderBtnInnerRight}>
                  <Text style={[styles.compactHeaderText, sortKey === 'extendedHours' && styles.compactHeaderTextActive]}>Ext</Text>
                  {sortKey === 'extendedHours' && <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={10} color="#6366f1" />}
                </View>
              </TouchableOpacity>
            </View>
          ) : null}
          ItemSeparatorComponent={() => <View style={[styles.separator, compactMode && styles.compactSeparator]} />}
          extraData={[compactMode, isDesktop, selSymbol]}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 120, 148) }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchQuotes(true)}
              tintColor="#6366f1"
              colors={['#6366f1']}
            />
          }
        />
      )}
    </>
  );

  return (
    <View style={styles.container}>
      {isDesktop ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {/* ── Left: chart panel ────────────────────────────────── */}
          <View ref={chartPanelRef} style={styles.chartPanel}>
            {/* Header: logo + symbol + price */}
            <View style={styles.chartHeader}>
              {selLogo ? (
                <Image source={{ uri: selLogo }} style={styles.chartLogo} alt="" />
              ) : selSymbol ? (
                <View style={[styles.chartLogo, styles.logoFallback]}>
                  <Text style={{ color: '#94a3b8', fontSize: 16, fontWeight: '700' }}>{selSymbol[0]}</Text>
                </View>
              ) : null}
              <View style={{ flex: 1 }}>
                <Text style={styles.chartSymbol}>{selSymbol ?? '—'}</Text>
                <Text style={styles.chartName} numberOfLines={1}>{selName}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.chartPrice}>
                  {selPrice != null ? fmtPrice(selPrice) : '—'}
                </Text>
                {selChange != null && selChangePct != null ? (
                  <Text style={[styles.chartChange, { color: selColor }]}>
                    {fmtChange(selChange, false)}{'  '}{fmtChange(selChangePct, true)}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Period tabs + chart type + tools */}
            <View style={styles.periodTabRow}>
              {WL_PERIODS.map(p => (
                <TouchableOpacity
                  key={p}
                  style={[styles.periodTab, chartPeriod === p && !showCustom && styles.periodTabActive]}
                  onPress={() => { setChartPeriod(p); setShowCustom(false); setActiveTool('none'); }}
                >
                  <Text style={[styles.periodTabText, chartPeriod === p && !showCustom && styles.periodTabTextActive]}>{p}</Text>
                </TouchableOpacity>
              ))}
              {/* Custom range toggle */}
              <TouchableOpacity
                style={[styles.periodTab, showCustom && styles.periodTabActive]}
                onPress={() => { setShowCustom(s => !s); if (!showCustom) setChartPeriod('Custom'); }}
              >
                <Text style={[styles.periodTabText, showCustom && styles.periodTabTextActive]}>Custom</Text>
              </TouchableOpacity>

              {/* Spacer */}
              <View style={{ flex: 1 }} />

              {/* Chart type toggle */}
              <TouchableOpacity
                style={[styles.toolBtn, chartType === 'candle' && styles.toolBtnActive]}
                onPress={() => { setChartType(t => t === 'line' ? 'candle' : 'line'); setActiveTool('none'); }}
                accessibilityLabel="Toggle chart type"
              >
                <Ionicons name={chartType === 'candle' ? 'bar-chart' : 'analytics'} size={15} color={chartType === 'candle' ? '#6366f1' : '#64748b'} />
              </TouchableOpacity>

              {/* Ruler tool */}
              <TouchableOpacity
                style={[styles.toolBtn, activeTool === 'ruler' && styles.toolBtnActive]}
                onPress={() => setActiveTool(t => t === 'ruler' ? 'none' : 'ruler')}
                accessibilityLabel="Ruler tool"
              >
                <Ionicons name="resize" size={15} color={activeTool === 'ruler' ? '#6366f1' : '#64748b'} />
              </TouchableOpacity>

              {/* Fibonacci tool */}
              <TouchableOpacity
                style={[styles.toolBtn, activeTool === 'fib' && styles.toolBtnActive]}
                onPress={() => setActiveTool(t => t === 'fib' ? 'none' : 'fib')}
                accessibilityLabel="Fibonacci tool"
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: activeTool === 'fib' ? '#6366f1' : '#64748b' }}>φ</Text>
              </TouchableOpacity>
            </View>

            {/* Custom date range inputs */}
            {showCustom && (
              <View style={styles.customRangeRow}>
                <Text style={styles.customRangeLabel}>De</Text>
                <TextInput
                  style={styles.customRangeInput}
                  value={customFrom}
                  onChangeText={setCustomFrom}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#475569"
                />
                <Text style={styles.customRangeLabel}>Até</Text>
                <TextInput
                  style={styles.customRangeInput}
                  value={customTo}
                  onChangeText={setCustomTo}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#475569"
                />
                <TouchableOpacity style={styles.customRangeApply} onPress={fetchCustomRange}>
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>OK</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Chart */}
            <View style={{ flex: 1 }}>
              {chartType === 'candle' ? (
                <CandlestickChart
                  open={candleOpen}
                  high={candleHigh}
                  low={candleLow}
                  close={candleClose}
                  timestamps={candleTs}
                  initialPoints={candleTs.length}
                  loading={candleLoading}
                  tool={activeTool}
                />
              ) : (
                <InteractiveChart
                  prices={chartPrices}
                  timestamps={chartTimestamps}
                  color={selColor}
                  height={undefined as any}
                  loading={chartLoading}
                  initialPoints={chartInitialPts ?? chartPrices.length}
                />
              )}
            </View>
          </View>

          {/* ── Right: watchlist panel ─────────────────────────── */}
          <View style={styles.listPanel}>
            {listPanel}
          </View>
        </View>
      ) : (
        listPanel
      )}

      {/* Sort menu modal */}
      <Modal visible={sortMenuVisible} transparent animationType="fade" onRequestClose={() => setSortMenuVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSortMenuVisible(false)}>
          <View style={styles.sortMenu}>
            <Text style={styles.sortMenuTitle}>Sort by</Text>
            {SORT_OPTIONS.map(o => (
              <TouchableOpacity
                key={o.key}
                style={styles.sortOption}
                onPress={() => toggleSort(o.key)}
              >
                <Text style={[styles.sortOptionText, sortKey === o.key && styles.sortOptionActive]}>
                  {o.label}
                </Text>
                {sortKey === o.key && (
                  <Ionicons
                    name={sortAsc ? 'arrow-up' : 'arrow-down'}
                    size={14}
                    color="#6366f1"
                  />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Add stock overlay */}
      {addVisible && (
        <Pressable
          style={styles.addModalContainer}
          onPress={() => {
            setAddVisible(false); setQuery(''); setSearchResults([]);
          }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.addModalKav}
          >
            <Pressable style={[styles.addModal, { paddingBottom: Math.max(insets.bottom, 16) }]} onPress={() => {}}>
              <View style={styles.addModalHeader}>
                <Text style={styles.addModalTitle}>Add to Watchlist</Text>
                <TouchableOpacity onPress={() => {
                  setAddVisible(false); setQuery(''); setSearchResults([]);
                }}>
                  <Ionicons name="close" size={20} color="#94a3b8" />
                </TouchableOpacity>
              </View>
              <View style={styles.searchBox}>
                <Ionicons name="search-outline" size={16} color="#64748b" />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Symbol or name..."
                  placeholderTextColor="#475569"
                  value={query}
                  onChangeText={onChangeSearch}
                  autoFocus
                  autoCapitalize="characters"
                />
                {searchLoading && <ActivityIndicator size="small" color="#6366f1" />}
              </View>
              <FlatList
                data={searchResults}
                keyExtractor={r => r.symbol}
                style={{ maxHeight: 320 }}
                renderItem={({ item }) => {
                  const already = watchlist.some(w => w.symbol === item.symbol);
                  return (
                    <TouchableOpacity
                      style={styles.searchRow}
                      onPress={() => !already && handleAddSymbol(item)}
                      disabled={already}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.searchSymbol}>{item.symbol}</Text>
                        <Text style={styles.searchName} numberOfLines={1}>{item.description}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.searchExchange}>{item.exchange}</Text>
                        {already && <Text style={{ color: '#6366f1', fontSize: 10 }}>Added</Text>}
                      </View>
                    </TouchableOpacity>
                  );
                }}
                ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#1e293b' }} />}
              />
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  // ── Desktop split layout ──────────────────────────────────────────────────
  chartPanel: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: '#1e293b',
    backgroundColor: '#0b0f17',
    flexDirection: 'column',
  },
  listPanel: {
    width: 400,
    flexDirection: 'column',
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    gap: 12,
  },
  chartLogo: { width: 40, height: 40, borderRadius: 20 },
  chartSymbol: { color: '#f8fafc', fontSize: 20, fontWeight: '800' },
  chartName: { color: '#64748b', fontSize: 12, marginTop: 1 },
  chartPrice: { color: '#f8fafc', fontSize: 22, fontWeight: '700' },
  chartChange: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  periodTabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  periodTab: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: 'transparent',
  },
  periodTabActive: { backgroundColor: '#1e293b' },
  periodTabText: { color: '#64748b', fontSize: 12, fontWeight: '600' },
  periodTabTextActive: { color: '#f8fafc' },
  selectedRow: { backgroundColor: 'rgba(99,102,241,0.10)' },
  toolBtn: {
    width: 28, height: 28, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  toolBtnActive: { backgroundColor: 'rgba(99,102,241,0.18)' },
  customRangeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#1e293b',
  },
  customRangeLabel: { color: '#64748b', fontSize: 12 },
  customRangeInput: {
    color: '#f8fafc', fontSize: 12,
    backgroundColor: '#1e293b', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
    width: 100,
  },
  customRangeApply: {
    backgroundColor: '#6366f1', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  // ─────────────────────────────────────────────────────────────────────────
  toolbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#1e293b',
  },
  toolbarTitle: { color: '#f8fafc', fontSize: 17, fontWeight: '700' },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  compactRow: {
    paddingVertical: 7,
    minHeight: 38,
  },
  logoWrap: { marginRight: 12 },
  logo: { width: 38, height: 38, borderRadius: 19 },
  compactLogoWrap: { marginRight: 8 },
  compactLogo: { width: 18, height: 18, borderRadius: 9 },
  logoFallback: {
    backgroundColor: '#1e293b', justifyContent: 'center', alignItems: 'center',
  },
  logoLetter: { color: '#94a3b8', fontSize: 16, fontWeight: '700' },
  compactLogoLetter: { fontSize: 9 },
  nameCol: { flex: 1, marginRight: 8 },
  compactSymbolCol: { flex: 1, minWidth: 0, paddingRight: 8 },
  symbolRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  symbolText: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  compactSymbolText: { fontSize: 13, fontWeight: '600' },
  nameText: { color: '#8f99aa', fontSize: 12, marginTop: 1 },
  priceCol: { alignItems: 'flex-end' },
  priceText: { color: '#f8fafc', fontSize: 15, fontWeight: '600' },
  compactPriceCol: { marginRight: 0 },
  compactPriceText: { fontSize: 13, fontWeight: '500' },
  compactValueCol: { width: 56, alignItems: 'flex-end' },
  compactMetricText: { fontSize: 13, fontWeight: '500' },
  changeText: { fontSize: 12, marginTop: 2 },
  extText: { fontSize: 11 },
  marketBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
  },
  marketBadgeTxt: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  compactMarketBadge: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
  compactMarketBadgeTxt: { fontSize: 9 },
  marketBadgePre: { backgroundColor: 'rgba(251,146,60,0.12)', borderColor: 'rgba(251,146,60,0.25)' },
  marketBadgePost: { backgroundColor: 'rgba(59,130,246,0.12)', borderColor: 'rgba(59,130,246,0.25)' },
  marketBadgeRegular: { backgroundColor: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.25)' },
  marketBadgeClosed: { backgroundColor: 'rgba(148,163,184,0.12)', borderColor: 'rgba(148,163,184,0.25)' },
  desktopRow: { flexDirection: 'row', alignItems: 'center' },
  deleteBtn: {
    width: 32, height: 32,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  separator: { height: 1, backgroundColor: '#1e293b', marginLeft: 66 },
  compactSeparator: { marginLeft: 16 },
  compactHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  compactHeaderText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
  },
  compactHeaderTextActive: {
    color: '#cbd5e1',
  },
  compactHeaderSymbol: { flex: 1 },
  compactHeaderValue: { width: 56 },
  compactHeaderBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  compactHeaderBtnInnerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
  },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyText: { color: '#8f99aa', fontSize: 14, textAlign: 'center', lineHeight: 22 },

  // Sort menu
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sortMenu: {
    backgroundColor: '#1e293b', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    paddingBottom: 32,
  },
  sortMenuTitle: {
    color: '#64748b', fontSize: 12, fontWeight: '600',
    paddingHorizontal: 20, paddingVertical: 14, letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sortOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: '#0f0f0f',
  },
  sortOptionText: { color: '#cbd5e1', fontSize: 15 },
  sortOptionActive: { color: '#6366f1', fontWeight: '700' },

  // Add modal
  addModalContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
    zIndex: 220,
    elevation: 120,
  },
  addModalKav: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  addModal: {
    backgroundColor: '#1e293b', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 16, maxHeight: '80%',
  },
  addModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, marginBottom: 12,
  },
  addModalTitle: { color: '#f8fafc', fontSize: 17, fontWeight: '700' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0f0f0f', borderRadius: 10, marginHorizontal: 16,
    paddingHorizontal: 12, paddingVertical: 8, gap: 8, marginBottom: 8,
  },
  searchInput: { flex: 1, color: '#f8fafc', fontSize: 15 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  searchSymbol: { color: '#f8fafc', fontSize: 14, fontWeight: '700' },
  searchName: { color: '#64748b', fontSize: 12, marginTop: 2 },
  searchExchange: { color: '#8f99aa', fontSize: 12 },
});
