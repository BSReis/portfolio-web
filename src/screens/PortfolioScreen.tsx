import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  useWindowDimensions,
  ListRenderItemInfo,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  RefreshControl,
  Image,
  TextInput,
  Alert,
  Platform,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import IconActionButton from "../components/IconActionButton";
import InteractiveChart from "../components/InteractiveChart";
import ChartTypeToggleButton from '../components/ChartTypeToggleButton';
import { BlurValue } from '../utils/blurValue';
import CandlestickChart from "../components/CandlestickChart";
import { usePortfolio } from "../context/PortfolioContext";
import AddTransactionModal from "../components/AddTransactionModal";
import { useSettings } from "../context/SettingsContext";
import {
  getStockQuote,
  getStockLogo,
  getHistoricalData,
  HistoricalData,
  StockQuote,
  effectivePrice,
} from "../services/api";
import { Holding } from "../context/PortfolioContext";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { Ionicons } from "@expo/vector-icons";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const PERIODS = ["1D", "1W", "1M", "YTD", "1Y", "5Y", "Max"] as const;
const PORTFOLIO_FILTERS_KEY = "@portfolio_screen_filters";
const TIMESPANS = ["since_buy", "year", "ytd", "month", "week", "daily"] as const;
const SORT_MODES = ["relative", "absolute", "position"] as const;
const GAIN_MODES = ["period", "alltime"] as const;

const fmtMoney = (v: number, decimals = 2): string => {
  const [int, dec] = Math.abs(v).toFixed(decimals).split('.');
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = v < 0 ? '-' : '';
  return decimals > 0 ? `${sign}${intFmt},${dec}` : `${sign}${intFmt}`;
};
type Period = (typeof PERIODS)[number];

// Quantos pontos do final correspondem a este período
function pointsForPeriod(timestamps: number[], period: Period): number {
  if (period === "Max" || timestamps.length === 0) return timestamps.length;

  // For 1D with 5m intraday data, detect the last trading session by finding
  // the gap between sessions (> 4h between consecutive bars). This handles
  // weekends and holidays where "now - 86400" wouldn't find any recent bars.
  if (period === "1D") {
    for (let i = timestamps.length - 1; i > 0; i--) {
      if (timestamps[i] - timestamps[i - 1] > 4 * 3600) {
        return Math.max(5, timestamps.length - i);
      }
    }
    return Math.max(5, timestamps.length);
  }

  const now = Date.now() / 1000;
  const cutoffs: Record<Period, number> = {
    "1D": now - 86400,
    "1W": now - 7 * 86400,
    "1M": now - 30 * 86400,
    YTD: new Date(new Date().getFullYear(), 0, 1).getTime() / 1000,
    "1Y": now - 365 * 86400,
    "5Y": now - 5 * 365 * 86400,
    Max: 0,
  };
  const idx = timestamps.findIndex((t) => t >= cutoffs[period]);
  const count = idx === -1 ? timestamps.length : timestamps.length - idx;
  return Math.max(5, count);
}

// Range alargado (5x) para permitir pan e zoom out
const WIDE_PARAMS: Record<Period, { range: string; interval: string }> = {
  "1D": { range: "5d", interval: "5m" },
  "1W": { range: "1mo", interval: "1h" },
  "1M": { range: "6mo", interval: "1d" },
  YTD: { range: "2y", interval: "1wk" },
  "1Y": { range: "5y", interval: "1wk" },
  "5Y": { range: "max", interval: "1mo" },
  Max: { range: "max", interval: "1mo" },
};

// Mesma resolução do gráfico de velas
const CANDLE_PARAMS: Record<Period, { range: string; interval: string }> = {
  "1D": { range: "5d",  interval: "1m"  },
  "1W": { range: "1mo", interval: "5m"  },
  "1M": { range: "1mo", interval: "30m" },
  YTD:  { range: "2y",  interval: "1d"  },
  "1Y": { range: "2y",  interval: "1d"  },
  "5Y": { range: "5y",  interval: "1wk" },
  Max:  { range: "max", interval: "1wk" },
};

export default function PortfolioScreen({ scrollEnabled = true }: { scrollEnabled?: boolean }) {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    holdings,
    loading: portfolioLoading,
    removeHolding,
    addTransaction,
    transactions,
    activePortfolioId,
    activePortfolioName,
  } = usePortfolio();
  const isCombinedPortfolio = activePortfolioId === '__combined__';
  const { currency, getRateFor, hideValues, setHideValues } = useSettings();
  const currencySymbol = currency === "EUR" ? "€" : "$";
  const costRateH = (h: Holding) => getRateFor(h.currency ?? "USD");
  const marketRateH = (h: Holding, quote?: StockQuote | null) => getRateFor(quote?.currency ?? h.currency ?? "USD");

  const [quotes, setQuotes] = useState<Record<string, StockQuote | null>>({});
  const [logos, setLogos] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<Period>("Max");
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [fullData, setFullData] = useState<HistoricalData>({
    prices: [],
    timestamps: [],
  });
  const [chartLoading, setChartLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [crosshairVisible, setCrosshairVisible] = useState(false);
  const [chPrice, setChPrice] = useState(0);
  const [chDateStr, setChDateStr] = useState('');
  const [chartVisiblePrices, setChartVisiblePrices] = useState<number[]>([]);
  const [spxOverlay, setSpxOverlay] = useState<number[]>([]);
  const [chartType, setChartType] = useState<'line' | 'candle'>('line');
  const [candleVisibleClose, setCandleVisibleClose] = useState<number[]>([]);
  const [logoErrors, setLogoErrors] = useState<Record<string, boolean>>({});

  // Sintetizar candles a partir dos preços do portfolio
  const candleData = useMemo(() => {
    const { prices, timestamps } = fullData;
    if (prices.length < 2) return { open: [] as number[], high: [] as number[], low: [] as number[], close: [] as number[], timestamps: [] as number[] };
    const open = prices.map((_, i) => i === 0 ? prices[0] : prices[i - 1]);
    const close = [...prices];
    const high = prices.map((_, i) => Math.max(open[i], close[i]));
    const low = prices.map((_, i) => Math.min(open[i], close[i]));
    return { open, high, low, close, timestamps };
  }, [fullData]);
  const [holdingMenuSymbol, setHoldingMenuSymbol] = useState<string | null>(
    null,
  );
  const [kebabPopoverPos, setKebabPopoverPos] = useState<{ top: number; right: number } | null>(null);
  const [desktopDialog, setDesktopDialog] = useState<'viewTx' | 'confirmDelete' | null>(null);
  const closeKebab = () => { setHoldingMenuSymbol(null); setKebabPopoverPos(null); };
  const closeKebabOpenDialog = (d: 'viewTx' | 'confirmDelete') => { setKebabPopoverPos(null); setDesktopDialog(d); };
  const closeDialog = () => { setDesktopDialog(null); setHoldingMenuSymbol(null); };
  const [txSymbol, setTxSymbol] = useState<string | null>(null);
  const [txInitialPrice, setTxInitialPrice] = useState("");
  const [txNativeCurrencySymbol, setTxNativeCurrencySymbol] = useState<
    string | undefined
  >(undefined);
  const [viewTxSymbol, setViewTxSymbol] = useState<string | null>(null);
  const [sheetView, setSheetView] = useState<
    "menu" | "viewTx" | "confirmDelete"
  >("menu");

  const setTabBarHidden = useCallback(
    (hidden: boolean) => {
      (navigation as any).setOptions({
        tabBarStyle: hidden ? { display: 'none' } : undefined,
      });
    },
    [navigation],
  );

  const [filterVisible, setFilterVisible] = useState(false);
  const { width: _fwWidth } = useWindowDimensions();
  const isDesktop = _fwWidth >= 768;
  const filterBtnRef = useRef<View>(null);
  const kebabBtnElRef = useRef<HTMLElement | null>(null);
  const [filterPopoverPos, setFilterPopoverPos] = useState<{ top?: number; bottom?: number; right: number; maxHeight: number }>({ top: 0, right: 16, maxHeight: 400 });
  const openFilter = () => {
    if (isDesktop && filterBtnRef.current) {
      const el = filterBtnRef.current as unknown as HTMLElement;
      if (typeof el.getBoundingClientRect === 'function') {
        const rect = el.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom - 12;
        const spaceAbove = rect.top - 12;
        if (spaceBelow >= 280 || spaceBelow >= spaceAbove) {
          setFilterPopoverPos({ top: rect.bottom + 6, bottom: undefined, right: window.innerWidth - rect.right, maxHeight: Math.max(spaceBelow, 180) });
        } else {
          setFilterPopoverPos({ top: undefined, bottom: window.innerHeight - rect.top + 6, right: window.innerWidth - rect.right, maxHeight: Math.max(spaceAbove, 180) });
        }
      }
      setFilterVisible(v => !v);
    } else {
      setFilterVisible(true);
    }
  };

  // Reposicionar o popover quando o utilizador faz scroll (segue o botão)
  useEffect(() => {
    if (!filterVisible || !isDesktop) return;
    const reposition = () => {
      if (!filterBtnRef.current) return;
      const el = filterBtnRef.current as unknown as HTMLElement;
      if (typeof el.getBoundingClientRect !== 'function') return;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setFilterVisible(false);
        return;
      }
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      if (spaceBelow >= 280 || spaceBelow >= spaceAbove) {
        setFilterPopoverPos({ top: rect.bottom + 6, bottom: undefined, right: window.innerWidth - rect.right, maxHeight: Math.max(spaceBelow, 180) });
      } else {
        setFilterPopoverPos({ top: undefined, bottom: window.innerHeight - rect.top + 6, right: window.innerWidth - rect.right, maxHeight: Math.max(spaceAbove, 180) });
      }
    };
    document.addEventListener('scroll', reposition, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', reposition, { capture: true });
  }, [filterVisible, isDesktop]);

  // Reposicionar o kebab popover quando o utilizador faz scroll
  useEffect(() => {
    if (!kebabPopoverPos || !isDesktop) return;
    const reposition = () => {
      const el = kebabBtnElRef.current;
      if (!el || typeof el.getBoundingClientRect !== 'function') return;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setHoldingMenuSymbol(null);
        setKebabPopoverPos(null);
        return;
      }
      setKebabPopoverPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    };
    document.addEventListener('scroll', reposition, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', reposition, { capture: true });
  }, [kebabPopoverPos, isDesktop]);

  type Timespan = "since_buy" | "year" | "ytd" | "month" | "week" | "daily";
  type SummaryFilter = Timespan | "five_year" | "max" | "custom";
  type SortBy = "relative" | "absolute" | "position";
  const [timespan, setTimespan] = useState<Timespan>("daily");
  const [sortBy, setSortBy] = useState<SortBy>("relative");
  const [gainMode, setGainMode] = useState<'period' | 'alltime'>('period');
  const [refPrices, setRefPrices] = useState<Record<string, number>>({});
  const [summaryRefPrices, setSummaryRefPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(PORTFOLIO_FILTERS_KEY)
      .then((raw) => {
        if (!active || !raw) return;
        const parsed = JSON.parse(raw) as {
          timespan?: string;
          sortBy?: string;
          gainMode?: string;
        };
        if (parsed.timespan && (TIMESPANS as readonly string[]).includes(parsed.timespan)) {
          setTimespan(parsed.timespan as Timespan);
        }
        if (parsed.sortBy && (SORT_MODES as readonly string[]).includes(parsed.sortBy)) {
          setSortBy(parsed.sortBy as SortBy);
        }
        if (parsed.gainMode && (GAIN_MODES as readonly string[]).includes(parsed.gainMode)) {
          setGainMode(parsed.gainMode as 'period' | 'alltime');
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(
      PORTFOLIO_FILTERS_KEY,
      JSON.stringify({ timespan, sortBy, gainMode })
    ).catch(() => {});
  }, [timespan, sortBy, gainMode]);

  const dismissSheet = (keepTabBarHidden = false) => {
    setTabBarHidden(keepTabBarHidden);
    setHoldingMenuSymbol(null);
  };

  useEffect(() => {
    if (holdingMenuSymbol === null) return;
    setSheetView("menu");
  }, [holdingMenuSymbol]);
  const fetchQuotes = useCallback(async () => {
    if (holdings.length === 0) return;
    setLoading(true);
    try {
      const results = await Promise.all(
        holdings.map(async (h) => {
          if (h.symbol.startsWith('CASH_')) return { symbol: h.symbol, quote: null };
          const quote = await getStockQuote(h.symbol);
          return { symbol: h.symbol, quote };
        }),
      );
      const map: Record<string, StockQuote | null> = {};
      results.forEach(({ symbol, quote }) => (map[symbol] = quote));
      setQuotes(map);
    } finally {
      setLoading(false);
    }
  }, [holdings]);

  useEffect(() => {
    if (holdings.length === 0) return;
    Promise.all(holdings.map(async (h) => {
      if (h.symbol.startsWith('CASH_')) return { symbol: h.symbol, logo: null };
      const logo = await getStockLogo(h.symbol).catch(() => null);
      return { symbol: h.symbol, logo };
    })).then((results) => {
      const map: Record<string, string | null> = {};
      results.forEach(({ symbol, logo }) => (map[symbol] = logo));
      setLogos(map);
    });
  }, [holdings]);

  useEffect(() => {
    fetchQuotes();
  }, [fetchQuotes, refreshTick]);

  useFocusEffect(
    useCallback(() => {
      fetchQuotes();
    }, [fetchQuotes])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshTick((t) => t + 1);
    setRefreshing(false);
  }, []);

  // Busca preço de referência para o timespan selecionado
  useEffect(() => {
    if (
      timespan === "since_buy" ||
      timespan === "daily" ||
      holdings.length === 0
    ) {
      setRefPrices({});
      return;
    }
    const rangeMap: Record<string, [string, string]> = {
      week: ["5d", "1d"],
      month: ["1mo", "1d"],
      ytd: ["ytd", "1d"],
      year: ["1y", "1wk"],
    };
    const [range, interval] = rangeMap[timespan] ?? ["1mo", "1d"];
    let cancelled = false;
    Promise.all(
      holdings.map(async (h) => {
        if (h.symbol.startsWith('CASH_')) return { symbol: h.symbol, price: h.avgPrice };
        try {
          const data = await getHistoricalData(h.symbol, range, interval);
          return { symbol: h.symbol, price: data.prices[0] ?? null };
        } catch {
          return { symbol: h.symbol, price: null };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, number> = {};
      results.forEach(({ symbol, price }) => {
        if (price !== null) map[symbol] = price;
      });
      setRefPrices(map);
    });
    return () => {
      cancelled = true;
    };
  }, [timespan, holdings]);

  // Busca preços de referência independentes para o resumo do gráfico.
  useEffect(() => {
    if (holdings.length === 0) {
      setSummaryRefPrices({});
      return;
    }
    const summaryFilter: SummaryFilter | null = showCustomRange
      ? 'custom'
      : selectedPeriod === '1D' ? 'daily'
      : selectedPeriod === '1W' ? 'week'
      : selectedPeriod === '1M' ? 'month'
      : selectedPeriod === 'YTD' ? 'ytd'
      : selectedPeriod === '1Y' ? 'year'
      : selectedPeriod === '5Y' ? 'five_year'
      : selectedPeriod === 'Max' ? 'max'
      : null;
    if (!summaryFilter || summaryFilter === 'daily' || summaryFilter === 'max') {
      setSummaryRefPrices({});
      return;
    }
    const rangeMap: Record<Exclude<SummaryFilter, 'since_buy' | 'daily' | 'max'>, [string, string]> = {
      week: ['5d', '1d'],
      month: ['1mo', '1d'],
      ytd: ['ytd', '1d'],
      year: ['1y', '1wk'],
      five_year: ['5y', '1wk'],
      custom: ['max', '1d'],
    };
    const [range, interval] = rangeMap[summaryFilter];
    let cancelled = false;
    Promise.all(
      holdings.map(async (h) => {
        if (h.symbol.startsWith('CASH_')) return { symbol: h.symbol, price: h.avgPrice };
        try {
          const data = await getHistoricalData(h.symbol, range, interval);
          return { symbol: h.symbol, price: data.prices[0] ?? null };
        } catch {
          return { symbol: h.symbol, price: null };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, number> = {};
      results.forEach(({ symbol, price }) => {
        if (price !== null) map[symbol] = price;
      });
      setSummaryRefPrices(map);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedPeriod, holdings, showCustomRange, customFrom, customTo, refreshTick]);

  // Faz fetch de todos os holdings e calcula valor total do portfólio ao longo do tempo
  useEffect(() => {
    if (holdings.length === 0) return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setChartLoading(true);
    // Reset chart data so stale data from the previous period doesn't produce
    // wrong gain values while the new period's data is being fetched.
    setFullData({ prices: [], timestamps: [] });
    setChartVisiblePrices([]);

    // Data da compra mais antiga — o gráfico nunca mostra antes disto
    const earliestPurchaseTs = Math.floor(
      new Date(
        holdings.reduce(
          (min, h) => (h.purchaseDate < min ? h.purchaseDate : min),
          holdings[0].purchaseDate,
        ),
      ).getTime() / 1000,
    );

    const { range, interval } = showCustomRange ? { range: 'max', interval: '1d' } : CANDLE_PARAMS[selectedPeriod];

    Promise.all([
      Promise.all(
        holdings.map(async (h) => {
          if (h.symbol.startsWith('CASH_')) {
            return {
              h,
              d: {
                prices: [] as number[],
                timestamps: [] as number[],
              },
            };
          }
          try {
            const d = await getHistoricalData(h.symbol, range, interval);
            return { h, d };
          } catch {
            return {
              h,
              d: {
                prices: [] as number[],
                timestamps: [] as number[],
              },
            };
          }
        }),
      ),
      getHistoricalData("SPY", range, interval).catch(() => ({
        prices: [] as number[],
        timestamps: [] as number[],
      })),
    ])
      .then(([results, spyData]) => {
        // Usa os timestamps do holding com mais pontos como referência
        const ref = results.reduce((best, r) =>
          r.d.timestamps.length > best.d.timestamps.length ? r : best,
        );
        // Filtra timestamps anteriores à primeira compra
        // For monthly interval, snap earliestPurchaseTs back to start of that month
        // so monthly candles (timestamped on the 1st) are not incorrectly filtered out
        let filterTs = earliestPurchaseTs;
        if (interval === '1mo') {
          const d = new Date(earliestPurchaseTs * 1000);
          filterTs = Math.floor(new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000);
        }
        let refTs = ref.d.timestamps.filter((ts) => ts >= filterTs);

        // Yahoo Finance includes pre/post-market bars in 1h and 5m data. These cause
        // zigzag spikes because holdings with extended-hours coverage return an after-hours
        // price while holdings without it return their 4pm close → mixed prices create
        // artificial portfolio value swings at every session boundary.
        if (interval === '1h') {
          // US regular session: 9:30am–4pm ET
          //   EDT (UTC-4): 13:30–20:00 UTC
          //   EST (UTC-5): 14:30–21:00 UTC
          // Accept 13:30–20:30 UTC to cover both seasons without deep pre/post-market bars.
          refTs = refTs.filter((ts) => {
            const d = new Date(ts * 1000);
            const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
            return utcMin >= 13 * 60 + 30 && utcMin <= 20 * 60 + 30;
          });
        } else if (interval === '5m') {
          // For 5-minute bars (1D period), filter out extended-hours bars.
          // Same UTC window as 1h: keep 13:30–20:30 UTC (regular US session).
          refTs = refTs.filter((ts) => {
            const d = new Date(ts * 1000);
            const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
            return utcMin >= 13 * 60 + 30 && utcMin <= 20 * 60 + 30;
          });
        }

        if (refTs.length < 2) return;

        // Inject a synthetic start point at the earliest purchase date ONLY if that
        // date falls within the fetched data window. If the portfolio has been running
        // for years but the current period only fetches 5 days (1D) or 1 month (1W),
        // injecting a 2021 timestamp would produce a bogus data point — the only
        // available bars are recent, so their prices get applied to 2021 share counts,
        // creating wildly inflated/deflated first values.
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

        // Para cada timestamp de referência, soma preço*shares de todos os holdings
        const portfolioPrices = refTs.map((ts) => {
          return results.reduce((sum, { h, d }) => {
            // Shares held at this timestamp (replays buy/sell txs up to ts)
            const symTxs = transactions
              .filter((t) => t.symbol === h.symbol)
              .sort((a, b) => a.date.localeCompare(b.date));
            let sharesAtTs = 0;
            for (const t of symTxs) {
              if (new Date(t.date).getTime() / 1000 > ts) break;
              sharesAtTs += t.type === 'buy' ? t.shares : -t.shares;
            }
            sharesAtTs = Math.max(0, sharesAtTs);
            // Fallback if no transactions recorded (legacy holding)
            if (symTxs.length === 0) {
              const holdingPurchaseTs = Math.floor(new Date(h.purchaseDate).getTime() / 1000);
              sharesAtTs = ts >= holdingPurchaseTs ? h.shares : 0;
            }
            if (sharesAtTs <= 0) return sum;
            if (d.timestamps.length === 0)
              return sum + h.avgPrice * sharesAtTs * marketRateH(h, quotes[h.symbol]);
            // Encontra o índice com timestamp mais próximo
            let closest = 0;
            let minDiff = Math.abs(d.timestamps[0] - ts);
            for (let i = 1; i < d.timestamps.length; i++) {
              const diff = Math.abs(d.timestamps[i] - ts);
              if (diff < minDiff) {
                minDiff = diff;
                closest = i;
              }
            }
            // If the nearest bar is >4 hours from the reference timestamp AND this is
            // a recent bar (within last 24h), fall back to the live quote so it stays
            // consistent with latestPortfolioValue (e.g. trading halt, missing today's data).
            // Do NOT use live quote for historical bars — it would inject today's price
            // into old chart points, causing random spikes in the historical chart.
            const STALE_THRESHOLD_S = 4 * 3600;
            const nowSec = Date.now() / 1000;
            const isRecentTs = ts > nowSec - 24 * 3600;
            const liveQ = quotes[h.symbol];
            const barPrice = (isRecentTs && minDiff > STALE_THRESHOLD_S && liveQ)
              ? effectivePrice(liveQ)
              : (d.prices[closest] ?? h.avgPrice);
            return (
              sum + barPrice * sharesAtTs * marketRateH(h, quotes[h.symbol])
            );
          }, 0);
        });

        // Strip leading zeros — monthly candle timestamps can precede the first buy date,
        // producing a zero portfolio value at the start of the series.
        let firstValid = portfolioPrices.findIndex(p => p > 0);
        if (firstValid === -1) firstValid = 0;

        // No live-point injection: the chart ends at the last completed bar.
        // Injecting a live point (from quotes) caused a visible spike because
        // European stocks close 4-8h before the US session ends, so their
        // bar price and live quote always differ at the end of the US day.
        const combinedPrices = portfolioPrices.slice(firstValid);
        const combinedTimestamps = refTs.slice(firstValid);

        const combined: HistoricalData = {
          prices: combinedPrices,
          timestamps: combinedTimestamps,
        };
        setFullData(combined);

        // SPX overlay — benchmarked with the same portfolio cash flows,
        // so it tracks comparable performance instead of raw value.
        if (spyData.timestamps.length > 0 && portfolioPrices.length > 0) {
          const spyPriceAt = (ts: number) => {
            let closest = 0;
            let minDiff = Math.abs(spyData.timestamps[0] - ts);
            for (let i = 1; i < spyData.timestamps.length; i++) {
              const diff = Math.abs(spyData.timestamps[i] - ts);
              if (diff < minDiff) {
                minDiff = diff;
                closest = i;
              }
            }
            return spyData.prices[closest] ?? 0;
          };

          const spxRaw = refTs.map((ts) => {
            return spyPriceAt(ts);
          });

          const benchmarkFlows = holdings
            .flatMap((h) => {
              if (h.symbol.startsWith('CASH_')) return [] as Array<{ ts: number; amount: number }>;

              const quote = quotes[h.symbol];
              const rate = marketRateH(h, quote);
              const symTxs = transactions
                .filter((t) => t.symbol === h.symbol)
                .sort((a, b) => a.date.localeCompare(b.date));

              if (symTxs.length > 0) {
                return symTxs.map((t) => ({
                  ts: Math.floor(new Date(t.date).getTime() / 1000),
                  amount: (t.type === 'buy' ? 1 : -1) * t.shares * t.price * rate,
                }));
              }

              return [{
                ts: Math.floor(new Date(h.purchaseDate).getTime() / 1000),
                amount: h.avgPrice * h.shares * rate,
              }];
            })
            .sort((a, b) => a.ts - b.ts);

          const benchmarkValues = refTs.map((ts) => {
            let units = 0;
            for (const flow of benchmarkFlows) {
              if (flow.ts > ts) break;
              const flowSpyPrice = spyPriceAt(flow.ts);
              if (flowSpyPrice <= 0) continue;
              units += flow.amount / flowSpyPrice;
            }
            const currentSpyPrice = spyPriceAt(ts);
            return currentSpyPrice > 0 ? units * currentSpyPrice : 0;
          });

          const alignedBenchmarkValues = benchmarkValues.slice(firstValid);
          if (alignedBenchmarkValues.length > 0) {
            const lastTs = combinedTimestamps[combinedTimestamps.length - 1] ?? 0;
            const benchmarkLastTs = refTs[refTs.length - 1] ?? 0;
            if (lastTs > benchmarkLastTs) {
              alignedBenchmarkValues.push(alignedBenchmarkValues[alignedBenchmarkValues.length - 1]);
            }
          }
          setSpxOverlay(alignedBenchmarkValues);
        } else {
          setSpxOverlay([]);
        }
      })
      .catch(() => {})
      .finally(() => setChartLoading(false));
  }, [selectedPeriod, showCustomRange, holdings, getRateFor, refreshTick]);

  // ---- cálculos do portfólio ----
  const totalValue = holdings.reduce((sum, h) => {
    const q = quotes[h.symbol];
    const price = (q ? effectivePrice(q) : h.avgPrice) * marketRateH(h, q);
    return sum + price * h.shares;
  }, 0);
  const totalCost = holdings.reduce(
    (sum, h) => sum + h.avgPrice * costRateH(h) * h.shares,
    0,
  );
  const totalGain = totalValue - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
  const isPositive = totalGain >= 0;

  useEffect(() => {
    if (fullData.prices.length === 0 || totalValue <= 0) return;
    const lastIdx = fullData.prices.length - 1;
    if (Math.abs((fullData.prices[lastIdx] ?? 0) - totalValue) < 0.01) return;
    setFullData((prev) => {
      if (prev.prices.length === 0) return prev;
      const nextPrices = prev.prices.slice();
      nextPrices[nextPrices.length - 1] = totalValue;
      return { ...prev, prices: nextPrices };
    });
  }, [totalValue, fullData.prices.length]);

  const referencePriceForFilter = (h: Holding, filter: SummaryFilter, priceMap: Record<string, number>) => {
    const q = quotes[h.symbol];
    const rate = marketRateH(h, q);
    if (filter === 'max' || filter === 'since_buy') return h.avgPrice * rate;
    if (filter === 'daily') {
      // If the holding was purchased on or after yesterday, previousClose predates the purchase
      // so we compare against the purchase price instead of yesterday's close.
      if (h.purchaseDate) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        if (new Date(h.purchaseDate + 'T00:00:00') >= yesterday) {
          return h.avgPrice * rate;
        }
      }
      return (q?.pc ?? h.avgPrice) * rate;
    }
    if (priceMap[h.symbol] != null) {
      const now = new Date();
      const refCutoff: Date =
        filter === 'custom' ? new Date((customFrom || h.purchaseDate) + 'T00:00:00') :
        filter === 'five_year' ? new Date(now.getFullYear() - 5, now.getMonth(), now.getDate()) :
        filter === 'ytd'   ? new Date(now.getFullYear(), 0, 1) :
        filter === 'year'  ? new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()) :
        filter === 'month' ? new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()) :
                             new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      if (h.purchaseDate && new Date(h.purchaseDate) > refCutoff) {
        return h.avgPrice * rate;
      }
      return priceMap[h.symbol] * rate;
    }
    return h.avgPrice * rate;
  };
  const holdingReferencePrice = (h: Holding, filter: Timespan) =>
    referencePriceForFilter(h, filter, refPrices);
  const periodSummaryForFilter = (filter: SummaryFilter) => {
    const refValue = holdings.reduce((sum, h) => {
      return sum + referencePriceForFilter(h, filter, summaryRefPrices) * h.shares;
    }, 0);
    const gain = totalValue - refValue;
    const gainPct = refValue > 0 ? (gain / refValue) * 100 : 0;
    return { gain, gainPct, refValue };
  };

  // ---- Ordenação de holdings conforme filtro ----
  const holdingGainPct = (h: Holding) => {
    const q = quotes[h.symbol];
    const rate = marketRateH(h, q);
    const current = (q ? effectivePrice(q) : h.avgPrice) * rate;
    const refPrice = holdingReferencePrice(h, timespan);
    return refPrice > 0 ? ((current - refPrice) / refPrice) * 100 : 0;
  };
  const holdingAbsGain = (h: Holding) => {
    const q = quotes[h.symbol];
    const rate = marketRateH(h, q);
    const current = (q ? effectivePrice(q) : h.avgPrice) * rate;
    const refPrice = holdingReferencePrice(h, timespan);
    return (current - refPrice) * h.shares;
  };
  const holdingPositionSize = (h: Holding) => {
    const q = quotes[h.symbol];
    return (q ? effectivePrice(q) : h.avgPrice) * marketRateH(h, q) * h.shares;
  };
  const sortedHoldings = [...holdings].sort((a, b) => {
    if (sortBy === "relative") return holdingGainPct(b) - holdingGainPct(a);
    if (sortBy === "absolute") return holdingAbsGain(b) - holdingAbsGain(a);
    return holdingPositionSize(b) - holdingPositionSize(a);
  });
  const renderRightActions = (
    symbol: string,
    progress: Animated.AnimatedInterpolation<number>,
  ) => {
    const opacity = progress.interpolate({
      inputRange: [0, 0.4, 1],
      outputRange: [0, 0.6, 1],
      extrapolate: "clamp",
    });
    const translateX = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [24, 0],
      extrapolate: "clamp",
    });
    return (
      <Animated.View
        style={{ opacity, transform: [{ translateX }], alignSelf: "stretch" }}
      >
        <TouchableOpacity
          style={styles.menuAction}
          onPress={() => {
            setTabBarHidden(true);
            setHoldingMenuSymbol(symbol);
          }}
        >
          <Text style={styles.menuActionText}>···</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const renderHolding = ({ item }: ListRenderItemInfo<Holding>) => {
    const isCash = item.symbol.startsWith('CASH_');
    const quote = quotes[item.symbol];
    const rate = marketRateH(item, quote);

    // Current effective price (pre/post/regular) — used for value and main gain
    const regularPrice = quote ? effectivePrice(quote) : item.avgPrice;
    const currentPrice = regularPrice * rate;
    const value = currentPrice * item.shares;

    // For gain/pct: use regular close as current when in extended hours
    const ms = quote?.marketState;
    const isPreMarket = ms === 'PRE';
    const isPostMarket = ms === 'POST' || ms === 'POSTPOST';
    const isExtended = isPreMarket || isPostMarket;

    // Extended hours price (pre or post)
    const extP = isPreMarket
      ? (quote?.preMarketPrice ?? null)
      : isPostMarket
      ? (quote?.postMarketPrice ?? null)
      : null;
    const extChange = extP != null && quote ? extP - (quote.c ?? 0) : null;
    const extPct = extChange != null && quote && (quote.c ?? 0) > 0 ? (extChange / (quote.c ?? 1)) * 100 : null;
    const extPos = extChange != null && extChange >= 0;

    const gainPct = holdingGainPct(item);
    const gain = holdingAbsGain(item);
    const pos = gainPct >= 0;
    const isRegular = ms === 'REGULAR';
    const isClosed = ms === 'CLOSED' || ms === 'PREPRE';
    const marketBadge = isPreMarket ? 'PRE' : isPostMarket ? 'AFTER' : isRegular ? 'OPEN' : isClosed ? 'CLOSED' : null;
    const marketBadgeStyle = isPreMarket ? styles.marketBadgePre : isPostMarket ? styles.marketBadgePost : isRegular ? styles.marketBadgeRegular : styles.marketBadgeClosed;
    const marketBadgeTxtColor = isPreMarket ? '#fb923c' : isPostMarket ? '#93c5fd' : isRegular ? '#86efac' : '#94a3b8';
    const cardContent = (
      <View style={styles.holdingCard}>
        <View style={styles.holdingLeft}>
          {isCash ? (
            <View style={[styles.tickerBadge, { backgroundColor: '#166534' }]}>
              <Text style={styles.tickerText}>💵</Text>
            </View>
          ) : !logoErrors[item.symbol] ? (
            <Image
              source={{ uri: logos[item.symbol] ?? `https://images.financialmodelingprep.com/symbol/${item.symbol}.png` }}
              style={styles.logoImg}
              resizeMode="contain"
              onError={() => setLogoErrors(prev => ({ ...prev, [item.symbol]: true }))}
            />
          ) : (
            <View style={styles.tickerBadge}>
              <Text style={styles.tickerText}>{item.symbol.slice(0, 2)}</Text>
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.holdingSymbol, { flexShrink: 1 }]} numberOfLines={1}>{item.name || item.symbol}</Text>
              {!isCash && marketBadge && (
                <View style={[styles.marketBadge, marketBadgeStyle]}>
                  <Text style={[styles.marketBadgeTxt, { color: marketBadgeTxtColor }]}>{marketBadge}</Text>
                </View>
              )}
            </View>
            {!isCash && (
              <BlurValue hidden={hideValues} style={{ alignSelf: 'flex-start' }}>
                <Text style={styles.holdingDate}>
                  {item.shares % 1 === 0
                    ? item.shares.toFixed(0)
                    : item.shares.toFixed(4).replace(/\.?0+$/, '')}{" "}
                  x {fmtMoney(item.avgPrice)}{" "}
                  {item.currency && item.currency !== currency
                    ? item.currency
                    : currencySymbol}
                </Text>
              </BlurValue>
            )}
          </View>
        </View>
        <View style={styles.holdingRight}>
          <BlurValue hidden={hideValues}>
            <Text style={styles.holdingValue}>
              {fmtMoney(value)} {currencySymbol}
            </Text>
          </BlurValue>
          {!isCash && (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <BlurValue hidden={hideValues} tint={pos ? 'green' : 'red'}>
                <Text style={[styles.holdingGain, { color: pos ? "#22c55e" : "#ef4444" }]}>
                  {pos ? "+" : ""}{fmtMoney(gain)} {currencySymbol}
                </Text>
              </BlurValue>
              <Text style={[styles.holdingGain, { color: pos ? "#22c55e" : "#ef4444" }]}>
                {" "}({pos ? "+" : ""}{gainPct.toFixed(2)}%)
              </Text>
            </View>
          )}
          {/* Extended hours row — label + stock price + portfolio impact */}
          {!isCash && isExtended && extP != null && extChange != null && extPct != null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <Ionicons name={isPreMarket ? 'sunny-outline' : 'moon-outline'} size={10} color="#94a3b8" />
              <Text style={{ fontSize: 11, color: '#94a3b8' }}>{isPreMarket ? 'Pre' : 'After'}</Text>
              <Text style={{ fontSize: 11, color: '#94a3b8' }}>{fmtMoney(extP)} {item.currency === 'EUR' ? '€' : '$'}</Text>
              <BlurValue hidden={hideValues} tint={extPos ? 'green' : 'red'}>
                <Text style={{ fontSize: 11, color: extPos ? '#22c55e' : '#ef4444' }}>
                  {extPos ? '+' : ''}{fmtMoney(extChange * rate * item.shares)} {currencySymbol}
                </Text>
              </BlurValue>
              <Text style={{ fontSize: 11, color: extPos ? '#22c55e' : '#ef4444' }}>
                {" "}({extPos ? '+' : ''}{extPct.toFixed(2)}%)
              </Text>
            </View>
          )}
        </View>
      </View>
    );
    if (isDesktop) {
      const kebabBtn = (
        <TouchableOpacity
          style={styles.kebabBtn}
          onPress={(e) => {
            const nativeEl = (e.nativeEvent as any).target as HTMLElement;
            const btn = (nativeEl?.closest?.('[role="button"]') as HTMLElement) ?? nativeEl;
            kebabBtnElRef.current = btn ?? null;
            if (btn && typeof btn.getBoundingClientRect === 'function') {
              const rect = btn.getBoundingClientRect();
              setKebabPopoverPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
            } else {
              const { clientX, clientY } = e.nativeEvent as any;
              setKebabPopoverPos({ top: (clientY ?? 0) + 8, right: window.innerWidth - (clientX ?? 0) });
            }
            setHoldingMenuSymbol(item.symbol);
            setSheetView('menu');
          }}
          hitSlop={8}
        >
          <Ionicons name="ellipsis-vertical" size={18} color="#64748b" />
        </TouchableOpacity>
      );
      const desktopCard = (
        <View style={[styles.holdingCard, { paddingRight: 4 }]}>
          <View style={styles.holdingLeft}>
            {isCash ? (
              <View style={[styles.tickerBadge, { backgroundColor: '#166534' }]}>
                <Text style={styles.tickerText}>💵</Text>
              </View>
            ) : !logoErrors[item.symbol] ? (
              <Image
                source={{ uri: logos[item.symbol] ?? `https://images.financialmodelingprep.com/symbol/${item.symbol}.png` }}
                style={styles.logoImg}
                resizeMode="contain"
                onError={() => setLogoErrors(prev => ({ ...prev, [item.symbol]: true }))}
              />
            ) : (
              <View style={styles.tickerBadge}>
                <Text style={styles.tickerText}>{item.symbol.slice(0, 2)}</Text>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.holdingSymbol, { flexShrink: 1 }]} numberOfLines={1}>{item.name || item.symbol}</Text>
                {!isCash && marketBadge && (
                  <View style={[styles.marketBadge, marketBadgeStyle]}>
                    <Text style={[styles.marketBadgeTxt, { color: marketBadgeTxtColor }]}>{marketBadge}</Text>
                  </View>
                )}
              </View>
              {!isCash && (
                <BlurValue hidden={hideValues} style={{ alignSelf: 'flex-start' }}>
                  <Text style={styles.holdingDate}>
                    {item.shares % 1 === 0
                      ? item.shares.toFixed(0)
                      : item.shares.toFixed(4).replace(/\.?0+$/, '')}{" "}
                    x {fmtMoney(item.avgPrice)}{" "}
                    {item.currency && item.currency !== currency
                      ? item.currency
                      : currencySymbol}
                  </Text>
                </BlurValue>
              )}
            </View>
          </View>
          <View style={[styles.holdingRight, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
            <View style={{ alignItems: 'flex-end' }}>
              <BlurValue hidden={hideValues}>
                <Text style={styles.holdingValue}>
                  {fmtMoney(value)} {currencySymbol}
                </Text>
              </BlurValue>
              {!isCash && (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <BlurValue hidden={hideValues} tint={pos ? 'green' : 'red'}>
                    <Text style={[styles.holdingGain, { color: pos ? '#22c55e' : '#ef4444' }]}>
                      {pos ? '+' : ''}{fmtMoney(gain)} {currencySymbol}
                    </Text>
                  </BlurValue>
                  <Text style={[styles.holdingGain, { color: pos ? '#22c55e' : '#ef4444' }]}>
                    {' '}({pos ? '+' : ''}{gainPct.toFixed(2)}%)
                  </Text>
                </View>
              )}
              {!isCash && isExtended && extP != null && extChange != null && extPct != null && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                  <Ionicons name={isPreMarket ? 'sunny-outline' : 'moon-outline'} size={10} color="#94a3b8" />
                  <Text style={{ fontSize: 11, color: '#94a3b8' }}>{isPreMarket ? 'Pre' : 'After'}</Text>
                  <Text style={{ fontSize: 11, color: '#94a3b8' }}>{fmtMoney(extP)} {item.currency === 'EUR' ? '€' : '$'}</Text>
                  <BlurValue hidden={hideValues} tint={extPos ? 'green' : 'red'}>
                    <Text style={{ fontSize: 11, color: extPos ? '#22c55e' : '#ef4444' }}>
                      {extPos ? '+' : ''}{fmtMoney(extChange * rate * item.shares)} {currencySymbol}
                    </Text>
                  </BlurValue>
                  <Text style={{ fontSize: 11, color: extPos ? '#22c55e' : '#ef4444' }}>
                    {' '}({extPos ? '+' : ''}{extPct.toFixed(2)}%)
                  </Text>
                </View>
              )}
            </View>
            {kebabBtn}
          </View>
        </View>
      );
      return isCash ? (
        <View>{desktopCard}</View>
      ) : (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() =>
            navigation.navigate('StockDetail', {
              symbol: item.symbol,
              name: item.name,
              shares: item.shares,
              avgPrice: item.avgPrice,
            })
          }
        >
          {desktopCard}
        </TouchableOpacity>
      );
    }

    return (
      <Swipeable
        renderRightActions={(progress) =>
          renderRightActions(item.symbol, progress)
        }
        overshootRight={false}
        friction={2}
        rightThreshold={40}
        overshootFriction={8}
      >
        {isCash ? (
          <View>{cardContent}</View>
        ) : (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() =>
              navigation.navigate("StockDetail", {
                symbol: item.symbol,
                name: item.name,
                shares: item.shares,
                avgPrice: item.avgPrice,
              })
            }
          >
            {cardContent}
          </TouchableOpacity>
        )}
      </Swipeable>
    );
  };

  const header = (
    <View>
      <View style={styles.heroSection}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {crosshairVisible && chDateStr
              ? <Text style={styles.heroLabel}>{chDateStr}</Text>
              : (
                <TouchableOpacity
                  onPress={() => navigation.navigate('PortfoliosManager')}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.heroLabel}>{activePortfolioName}</Text>
                  <Ionicons name="chevron-down" size={13} color="#64748b" />
                </TouchableOpacity>
              )
            }
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <IconActionButton icon="chatbubble-ellipses-outline" size={17} onPress={() => navigation.navigate("PortfolioChat")} />
            <IconActionButton icon={hideValues ? "eye-off-outline" : "eye-outline"} size={17} onPress={() => setHideValues(!hideValues)} />
          </View>
        </View>
        <BlurValue hidden={hideValues} style={{ alignSelf: 'flex-start' }}>
          <Text style={styles.heroValue}>
            {fmtMoney(crosshairVisible ? chPrice : totalValue)}{" "}{currencySymbol}
          </Text>
        </BlurValue>
        {(() => {
          const displayValue = crosshairVisible ? chPrice : totalValue;
          let g: number, gPct: number;
          let periodRef: number;
          const selectedSummaryFilter: SummaryFilter | null = showCustomRange
            ? 'custom'
            : selectedPeriod === '1D' ? 'daily'
            : selectedPeriod === '1W' ? 'week'
            : selectedPeriod === '1M' ? 'month'
            : selectedPeriod === 'YTD' ? 'ytd'
            : selectedPeriod === '1Y' ? 'year'
            : selectedPeriod === '5Y' ? 'five_year'
            : selectedPeriod === 'Max' ? 'max'
            : null;
          if (fullData.prices.length === 0) {
            periodRef = totalValue;
          } else if (chartVisiblePrices.length > 0) {
            periodRef = chartVisiblePrices[0];
          } else {
            if (showCustomRange) {
              const fromTs = customFrom ? new Date(customFrom + 'T00:00:00').getTime() / 1000 : 0;
              const idx = fullData.timestamps.findIndex(t => t >= fromTs);
              periodRef = fullData.prices[idx !== -1 ? idx : 0] ?? fullData.prices[0];
            } else {
              const nPoints = pointsForPeriod(fullData.timestamps, selectedPeriod);
              const startIdx = nPoints >= fullData.prices.length ? 0 : fullData.prices.length - nPoints;
              periodRef = fullData.prices[startIdx] ?? fullData.prices[0];
            }
          }
          const selectedSummary = !crosshairVisible && selectedSummaryFilter
            ? periodSummaryForFilter(selectedSummaryFilter)
            : null;
          const chartPeriodGain = displayValue - periodRef;
          const chartPeriodGainPct = periodRef > 0 ? (chartPeriodGain / periodRef) * 100 : 0;
          const roiGain = selectedSummary ? selectedSummary.gain : chartPeriodGain;
          if (gainMode === 'alltime') {
            // ROI mode follows the selected filter for the euro gain,
            // but measures that gain against invested portfolio capital.
            g = roiGain;
            gPct = totalCost > 0 ? (g / totalCost) * 100 : 0;
          } else {
            // Period mode: raw portfolio value change over the selected chart window.
            g = chartPeriodGain;
            gPct = chartPeriodGainPct;
          }
          const pos = g >= 0;
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <BlurValue hidden={hideValues} tint={pos ? 'green' : 'red'}>
                <Text style={[styles.heroGain, { color: pos ? "#22c55e" : "#ef4444", marginTop: 0 }]}>
                  {pos ? "+" : ""}{fmtMoney(g)} {currencySymbol}
                </Text>
              </BlurValue>
              <Text style={[styles.heroGain, { color: pos ? "#22c55e" : "#ef4444", marginTop: 0 }]}>
                {" "}({pos ? "+" : ""}{gPct.toFixed(2)}%)
              </Text>
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
        <BlurValue hidden={hideValues} style={{ alignSelf: 'flex-start' }}>
          <Text style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
            Invested: {fmtMoney(totalCost)} {currencySymbol}
          </Text>
        </BlurValue>
      </View>

      <View>
        {chartType === 'line' ? (
        <InteractiveChart
          key={`${showCustomRange ? `custom-${customFrom}-${customTo}` : selectedPeriod}-${fullData.timestamps.length}`}
          prices={fullData.prices}
          timestamps={fullData.timestamps}
          initialPoints={(() => {
            if (showCustomRange && customFrom && customTo) {
              const fromTs = new Date(customFrom + 'T00:00:00').getTime() / 1000;
              const toTs   = new Date(customTo   + 'T23:59:59').getTime() / 1000;
              const si = fullData.timestamps.findIndex(t => t >= fromTs);
              if (si === -1) return fullData.timestamps.length;
              let ei = si;
              for (let i = fullData.timestamps.length - 1; i >= si; i--) { if (fullData.timestamps[i] <= toTs) { ei = i; break; } }
              return Math.max(1, ei - si + 1);
            }
            return pointsForPeriod(fullData.timestamps, selectedPeriod);
          })()}
          color={isPositive ? '#22c55e' : '#ef4444'}
          overlayPrices={
            spxOverlay.length === fullData.prices.length ? spxOverlay : undefined
          }
          onCrosshairChange={(visible, price, ts) => {
            setCrosshairVisible(visible);
            setChPrice(price);
            setChDateStr(
              visible && ts
                ? new Date(ts * 1000).toLocaleDateString('pt-PT', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })
                : '',
            );
          }}
          onVisibleChange={(vp) => setChartVisiblePrices(vp)}
        />
        ) : (
        <CandlestickChart
          key={`candle-${showCustomRange ? `custom-${customFrom}-${customTo}` : selectedPeriod}-${candleData.close.length}`}
          open={candleData.open}
          high={candleData.high}
          low={candleData.low}
          close={candleData.close}
          timestamps={candleData.timestamps}
          initialPoints={pointsForPeriod(fullData.timestamps, selectedPeriod)}
          loading={chartLoading}
          footerLegend={spxOverlay.length >= 2 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View
                  style={{
                    width: 16,
                    height: 2,
                    backgroundColor: isPositive ? '#22c55e' : '#ef4444',
                    borderRadius: 1,
                  }}
                />
                <Text style={{ color: '#94a3b8', fontSize: 11 }}>Portfolio</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View
                  style={{
                    width: 16,
                    height: 2,
                    backgroundColor: 'rgba(148,163,184,0.7)',
                    borderRadius: 1,
                  }}
                />
                <Text style={{ color: '#94a3b8', fontSize: 11 }}>S&P 500</Text>
              </View>
            </View>
          ) : null}
          footerAccessory={
            <ChartTypeToggleButton
              value={chartType}
              size={28}
              onChange={(next) => setChartType(next)}
            />
          }
          onCrosshairChange={(visible, price, ts) => {
            setCrosshairVisible(visible);
            setChPrice(price);
            setChDateStr(
              visible && ts
                ? new Date(ts * 1000).toLocaleDateString('pt-PT', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })
                : '',
            );
          }}
          onVisibleChange={(closes) => {
            setCandleVisibleClose(closes);
            setChartVisiblePrices(closes);
          }}
        />
        )}
        {chartLoading && (
          <ActivityIndicator
            size="small"
            color="#6366f1"
            style={{ position: 'absolute', top: 80, alignSelf: 'center', zIndex: 1 }}
          />
        )}
      </View>

      {/* Legenda do gráfico */}
      {spxOverlay.length >= 2 && chartType === 'line' && (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: 'center',
            paddingHorizontal: 16,
            marginTop: 4,
            marginBottom: 2,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View
                style={{
                  width: 16,
                  height: 2,
                  backgroundColor: isPositive ? "#22c55e" : "#ef4444",
                  borderRadius: 1,
                }}
              />
              <Text style={{ color: "#94a3b8", fontSize: 11 }}>Portfolio</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View
                style={{
                  width: 16,
                  height: 2,
                  backgroundColor: "rgba(148,163,184,0.7)",
                  borderRadius: 1,
                }}
              />
              <Text style={{ color: "#94a3b8", fontSize: 11 }}>S&P 500</Text>
            </View>
          </View>
          <ChartTypeToggleButton
            value={chartType}
            size={28}
            onChange={(next) => setChartType(next)}
          />
        </View>
      )}

      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p}
            style={[
              styles.periodBtn,
              !showCustomRange && selectedPeriod === p && styles.periodBtnActive,
            ]}
            onPress={() => { setShowCustomRange(false); setSelectedPeriod(p); setChartVisiblePrices([]); }}
          >
            <Text
              style={[
                styles.periodText,
                !showCustomRange && selectedPeriod === p && styles.periodTextActive,
              ]}
            >
              {p}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[styles.periodBtn, showCustomRange && styles.periodBtnActive]}
          onPress={() => { setShowCustomRange(v => !v); setChartVisiblePrices([]); }}
        >
          <Text style={[styles.periodText, showCustomRange && styles.periodTextActive]}>Custom</Text>
        </TouchableOpacity>
      </View>
      {showCustomRange && (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b' }}>
          <TextInput
            value={customFrom}
            onChangeText={setCustomFrom}
            placeholder="From YYYY-MM-DD"
            placeholderTextColor="#475569"
            style={{ flex: 1, color: '#f1f5f9', backgroundColor: '#1e293b', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13 }}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          <Text style={{ color: '#64748b', fontSize: 14 }}>→</Text>
          <TextInput
            value={customTo}
            onChangeText={setCustomTo}
            placeholder="To YYYY-MM-DD"
            placeholderTextColor="#475569"
            style={{ flex: 1, color: '#f1f5f9', backgroundColor: '#1e293b', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13 }}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
        </View>
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Positions</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {loading && <ActivityIndicator size="small" color="#6366f1" />}
          <IconActionButton
            icon="stats-chart-outline"
            size={18}
            onPress={() => navigation.navigate("PortfolioPerformance")}
          />
          <IconActionButton
            icon="pie-chart-outline"
            size={18}
            onPress={() => navigation.navigate("PortfolioCharts")}
          />
          <View ref={filterBtnRef}>
            <IconActionButton
              label={`${(
                {
                  since_buy: "Since buy",
                  year: "Year",
                  ytd: "YTD",
                  month: "Month",
                  week: "Week",
                  daily: "Daily",
                } as Record<string, string>
              )[timespan]} · ${(
                {
                  relative: "%",
                  absolute: "€",
                  position: "≡",
                } as Record<string, string>
              )[sortBy]}`}
              variant="pill"
              onPress={openFilter}
              textStyle={styles.filterBtnTxt}
            />
          </View>
        </View>
      </View>

      {holdings.length === 0 && (
        <Text style={styles.empty}>
          You do not own any stocks yet.{"\n"}Add them from the &quot;Search&quot; tab.
        </Text>
      )}
    </View>
  );

  if (portfolioLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#0f0f0f',
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <>
      <FlatList
        style={styles.container}
        data={sortedHoldings}
        keyExtractor={(item) => item.symbol}
        renderItem={renderHolding}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 120, 148) }}
        scrollEnabled={scrollEnabled}
        extraData={{ sortBy, crosshairVisible, chPrice, chDateStr, gainMode, selectedPeriod, chartVisiblePrices, fullData, totalValue, totalGain, totalGainPct, totalCost, hideValues, chartLoading, chartType, spxOverlay, candleData }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
            colors={["#6366f1"]}
          />
        }
      />

      {/* Desktop: popover kebab menu via Modal */}
      <Modal
        visible={isDesktop && holdingMenuSymbol !== null && kebabPopoverPos !== null}
        transparent
        animationType="none"
        onRequestClose={() => { setHoldingMenuSymbol(null); setKebabPopoverPos(null); }}
      >
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={() => { setHoldingMenuSymbol(null); setKebabPopoverPos(null); }}
        >
          <Pressable
            style={{
              position: 'absolute',
              top: kebabPopoverPos?.top ?? 0,
              right: kebabPopoverPos?.right ?? 0,
              backgroundColor: '#1e293b',
              borderRadius: 12,
              paddingVertical: 6,
              minWidth: 200,
              shadowColor: '#000',
              shadowOpacity: 0.5,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 6 },
            }}
            onPress={() => {}}
          >
            {sheetView === 'menu' && (
              <>
                <TouchableOpacity
                  style={styles.popoverItem}
                  onPress={() => {
                    if (isCombinedPortfolio) {
                      closeKebab();
                      Alert.alert('Read-only', 'Select a specific portfolio before adding transactions.');
                      return;
                    }
                    const sym = holdingMenuSymbol;
                    closeKebab();
                    setTimeout(() => {
                      if (sym) {
                        const holding = holdings.find((h) => h.symbol === sym);
                        setTxInitialPrice(
                          holding && quotes[sym]?.c != null
                            ? quotes[sym]!.c.toFixed(2)
                            : holding ? holding.avgPrice.toFixed(2) : ''
                        );
                        const nc = holding?.currency ?? 'USD';
                        setTxNativeCurrencySymbol(nc === 'EUR' ? '€' : nc === 'GBP' ? '£' : nc === 'USD' ? '$' : nc);
                        setTabBarHidden(true);
                        setTxSymbol(sym);
                      }
                    }, 50);
                  }}
                >
                  <Ionicons name="add-circle-outline" size={16} color="#94a3b8" style={{ marginRight: 10 }} />
                  <Text style={styles.popoverItemText}>Add transaction</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.popoverItem}
                  onPress={() => { closeKebabOpenDialog('viewTx'); }}
                >
                  <Ionicons name="list-outline" size={16} color="#94a3b8" style={{ marginRight: 10 }} />
                  <Text style={styles.popoverItemText}>View transactions</Text>
                </TouchableOpacity>
                <View style={{ height: 1, backgroundColor: '#334155', marginVertical: 4 }} />
                <TouchableOpacity
                  style={styles.popoverItem}
                  onPress={() => {
                    if (isCombinedPortfolio) {
                      closeKebab();
                      Alert.alert('Read-only', 'Select a specific portfolio before deleting positions.');
                      return;
                    }
                    closeKebabOpenDialog('confirmDelete');
                  }}
                >
                  <Ionicons name="trash-outline" size={16} color="#ef4444" style={{ marginRight: 10 }} />
                  <Text style={[styles.popoverItemText, { color: '#ef4444' }]}>Delete position</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Desktop: centred dialog for viewTx / confirmDelete */}
      <Modal
        visible={isDesktop && desktopDialog !== null}
        transparent
        animationType="none"
        onRequestClose={() => closeDialog()}
      >
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center' }]}
          onPress={() => closeDialog()}
        >
          <Pressable
            style={{ backgroundColor: '#1e293b', borderRadius: 16, padding: 24, width: 420, maxWidth: '90%', maxHeight: '80%' }}
            onPress={() => {}}
          >
            {desktopDialog === 'confirmDelete' && holdingMenuSymbol && (
              <>
                <Text style={{ color: '#f1f5f9', fontWeight: '700', fontSize: 16, marginBottom: 8 }}>
                  Remove {holdingMenuSymbol}?
                </Text>
                <Text style={{ color: '#94a3b8', fontSize: 14, marginBottom: 24, lineHeight: 20 }}>
                  All positions and transactions will be permanently lost.
                </Text>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <TouchableOpacity
                    style={{ flex: 1, padding: 12, backgroundColor: '#334155', borderRadius: 10, alignItems: 'center' }}
                    onPress={() => closeDialog()}
                  >
                    <Text style={{ color: '#94a3b8', fontWeight: '600', fontSize: 15 }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, padding: 12, backgroundColor: '#ef4444', borderRadius: 10, alignItems: 'center' }}
                    onPress={() => {
                      const sym = holdingMenuSymbol;
                      closeDialog();
                      if (sym) removeHolding(sym);
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
            {desktopDialog === 'viewTx' && holdingMenuSymbol && (() => {
              const symTxs = transactions
                .filter((t) => t.symbol === holdingMenuSymbol)
                .sort((a, b) => b.date.localeCompare(a.date));
              return (
                <>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <Text style={{ color: '#f1f5f9', fontWeight: '700', fontSize: 16 }}>
                      Transactions · {holdingMenuSymbol}
                    </Text>
                    <TouchableOpacity onPress={() => closeDialog()}>
                      <Ionicons name="close" size={20} color="#64748b" />
                    </TouchableOpacity>
                  </View>
                  <ScrollView showsVerticalScrollIndicator={false}>
                    {symTxs.length === 0 ? (
                      <Text style={{ color: '#64748b', textAlign: 'center', paddingVertical: 24 }}>No transactions recorded.</Text>
                    ) : symTxs.map((tx) => {
                      const txHolding = holdings.find((h) => h.symbol === tx.symbol);
                      const total = tx.shares * tx.price * getRateFor(txHolding?.currency ?? 'USD');
                      const isBuy = tx.type === 'buy';
                      return (
                        <View key={tx.id} style={styles.txRow}>
                          <View style={[styles.txBadge, { backgroundColor: isBuy ? '#16a34a22' : '#dc262622' }]}>
                            <Text style={[styles.txBadgeTxt, { color: isBuy ? '#22c55e' : '#ef4444' }]}>{isBuy ? 'C' : 'V'}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.txRowDate}>{new Date(tx.date).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })}</Text>
                            <Text style={styles.txRowDetail}>{tx.shares} ações · {tx.price.toFixed(2)} {currencySymbol}/ação</Text>
                          </View>
                          <Text style={[styles.txRowTotal, { color: isBuy ? '#22c55e' : '#ef4444' }]}>
                            {isBuy ? '+' : '-'}{total.toFixed(2)} {currencySymbol}
                          </Text>
                        </View>
                      );
                    })}
                  </ScrollView>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Mobile: bottom sheet */}
      {!isDesktop && holdingMenuSymbol !== null && (
        <Pressable
          style={styles.modalOverlay}
          onPress={() => dismissSheet()}
        >
          <Pressable style={styles.modalSheet} onPress={() => {}}
          >
            {/* Zona de drag */}
            <View style={styles.modalDragZone}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>{holdingMenuSymbol}</Text>
            </View>
            <View>
              {sheetView === "menu" && (
                <>
                  <TouchableOpacity
                    style={styles.modalOption}
                    onPress={() => {
                      if (isCombinedPortfolio) {
                        dismissSheet();
                        Alert.alert('Read-only', 'Select a specific portfolio before adding transactions.');
                        return;
                      }
                      const sym = holdingMenuSymbol;
                      dismissSheet(true);
                      setTimeout(() => {
                        if (sym) {
                          const holding = holdings.find(
                            (h) => h.symbol === sym,
                          );
                          setTxInitialPrice(
                            holding && quotes[sym]?.c != null
                              ? quotes[sym]!.c.toFixed(2)
                              : holding
                                ? holding.avgPrice.toFixed(2)
                                : "",
                          );
                          const nc = holding?.currency ?? "USD";
                          setTxNativeCurrencySymbol(
                            nc === "EUR"
                              ? "€"
                              : nc === "GBP"
                                ? "£"
                                : nc === "USD"
                                  ? "$"
                                  : nc,
                          );
                          setTabBarHidden(true);
                          setTxSymbol(sym);
                        }
                      }, 230);
                    }}
                  >
                    <Text style={styles.modalOptionText}>
                      Add transaction
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.modalOption}
                    onPress={() => setSheetView("viewTx")}
                  >
                    <Text style={styles.modalOptionText}>
                      View transactions
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.modalOption}
                    onPress={() => {
                      if (isCombinedPortfolio) {
                        dismissSheet();
                        Alert.alert('Read-only', 'Select a specific portfolio before deleting positions.');
                        return;
                      }
                      setSheetView("confirmDelete");
                    }}
                  >
                    <Text
                      style={[styles.modalOptionText, { color: "#ef4444" }]}
                    >
                      Delete
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              {sheetView === "confirmDelete" && (
                <View style={{ paddingTop: 8, paddingBottom: 8 }}>
                  <Text
                    style={[
                      styles.modalTitle,
                      {
                        textAlign: "left",
                        marginBottom: 8,
                        fontSize: 15,
                        color: "#f1f5f9",
                      },
                    ]}
                  >
                    Are you sure?
                  </Text>
                  <Text
                    style={{
                      color: "#94a3b8",
                      fontSize: 14,
                      marginBottom: 24,
                      lineHeight: 21,
                    }}
                  >
                    You are about to remove{" "}
                    <Text style={{ color: "#f1f5f9", fontWeight: "700" }}>
                      {holdingMenuSymbol}
                    </Text>{" "}
                    from the portfolio. This action cannot be undone.
                  </Text>
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <TouchableOpacity
                      style={{
                        flex: 1,
                        padding: 14,
                        backgroundColor: "#334155",
                        borderRadius: 10,
                        alignItems: "center",
                      }}
                      onPress={() => setSheetView("menu")}
                    >
                      <Text
                        style={{
                          color: "#94a3b8",
                          fontWeight: "600",
                          fontSize: 15,
                        }}
                      >
                        Cancel
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{
                        flex: 1,
                        padding: 14,
                        backgroundColor: "#ef4444",
                        borderRadius: 10,
                        alignItems: "center",
                      }}
                      onPress={() => {
                        const sym = holdingMenuSymbol;
                        dismissSheet();
                        if (isCombinedPortfolio) {
                          Alert.alert('Read-only', 'Select a specific portfolio before deleting positions.');
                          return;
                        }
                        if (sym) removeHolding(sym);
                      }}
                    >
                      <Text
                        style={{
                          color: "#fff",
                          fontWeight: "700",
                          fontSize: 15,
                        }}
                      >
                        Delete
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {sheetView === "viewTx" &&
                (() => {
                  const symTxs = transactions
                    .filter((t) => t.symbol === holdingMenuSymbol)
                    .sort((a, b) => b.date.localeCompare(a.date));
                  return (
                    <>
                      <TouchableOpacity
                        onPress={() => setSheetView("menu")}
                        style={{ paddingBottom: 12 }}
                      >
                        <Text style={{ color: "#6366f1", fontSize: 14 }}>
                          ← Back
                        </Text>
                      </TouchableOpacity>
                      <ScrollView style={{ maxHeight: 340 }}>
                        {symTxs.length === 0 ? (
                          <Text
                            style={{
                              color: "#64748b",
                              textAlign: "center",
                              paddingVertical: 24,
                            }}
                          >
                            No transactions recorded.
                          </Text>
                        ) : (
                          symTxs.map((tx) => {
                            const txHolding = holdings.find(
                              (h) => h.symbol === tx.symbol,
                            );
                            const total =
                              tx.shares *
                              tx.price *
                              getRateFor(txHolding?.currency ?? "USD");
                            const isBuy = tx.type === "buy";
                            return (
                              <View key={tx.id} style={styles.txRow}>
                                <View
                                  style={[
                                    styles.txBadge,
                                    {
                                      backgroundColor: isBuy
                                        ? "#16a34a22"
                                        : "#dc262622",
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.txBadgeTxt,
                                      { color: isBuy ? "#22c55e" : "#ef4444" },
                                    ]}
                                  >
                                    {isBuy ? "C" : "V"}
                                  </Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.txRowDate}>
                                    {new Date(tx.date).toLocaleDateString(
                                      "pt-PT",
                                      {
                                        day: "2-digit",
                                        month: "short",
                                        year: "numeric",
                                      },
                                    )}
                                  </Text>
                                  <Text style={styles.txRowDetail}>
                                    {tx.shares} ações · {tx.price.toFixed(2)}{" "}
                                    {currencySymbol}/ação
                                  </Text>
                                </View>
                                <Text
                                  style={[
                                    styles.txRowTotal,
                                    { color: isBuy ? "#22c55e" : "#ef4444" },
                                  ]}
                                >
                                  {isBuy ? "+" : "-"}
                                  {total.toFixed(2)} {currencySymbol}
                                </Text>
                              </View>
                            );
                          })
                        )}
                      </ScrollView>
                    </>
                  );
                })()}
            </View>
          </Pressable>
        </Pressable>
      )}

      {/* Modal de filtro de posições */}
      <Modal
        visible={filterVisible}
        transparent
        animationType={isDesktop ? 'none' : 'slide'}
        onRequestClose={() => setFilterVisible(false)}
      >
        {isDesktop ? (
          // Desktop: backdrop transparente + popover posicionado
          <Pressable style={{ flex: 1 }} onPress={() => setFilterVisible(false)}>
            <Pressable
              style={[
                {
                  position: 'absolute',
                  right: filterPopoverPos.right,
                  backgroundColor: '#1e293b',
                  borderRadius: 12,
                  paddingTop: 8,
                  paddingBottom: 8,
                  paddingHorizontal: 12,
                  minWidth: 230,
                  shadowColor: '#000',
                  shadowOpacity: 0.5,
                  shadowRadius: 20,
                  shadowOffset: { width: 0, height: 6 },
                },
                filterPopoverPos.top !== undefined ? { top: filterPopoverPos.top } : {},
                filterPopoverPos.bottom !== undefined ? { bottom: filterPopoverPos.bottom } : {},
              ]}
              onPress={() => {}}
            >
              <ScrollView
                style={{ maxHeight: filterPopoverPos.maxHeight }}
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.filterSection}>Timespan</Text>
                {([
                  ['since_buy', 'Since buy'],
                  ['year', 'Year'],
                  ['ytd', 'Year-to-date'],
                  ['month', 'Month'],
                  ['week', 'Week'],
                  ['daily', 'Daily trend'],
                ] as [typeof timespan, string][]).map(([key, label]) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.filterRow, { borderBottomColor: '#334155' }]}
                    onPress={() => { setTimespan(key); setFilterVisible(false); }}
                  >
                    <Text style={styles.filterRowTxt}>{label}</Text>
                    <View style={[styles.radioOuter, timespan === key && styles.radioOuterActive]}>
                      {timespan === key && <View style={styles.radioInner} />}
                    </View>
                  </TouchableOpacity>
                ))}
                <Text style={[styles.filterSection, { marginTop: 12 }]}>Sorting</Text>
                {([
                  ['relative', '%', 'Relative return'],
                  ['absolute', '$', 'Absolute return'],
                  ['position', '≡', 'Position size'],
                ] as [typeof sortBy, string, string][]).map(([key, icon, label]) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.filterRow, { borderBottomColor: '#334155' }]}
                    onPress={() => { setSortBy(key); setFilterVisible(false); }}
                  >
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
          // Mobile: bottom sheet
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setFilterVisible(false)}
          >
            <Pressable style={styles.modalSheet}>
              <View style={styles.modalHandle} />

              <Text style={styles.filterSection}>Timespan</Text>
              {(
                [
                  ['since_buy', 'Since buy'],
                  ['year', 'Year'],
                  ['ytd', 'Year-to-date'],
                  ['month', 'Month'],
                  ['week', 'Week'],
                  ['daily', 'Daily trend'],
                ] as [typeof timespan, string][]
              ).map(([key, label]) => (
                <TouchableOpacity
                  key={key}
                  style={styles.filterRow}
                  onPress={() => {
                    setTimespan(key);
                    setFilterVisible(false);
                  }}
                >
                  <Text style={styles.filterRowTxt}>{label}</Text>
                  <View
                    style={[
                      styles.radioOuter,
                      timespan === key && styles.radioOuterActive,
                    ]}
                  >
                    {timespan === key && <View style={styles.radioInner} />}
                  </View>
                </TouchableOpacity>
              ))}

              <Text style={[styles.filterSection, { marginTop: 20 }]}>
                Sorting
              </Text>
              {(
                [
                  ['relative', '%', 'Relative return'],
                  ['absolute', '$', 'Absolute return'],
                  ['position', '≡', 'Position size'],
                ] as [typeof sortBy, string, string][]
              ).map(([key, icon, label]) => (
                <TouchableOpacity
                  key={key}
                  style={styles.filterRow}
                  onPress={() => {
                    setSortBy(key);
                    setFilterVisible(false);
                  }}
                >
                  <Text style={styles.filterRowIcon}>{icon}</Text>
                  <Text style={styles.filterRowTxt}>{label}</Text>
                  <View
                    style={[
                      styles.radioOuter,
                      sortBy === key && styles.radioOuterActive,
                    ]}
                  >
                    {sortBy === key && <View style={styles.radioInner} />}
                  </View>
                </TouchableOpacity>
              ))}
            </Pressable>
          </Pressable>
        )}
      </Modal>

      {/* Modal de adicionar transação */}
      <Modal
        visible={txSymbol !== null}
        transparent
        animationType="none"
        onRequestClose={() => { setTabBarHidden(false); setTxSymbol(null); }}
      >
        {txSymbol !== null && (
          <AddTransactionModal
            symbol={txSymbol}
            initialPrice={txInitialPrice}
            nativeCurrencySymbol={txNativeCurrencySymbol}
            onClose={() => {
              setTabBarHidden(false);
              setTxSymbol(null);
            }}
          />
        )}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  heroSection: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8 },
  heroLabel: { color: "#8f99aa", fontSize: 16, marginBottom: 4 },
  heroValue: {
    color: "#f8fafc",
    fontSize: 36,
    fontWeight: "bold",
    letterSpacing: -1,
  },
  heroGain: { fontSize: 15, fontWeight: "600", marginTop: 4 },
  periodRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  periodBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  periodBtnActive: { backgroundColor: "#1e293b" },
  periodText: { color: "#64748b", fontSize: 13, fontWeight: "600" },
  periodTextActive: { color: "#f8fafc" },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  sectionTitle: { color: "#f8fafc", fontSize: 17, fontWeight: "bold" },
  filterBtnTxt: { color: "#94a3b8", fontSize: 13, fontWeight: "600" },
  filterSection: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
    marginTop: 12,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#0f172a",
  },
  filterRowIcon: {
    color: "#94a3b8",
    fontSize: 15,
    width: 22,
    fontWeight: "700",
  },
  filterRowTxt: { flex: 1, color: "#f8fafc", fontSize: 15 },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#475569",
    justifyContent: "center",
    alignItems: "center",
  },
  radioOuterActive: { borderColor: "#6366f1" },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#6366f1",
  },
  holdingCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  holdingLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  tickerBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#1e293b",
    justifyContent: "center",
    alignItems: "center",
  },
  logoImg: { width: 42, height: 42, borderRadius: 10, backgroundColor: '#1e293b' },
  tickerText: { color: "#6366f1", fontWeight: "bold", fontSize: 13 },
  holdingSymbol: { color: "#f8fafc", fontWeight: "700", fontSize: 15 },
  holdingName: { color: "#8f99aa", fontSize: 12, maxWidth: 160 },
  holdingDate: { color: "#8f99aa", fontSize: 11, marginTop: 2 },
  holdingRight: { alignItems: "flex-end" },
  holdingValue: { color: "#f8fafc", fontWeight: "700", fontSize: 15 },
  holdingGain: { fontSize: 12, marginTop: 2 },
  marketBadge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  marketBadgePre: { backgroundColor: '#431407' },
  marketBadgePost: { backgroundColor: '#1e3a5f' },
  marketBadgeRegular: { backgroundColor: '#14532d' },
  marketBadgeClosed: { backgroundColor: '#1e293b' },
  marketBadgeTxt: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  deleteAction: {
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
    width: 90,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  deleteActionText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  menuAction: {
    backgroundColor: "#334155",
    justifyContent: "center",
    alignItems: "center",
    width: 70,
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  menuActionText: {
    color: "#f8fafc",
    fontWeight: "900",
    fontSize: 18,
    letterSpacing: 2,
  },
  kebabBtn: {
    padding: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popoverItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  popoverItemText: {
    color: '#f1f5f9',
    fontSize: 14,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
    zIndex: 220,
    elevation: 120,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalSheet: {
    backgroundColor: "#1e293b",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#475569",
    alignSelf: "center",
    marginBottom: 8,
  },
  modalDragZone: {
    width: "100%",
    paddingTop: 12,
    paddingBottom: 4,
  },
  modalTitle: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  modalOption: {
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: "#0f172a",
  },
  modalOptionDanger: {},
  modalOptionText: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "500",
    textAlign: "center",
  },
  empty: {
    color: "#64748b",
    textAlign: "center",
    marginTop: 40,
    fontSize: 15,
    lineHeight: 24,
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#0f172a",
  },
  txBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  txBadgeTxt: { fontWeight: "800", fontSize: 14 },
  txRowDate: { color: "#f8fafc", fontSize: 14, fontWeight: "600" },
  txRowDetail: { color: "#64748b", fontSize: 12, marginTop: 2 },
  txRowTotal: { fontSize: 14, fontWeight: "700" },
});
