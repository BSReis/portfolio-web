import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// On web (browser), all requests are routed through Next.js API proxy routes to bypass CORS.
const yahoo1 = axios.create({ baseURL: '/api/yahoo1' });
const yahoo2 = axios.create({ baseURL: '/api/yahoo2' });

// ── In-memory cache ────────────────────────────────────────────────────────────
interface CacheEntry<T> { value: T; expiresAt: number; }
const _cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const entry = _cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return undefined; }
  return entry.value;
}
function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  _cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}
export function clearCache(symbol?: string): void {
  if (symbol) {
    for (const key of _cache.keys()) { if (key.startsWith(symbol + ':')) _cache.delete(key); }
  } else {
    _cache.clear();
  }
}

// ── Persistent cache (AsyncStorage) — survives app restarts ───────────────────
const PCACHE_PREFIX = '@api_cache:';
const TTL_24H = 24 * 60 * 60_000;

async function persistGet<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await AsyncStorage.getItem(PCACHE_PREFIX + key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() > entry.expiresAt) { AsyncStorage.removeItem(PCACHE_PREFIX + key); return undefined; }
    return entry.value;
  } catch { return undefined; }
}

async function persistSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
  try {
    await AsyncStorage.setItem(PCACHE_PREFIX + key, JSON.stringify({ value, expiresAt: Date.now() + ttlMs }));
  } catch { /* ignore storage errors */ }
}
// ──────────────────────────────────────────────────────────────────────────────

const TTL = {
  fundamentals:    TTL_24H,
  historical:      TTL_24H,
  financials:      TTL_24H,
  analyst:         TTL_24H,
  dividendHistory: TTL_24H,
  earnings:        TTL_24H,
  insider:         TTL_24H,
};
// ──────────────────────────────────────────────────────────────────────────────

// Taxa de câmbio entre duas moedas (ex: USD → EUR)
export const getExchangeRate = async (from: string, to: string): Promise<number> => {
  const { data } = await yahoo1.get(`/v8/finance/chart/${from}${to}=X`, {
    params: { interval: '1d', range: '1d' },
  });
  const meta = data?.chart?.result?.[0]?.meta;
  return (meta?.regularMarketPrice as number) ?? 1;
};

export interface StockQuote {
  c: number;
  pc: number;
  symbol: string;
  currency: string;      // e.g. 'USD', 'EUR', 'DKK'
  quoteType?: string;    // e.g. 'EQUITY', 'ETF'
  dayHigh?: number;
  dayLow?: number;
  firstTradeDate?: number; // unix seconds — use as inception date for ETFs
  longName?: string;
  marketState?: 'PRE' | 'REGULAR' | 'POST' | 'POSTPOST' | 'PREPRE' | 'CLOSED';
  preMarketPrice?: number;
  postMarketPrice?: number;
  exchangeTimezone?: string; // e.g. "America/New_York", "Europe/Berlin"
}

function normalizeYahooCurrency(currency?: string): { currency: string; unitDivisor: number } {
  const raw = (currency ?? 'USD').trim();
  const upper = raw.toUpperCase();
  if (raw === 'GBp' || upper === 'GBX') {
    return { currency: 'GBP', unitDivisor: 100 };
  }
  return { currency: upper, unitDivisor: 1 };
}

function normalizeYahooPrice(value: number | undefined, unitDivisor: number): number | undefined {
  return typeof value === 'number' ? value / unitDivisor : undefined;
}

/**
 * Returns the most up-to-date price for a quote:
 * - PRE  → preMarketPrice  (falls back to c)
 * - POST / POSTPOST → postMarketPrice (falls back to c)
 * - everything else → c (regular market)
 */
export function effectivePrice(quote: StockQuote): number {
  if (quote.marketState === 'PRE' && quote.preMarketPrice != null)
    return quote.preMarketPrice;
  if ((quote.marketState === 'POST' || quote.marketState === 'POSTPOST') && quote.postMarketPrice != null)
    return quote.postMarketPrice;
  return quote.c;
}

export interface StockSearchResult {
  symbol: string;
  description: string;
  type: string;
  currency: string;  // native currency (e.g. 'USD', 'EUR', 'DKK')
  exchange: string;  // exchange display name (e.g. 'NYSE', 'Copenhagen')
}

export interface Dividend {
  amount: number;
  date: number;
}

// Preço atual de uma ação (ex: 'AAPL')
const QUOTE_TTL = 5 * 60_000; // 5 minutes
// In-flight dedup: if the same symbol is already being fetched, reuse the promise
const _quotePending = new Map<string, Promise<StockQuote | null>>();

export const getStockQuote = async (symbol: string): Promise<StockQuote | null> => {
  const cacheKey = `quote:${symbol}`;
  const cached = cacheGet<StockQuote | null>(cacheKey);
  if (cached !== undefined) return cached;
  // Deduplicate concurrent requests for the same symbol
  const pending = _quotePending.get(symbol);
  if (pending) return pending;
  const promise = (async () => {
  try {
    const { data } = await yahoo1.get(`/v8/finance/chart/${symbol}`, {
      params: { interval: '2m', range: '1d', includePrePost: true },
    });
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    if (meta?.regularMarketPrice) {
      const { currency: normalizedCurrency, unitDivisor } = normalizeYahooCurrency(meta.currency as string | undefined);
      // ---- Determine market state from currentTradingPeriod ----
      const now = Date.now() / 1000;
      const ctp = meta.currentTradingPeriod;
      let marketState: StockQuote['marketState'] = 'CLOSED';
      if (ctp) {
        if (now >= ctp.pre?.start && now < ctp.pre?.end) marketState = 'PRE';
        else if (now >= ctp.regular?.start && now < ctp.regular?.end) marketState = 'REGULAR';
        else if (now >= ctp.post?.start && now < ctp.post?.end) marketState = 'POST';
      }

      // ---- Extract last candle price within a time window ----
      const timestamps: number[] = result?.timestamp ?? [];
      const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
      const lastInWindow = (start: number, end: number): number | undefined => {
        for (let i = timestamps.length - 1; i >= 0; i--) {
          if (timestamps[i] >= start && timestamps[i] < end && closes[i] != null)
            return closes[i] as number;
        }
        return undefined;
      };

      const preMarketPrice = ctp?.pre
        ? normalizeYahooPrice(lastInWindow(ctp.pre.start, ctp.pre.end), unitDivisor)
        : undefined;
      const postMarketPrice = ctp?.post
        ? normalizeYahooPrice(lastInWindow(ctp.post.start, ctp.post.end), unitDivisor)
        : undefined;

      return {
        c: normalizeYahooPrice(meta.regularMarketPrice as number, unitDivisor) ?? 0,
        pc: normalizeYahooPrice((meta.chartPreviousClose ?? meta.previousClose) as number | undefined, unitDivisor) ?? 0,
        symbol: meta.symbol as string,
        currency: normalizedCurrency,
        quoteType: (meta.instrumentType ?? meta.quoteType) as string | undefined,
        dayHigh: normalizeYahooPrice(meta.regularMarketDayHigh as number | undefined, unitDivisor),
        dayLow: normalizeYahooPrice(meta.regularMarketDayLow as number | undefined, unitDivisor),
        firstTradeDate: meta.firstTradeDate as number | undefined,
        longName: (meta.longName ?? meta.shortName) as string | undefined,
        marketState,
        preMarketPrice,
        postMarketPrice,
        exchangeTimezone: meta.exchangeTimezoneName as string | undefined,
      };
    }
  } catch { /* fallthrough */ }

  // Fallback: Finnhub quote (real-time para US stocks)
  try {
    const { data } = await fh.get('/quote', { params: { symbol, token: FH_KEY } });
    if (data?.c > 0) {
      return { c: data.c as number, pc: data.pc as number, symbol, currency: 'USD' };
    }
  } catch { /* ignore */ }

  return null;
  })().then((result) => {
    cacheSet(cacheKey, result, QUOTE_TTL);
    return result;
  });
  _quotePending.set(symbol, promise);
  promise.finally(() => _quotePending.delete(symbol));
  return promise;
};

// Preço em tempo real via Finnhub (US stocks) — para página de detalhe
export const getStockQuoteFinnhub = async (symbol: string): Promise<StockQuote | null> => {
  try {
    const { data } = await fh.get('/quote', { params: { symbol, token: FH_KEY } });
    if (data?.c > 0) {
      return { c: data.c as number, pc: data.pc as number, symbol, currency: 'USD' };
    }
  } catch { /* ignore */ }
  // Fallback para Yahoo se Finnhub não tiver dados (ex: stocks internacionais)
  return getStockQuote(symbol);
};

// Yahoo Finance exchange code → ISO currency code
// (the search endpoint never returns a currency field, so we derive it)
const EXCHANGE_CURRENCY: Record<string, string> = {
  // US
  NYQ: 'USD', NMS: 'USD', NGM: 'USD', NCM: 'USD', BTS: 'USD', PCX: 'USD',
  // Europe — EUR
  GER: 'EUR', FRA: 'EUR', HAM: 'EUR', HAN: 'EUR', BER: 'EUR', MUN: 'EUR',
  PAR: 'EUR', AMS: 'EUR', BRU: 'EUR', LIS: 'EUR', MAD: 'EUR', MCE: 'EUR',
  MIL: 'EUR', EBS: 'EUR', VIE: 'EUR', ATH: 'EUR', HEL: 'EUR',
  // Scandinavia
  CPH: 'DKK', STO: 'SEK', OSL: 'NOK',
  // UK
  LSE: 'GBP', IOB: 'GBP',
  // Switzerland
  SWX: 'CHF',
  // Canada
  TOR: 'CAD', VAN: 'CAD',
  // Australia
  ASX: 'AUD',
  // Hong Kong
  HKG: 'HKD',
  // Japan
  TYO: 'JPY', OSA: 'JPY',
  // China
  SHA: 'CNY', SHZ: 'CNY',
  // India
  BOM: 'INR', NSI: 'INR',
  // Brazil
  SAO: 'BRL',
  // Mexico
  MEX: 'MXN',
  // Singapore
  SGX: 'SGD',
  // South Korea
  KSC: 'KRW', KOE: 'KRW',
};

// Pesquisar ações por nome ou símbolo
export const searchStocks = async (query: string): Promise<StockSearchResult[]> => {
  const { data } = await yahoo1.get('/v1/finance/search', {
    params: { q: query, quotesCount: 20, newsCount: 0, listsCount: 0 },
  });
  return ((data?.quotes ?? []) as Record<string, string>[])
    .filter((q) => q.quoteType === 'EQUITY' || q.quoteType === 'ETF')
    .map((q) => {
      const exchCode = (q.exchange ?? '').toUpperCase();
      const currency = EXCHANGE_CURRENCY[exchCode] ?? 'USD';
      return {
        symbol: q.symbol,
        description: q.longname ?? q.shortname ?? q.symbol,
        type: q.quoteType,
        currency,
        exchange: q.exchDisp ?? q.exchange ?? '',
      };
    });
};

export interface HistoricalData {
  prices: number[];
  timestamps: number[]; // unix seconds
}

export interface CandleData {
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  timestamps: number[];
}

// Dados históricos para o gráfico
export const getHistoricalData = async (
  symbol: string,
  range = '1mo',
  interval = '1d'
): Promise<HistoricalData> => {
  const key = `${symbol}:hist:${range}:${interval}`;
  const isIntraday = interval.endsWith('m') || interval === '1h' || interval === '2h';
  const intradayTtl = 5 * 60_000;

  // For intraday: evict stale cache entries created with the old 24h TTL.
  // Any entry with more than intradayTtl remaining was cached under the old rules.
  if (isIntraday) {
    const existing = _cache.get(key) as CacheEntry<unknown> | undefined;
    if (existing && (existing.expiresAt - Date.now()) > intradayTtl) {
      _cache.delete(key);
    }
  }

  // 1. in-memory
  const mem = cacheGet<HistoricalData>(key);
  if (mem !== undefined) return mem;
  // 2. persistent — only cache daily/weekly/monthly intervals (not intraday)
  if (!isIntraday) {
    const persisted = await persistGet<HistoricalData>(key);
    // Only use cache if it has actual data — empty cached results get re-fetched
    if (persisted !== undefined && persisted.prices.length > 0) { cacheSet(key, persisted, TTL.historical); return persisted; }
  }
  // 3. fetch
  const params: Record<string, string | number | boolean> =
    range === 'max'
      ? { interval, period1: 946684800, period2: Math.floor(Date.now() / 1000) }
      : { interval, range };
  // Intraday intervals: include pre/post market candles
  if (isIntraday) params.includePrePost = true;
  const { data } = await yahoo2.get(`/v8/finance/chart/${symbol}`, {
    params,
  });
  const result = data?.chart?.result?.[0];
  if (!result) return { prices: [], timestamps: [] };
  const { unitDivisor } = normalizeYahooCurrency(result?.meta?.currency as string | undefined);
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
  const ts: (number | null)[] = result.timestamp ?? [];
  const prices: number[] = [];
  const timestamps: number[] = [];
  closes.forEach((c, i) => {
    if (c !== null && ts[i] !== null) {
      prices.push((normalizeYahooPrice(c, unitDivisor) ?? c) as number);
      timestamps.push(ts[i] as number);
    }
  });
  const result2: HistoricalData = { prices, timestamps };
  // Intraday bars expire in 5 minutes so the chart stays fresh.
  // Daily/weekly/monthly bars can be cached for 24 hours.
  const cacheTtl = isIntraday ? 5 * 60_000 : TTL.historical;
  cacheSet(key, result2, cacheTtl);
  if (!isIntraday) persistSet(key, result2, TTL.historical);
  return result2;
};

// Dados históricos desde uma data de compra específica
export const getCandleData = async (
  symbol: string,
  range = '1mo',
  interval = '1d'
): Promise<CandleData> => {
  const params: Record<string, string | number | boolean> =
    range === 'max'
      ? { interval, period1: 946684800, period2: Math.floor(Date.now() / 1000) }
      : { interval, range };
  const { data } = await yahoo2.get(`/v8/finance/chart/${symbol}`, { params });
  const result = data?.chart?.result?.[0];
  if (!result) return { open: [], high: [], low: [], close: [], timestamps: [] };
  const { unitDivisor } = normalizeYahooCurrency(result?.meta?.currency as string | undefined);
  const q = result.indicators?.quote?.[0] ?? {};
  const opens: (number | null)[] = q.open ?? [];
  const highs: (number | null)[] = q.high ?? [];
  const lows: (number | null)[] = q.low ?? [];
  const closes: (number | null)[] = q.close ?? [];
  const ts: (number | null)[] = result.timestamp ?? [];
  const open: number[] = [], high: number[] = [], low: number[] = [], close: number[] = [], timestamps: number[] = [];
  closes.forEach((c, i) => {
    if (c != null && ts[i] != null && opens[i] != null && highs[i] != null && lows[i] != null) {
      open.push((normalizeYahooPrice(opens[i] as number, unitDivisor) ?? opens[i]) as number);
      high.push((normalizeYahooPrice(highs[i] as number, unitDivisor) ?? highs[i]) as number);
      low.push((normalizeYahooPrice(lows[i] as number, unitDivisor) ?? lows[i]) as number);
      close.push((normalizeYahooPrice(c, unitDivisor) ?? c) as number);
      timestamps.push(ts[i] as number);
    }
  });
  return { open, high, low, close, timestamps };
};

const _divsInFlight = new Map<string, Promise<Dividend[]>>();
export const getDividends = async (symbol: string): Promise<Dividend[]> => {
  const cacheKey = `divs:${symbol}`;
  const cached = cacheGet<Dividend[]>(cacheKey);
  if (cached !== undefined) return cached;
  // Return the same in-flight promise if one is already running for this symbol
  const inflight = _divsInFlight.get(cacheKey);
  if (inflight) return inflight;
  const promise = (async () => {
    const now = Math.floor(Date.now() / 1000);
    try {
      const { data } = await yahoo2.get(`/v8/finance/chart/${symbol}`, {
        params: { interval: '1d', period1: 0, period2: now, events: 'div' },
      });
      const events: Record<string, Dividend> | undefined =
        data?.chart?.result?.[0]?.events?.dividends;
      const result = events ? Object.values(events).sort((a, b) => b.date - a.date) : [];
      cacheSet(cacheKey, result, TTL_24H);
      return result;
    } catch {
      return [];
    } finally {
      _divsInFlight.delete(cacheKey);
    }
  })();
  _divsInFlight.set(cacheKey, promise);
  return promise;
};

export interface DividendHistoryEntry {
  exDate: number;      // unix seconds
  payDate: number | null;
  amount: number;
}

/** Historical dividends with ex-date + pay date — Nasdaq primary, Finnhub preferred, FMP fallback, Yahoo last resort */
export const getDividendHistory = async (symbol: string): Promise<DividendHistoryEntry[]> => {
  const cacheKey = `${symbol}:dividendHistory:v8`;
  const hasUsablePayDates = (entries: DividendHistoryEntry[]): boolean => entries.some((d) => d.payDate != null);
  const mem = cacheGet<DividendHistoryEntry[]>(cacheKey);
  if (mem !== undefined) {
    if (hasUsablePayDates(mem) || (!FH_KEY && !FMP_KEY)) return mem;
  }
  const persisted = await persistGet<DividendHistoryEntry[]>(cacheKey);
  if (persisted !== undefined) {
    if (hasUsablePayDates(persisted) || (!FH_KEY && !FMP_KEY)) {
      cacheSet(cacheKey, persisted, TTL.dividendHistory);
      return persisted;
    }
  }
  const parseNasdaqDate = (s: string): number | null => {
    // Format: "MM/DD/YYYY"
    if (!s || s === 'N/A') return null;
    const [m, day, y] = s.split('/');
    const ts = Math.floor(new Date(`${y}-${m}-${day}`).getTime() / 1000);
    return isNaN(ts) ? null : ts;
  };

  // 1. Nasdaq public API — free, no key, has paymentDate
  for (const assetclass of ['stocks', 'etf']) {
    try {
      const { data } = await axios.get(
        `https://api.nasdaq.com/api/quote/${symbol}/dividends`,
        {
          params: { assetclass },
          headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36' },
        },
      );
      const rows: { exOrEffDate: string; paymentDate: string; amount: string; type: string }[] =
        data?.data?.dividends?.rows ?? [];
      if (rows.length > 0) {
        const result = rows
          .filter(r => r.type === 'Cash' || r.type === 'Cash Dividend')
          .map(r => ({
            exDate: parseNasdaqDate(r.exOrEffDate) ?? 0,
            payDate: parseNasdaqDate(r.paymentDate),
            amount: parseFloat(r.amount.replace(/[$,]/g, '')) || 0,
          }))
          .filter(d => d.exDate > 0 && d.amount > 0)
          .sort((a, b) => b.exDate - a.exDate);
        if (result.length > 0) {
          cacheSet(cacheKey, result, TTL.dividendHistory);
          persistSet(cacheKey, result, TTL.dividendHistory);
          return result;
        }
      }
    } catch { /* try next source */ }
  }

  // 2. Finnhub /stock/dividend2
  if (FH_KEY) {
    try {
      const now = new Date();
      // Request one extra base year so 10Y growth can compare against a full prior year.
      const from = new Date(now.getFullYear() - 11, 0, 1).toISOString().slice(0, 10);
      const to = now.toISOString().slice(0, 10);
      const { data } = await fh.get('/stock/dividend2', {
        params: { symbol, from, to, token: FH_KEY },
      });
      const list: { exDate?: string; date?: string; paymentDate?: string; payDate?: string; amount: number }[] = data?.data ?? [];
      const result = list
        .filter(d => d.amount > 0 && (d.exDate || d.date))
        .map(d => {
          const ex = d.exDate || d.date || '';
          const pay = d.paymentDate || d.payDate || null;
          return {
            exDate: Math.floor(new Date(ex).getTime() / 1000),
            payDate: pay ? Math.floor(new Date(pay).getTime() / 1000) : null,
            amount: d.amount,
          };
        })
        .filter(d => !isNaN(d.exDate))
        .sort((a, b) => b.exDate - a.exDate);
      const hasUsefulPayDates = result.some((d) => d.payDate != null);
      if (result.length > 0 && hasUsefulPayDates) {
        cacheSet(cacheKey, result, TTL.dividendHistory);
        persistSet(cacheKey, result, TTL.dividendHistory);
        return result;
      }
    } catch { /* fallthrough */ }
  }

  // 3. FMP /dividends — fallback when Finnhub is unavailable or incomplete
  if (FMP_KEY) {
    try {
      const { data } = await fmp.get('/stable/dividends', {
        params: { symbol, apikey: FMP_KEY },
      });
      const list: { date?: string; paymentDate?: string; dividend?: number; adjDividend?: number }[] = Array.isArray(data) ? data : [];
      const result = list
        .map((d) => ({
          exDate: d.date ? Math.floor(new Date(d.date).getTime() / 1000) : NaN,
          payDate: d.paymentDate ? Math.floor(new Date(d.paymentDate).getTime() / 1000) : null,
          amount: d.dividend ?? d.adjDividend ?? 0,
        }))
        .filter((d) => !isNaN(d.exDate) && d.amount > 0)
        .sort((a, b) => b.exDate - a.exDate);
      if (result.length > 0) {
        cacheSet(cacheKey, result, TTL.dividendHistory);
        persistSet(cacheKey, result, TTL.dividendHistory);
        return result;
      }
    } catch { /* fallthrough */ }
  }

  // 4. Yahoo fallback — no payDate available
  const divs = await getDividends(symbol);
  const fallback = divs.map(d => ({ exDate: d.date, payDate: null, amount: d.amount }));
  cacheSet(cacheKey, fallback, TTL.dividendHistory);
  persistSet(cacheKey, fallback, TTL.dividendHistory);
  return fallback;
};

// Announced (declared) dividends from Finnhub calendar — next 90 days
const _declaredInFlight = new Map<string, Promise<{ amount: number; date: number }[]>>();
export const getDeclaredDividends = async (symbol: string): Promise<{ amount: number; date: number }[]> => {
  if (!FH_KEY) return [];
  const cacheKey = `declared:${symbol}`;
  const cached = cacheGet<{ amount: number; date: number }[]>(cacheKey);
  if (cached !== undefined) return cached;
  const inflight = _declaredInFlight.get(cacheKey);
  if (inflight) return inflight;
  const promise = (async () => {
    try {
      const now = new Date();
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const from = fmt(now);
      const to = fmt(new Date(now.getTime() + 90 * 24 * 3600 * 1000));
      const { data } = await fh.get('/calendar/dividend', {
        params: { symbol, from, to, token: FH_KEY },
      });
      const list: { amount: number; paymentDate: string; date: string }[] = data?.data ?? [];
      const result = list
        .filter((d) => d.amount > 0 && (d.paymentDate || d.date))
        .map((d) => ({
          amount: d.amount,
          date: Math.floor(new Date(d.paymentDate || d.date).getTime() / 1000),
        }))
        .filter((d) => !isNaN(d.date));
      cacheSet(cacheKey, result, 5 * 60_000); // 5-min cache
      return result;
    } catch {
      return [];
    } finally {
      _declaredInFlight.delete(cacheKey);
    }
  })();
  _declaredInFlight.set(cacheKey, promise);
  return promise;
};

export const getStockMeta = async (symbol: string): Promise<{ cap: number | null; sector: string | null }> => {
  try {
    const { data } = await fh.get('/stock/profile2', {
      params: { symbol, token: FH_KEY },
    });
    const capMillions = data?.marketCapitalization;
    const cap = typeof capMillions === 'number' && capMillions > 0 ? capMillions * 1e6 : null;
    const sector = (typeof data?.finnhubIndustry === 'string' && data.finnhubIndustry) ? data.finnhubIndustry as string : null;
    return { cap, sector };
  } catch {
    return { cap: null, sector: null };
  }
};

export const getStockLogo = async (symbol: string): Promise<string | null> => {
  const cacheKey = `logo:${symbol}`;
  // 1. in-memory logo cache
  const mem = cacheGet<string | null>(cacheKey);
  if (mem !== undefined) return mem;
  // 2. persistent logo cache
  const persisted = await persistGet<string | null>(cacheKey);
  if (persisted !== undefined) { cacheSet(cacheKey, persisted, TTL_24H); return persisted; }
  // 3. reuse fundamentals cache if already fetched — avoids duplicate /stable/profile call
  const fundKey = `${symbol}:fundamentals`;
  const fundMem = cacheGet<Fundamentals | null>(fundKey);
  const fundPersisted = fundMem !== undefined ? fundMem : await persistGet<Fundamentals | null>(fundKey);
  if (fundPersisted?.logoUrl) {
    cacheSet(cacheKey, fundPersisted.logoUrl, TTL_24H);
    persistSet(cacheKey, fundPersisted.logoUrl, TTL_24H);
    return fundPersisted.logoUrl;
  }
  // 4. fetch — only Finnhub (FMP profile will be fetched by getFundamentals when needed)
  try {
    const base = symbol.includes('.') ? symbol.split('.')[0] : symbol;
    const fhRes = await fh.get('/stock/profile2', { params: { symbol: base, token: FH_KEY } }).catch(() => ({ data: {} }));
    const fhLogo = typeof fhRes.data?.logo === 'string' && fhRes.data.logo ? fhRes.data.logo as string : null;
    // Fallback: FMP CDN URL works for most symbols including ETFs
    const result = fhLogo ?? `https://images.financialmodelingprep.com/symbol/${symbol}.png`;
    cacheSet(cacheKey, result, TTL_24H);
    persistSet(cacheKey, result, TTL_24H);
    return result;
  } catch {
    return null;
  }
};

export interface EtfInfo {
  family: string | null;
  category: string | null;
  expenseRatio: number | null;
  totalAssets: number | null;
  inceptionDate: string | null;
  dividendYield: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  holdingsTurnover: number | null;
  holdings: { name: string; pct: number }[];
  annualReturns: { year: string; value: number }[];
  assetAllocation: { stocks: number | null; bonds: number | null; cash: number | null; other: number | null };
  sectorWeighting: { sector: string; weight: number }[];
}

// Expense ratios (TER) for the most common ETFs
// Values are fractions: 0.0003 = 0.03%
const ETF_TER: Record<string, number> = {
  // Vanguard US
  VOO: 0.0003, VTI: 0.0003, VT: 0.0007, VEA: 0.0005, VWO: 0.0008,
  VIG: 0.0006, VYM: 0.0006, VXUS: 0.0007, VNQ: 0.0012, VGT: 0.001,
  // iShares
  IVV: 0.0003, IEFA: 0.0007, IEMG: 0.0009, AGG: 0.0003, LQD: 0.0014,
  IJR: 0.0006, IJH: 0.0005, IWM: 0.0019, IWF: 0.002, IWD: 0.0019,
  ITOT: 0.0003, IXUS: 0.0009, ISAC: 0.0009,
  // SPDR
  SPY: 0.000945, GLD: 0.004, IAU: 0.0025, SPYG: 0.001, MDY: 0.0023,
  // Invesco
  QQQ: 0.002, QQQM: 0.0015, RSP: 0.002,
  // Schwab
  SCHB: 0.0003, SCHD: 0.0006, SCHX: 0.0003, SCHF: 0.0006, SCHE: 0.0011,
  // ARK
  ARKK: 0.0075, ARKW: 0.0083, ARKG: 0.0075,
  // European UCITS (common tickers)
  'VUSA.AS': 0.0007, 'VUAA.AS': 0.0007, 'VWRL.AS': 0.0022,
  'CSPX.L': 0.0007, 'IWDA.AS': 0.002, 'EIMI.AS': 0.0018,
  'VWCE.DE': 0.0022, 'SPYI.DE': 0.0003, 'SXR8.DE': 0.0007,
  'IQQQ.DE': 0.002,
  'VUAA.DE': 0.0007, 'VWCE.AS': 0.0022, 'CNDX.L': 0.002,
  'XDWD.DE': 0.0019, 'XDWL.DE': 0.0019, 'XDEX.DE': 0.002,
  'EUNL.DE': 0.002, 'SXRV.DE': 0.0009, 'IS3N.DE': 0.0018,
  'MEUD.PA': 0.003, 'PAEEM.PA': 0.0045, 'PCEU.PA': 0.0025,
  'IUSA.L': 0.0007, 'SWDA.L': 0.002, 'EMIM.L': 0.0018,
};

// Parse issuer/family from ETF long name
const parseEtfFamily = (name: string): string | null => {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes('vanguard')) return 'Vanguard';
  if (n.includes('ishares') || n.includes('blackrock')) return 'iShares (BlackRock)';
  if (n.includes('spdr') || n.includes('state street')) return 'SPDR (State Street)';
  if (n.includes('invesco')) return 'Invesco';
  if (n.includes('schwab')) return 'Schwab';
  if (n.includes('ark ') || n.includes('ark innovation') || n.includes('ark genomic')) return 'ARK Invest';
  if (n.includes('xtrackers') || n.includes('dws')) return 'DWS (Xtrackers)';
  if (n.includes('amundi')) return 'Amundi';
  if (n.includes('lyxor')) return 'Lyxor';
  if (n.includes('wisdomtree')) return 'WisdomTree';
  if (n.includes('pimco')) return 'PIMCO';
  if (n.includes('fidelity')) return 'Fidelity';
  if (n.includes('franklin')) return 'Franklin Templeton';
  if (n.includes('hsbc')) return 'HSBC';
  return null;
};

// ETF sector weights from FMP — returns e.g. [{ sector: 'Technology', weight: 0.312 }, ...]
export const getEtfSectorWeights = async (symbol: string): Promise<{ sector: string; weight: number }[]> => {
  if (!FMP_KEY) return [];
  try {
    const { data } = await fmp.get('/stable/etf/info', {
      params: { symbol, apikey: FMP_KEY },
    });
    const etf = Array.isArray(data) ? data[0] : null;
    if (!etf?.sectorsList || !Array.isArray(etf.sectorsList)) return [];
    return (etf.sectorsList as Record<string, unknown>[])
      .map((d) => ({
        sector: String(d.industry ?? ''),
        weight: (parseFloat(String(d.exposure ?? '0')) || 0) / 100,
      }))
      .filter((d) => d.sector && d.weight > 0);
  } catch {
    return [];
  }
};

// Yahoo Finance snake_case sector keys → canonical sector names (compatible with sectorAbr)
const YAHOO_SECTOR_KEY_MAP: Record<string, string> = {
  realestate:             'Real Estate',
  consumer_cyclical:      'Consumer Cyclical',
  basic_materials:        'Basic Materials',
  consumer_defensive:     'Consumer Defensive',
  technology:             'Technology',
  communication_services: 'Communication Services',
  financial_services:     'Financial Services',
  utilities:              'Utilities',
  industrials:            'Industrials',
  energy:                 'Energy',
  healthcare:             'Healthcare',
};

// Browser-like UA required: without it, /v1/test/getcrumb returns JSON instead of a plain crumb string
const YAHOO_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

type YahooCrumbResult = { crumb: string; cookie: string } | null;
let _yahooCrumbResult: YahooCrumbResult = null;
let _yahooCrumbPromise: Promise<YahooCrumbResult> | null = null;

// Extract Set-Cookie header value(s) into a single Cookie string
function parseCookieHeader(setCookie: unknown): string {
  if (!setCookie) return '';
  const arr = Array.isArray(setCookie) ? setCookie as string[] : [String(setCookie)];
  return arr.map((c) => c.split(';')[0]).join('; ');
}

async function fetchYahooCrumb(): Promise<YahooCrumbResult> {
  const isValidCrumb = (s: unknown): boolean =>
    typeof s === 'string' && s.length > 0 && s.length < 100 && !s.includes('<') && !s.includes('{');
  const ua = { 'User-Agent': YAHOO_UA };
  try {
    // Seed A3 cookie via fc.yahoo.com — returns 404 but sets the required cookie.
    // In React Native axios does NOT share cookies across requests automatically,
    // so we capture Set-Cookie and forward it manually.
    const fcResp = await axios.get('https://fc.yahoo.com', {
      headers: ua,
      validateStatus: () => true, // don't throw on 404
    });
    const cookie = parseCookieHeader(fcResp.headers?.['set-cookie']);
    const crumbResp = await yahoo1.get('/v1/test/getcrumb', {
      headers: cookie ? { ...ua, Cookie: cookie } : ua,
    });
    if (isValidCrumb(crumbResp.data)) {
      return { crumb: crumbResp.data as string, cookie };
    }
  } catch { /* ignore */ }
  return null;
}

async function getYahooCrumb(): Promise<YahooCrumbResult> {
  if (_yahooCrumbResult) return _yahooCrumbResult;
  // Deduplicate concurrent calls (all ETF fetches run in parallel at startup)
  if (!_yahooCrumbPromise) {
    _yahooCrumbPromise = fetchYahooCrumb().then((r) => {
      _yahooCrumbResult = r;
      _yahooCrumbPromise = null;
      return r;
    });
  }
  return _yahooCrumbPromise;
}

// ETF sector weights via Yahoo Finance quoteSummary — no API key required
export const getEtfSectorWeightsYahoo = async (
  symbol: string,
): Promise<{ sector: string; weight: number }[]> => {
  try {
    const auth = await getYahooCrumb();
    if (!auth) return [];
    const reqHeaders: Record<string, string> = { 'User-Agent': YAHOO_UA };
    if (auth.cookie) reqHeaders['Cookie'] = auth.cookie;
    const { data } = await yahoo1.get(`/v10/finance/quoteSummary/${symbol}`, {
      params: { modules: 'topHoldings', crumb: auth.crumb },
      headers: reqHeaders,
    });
    const sectorWeightings: Record<string, unknown>[] =
      data?.quoteSummary?.result?.[0]?.topHoldings?.sectorWeightings ?? [];
    const result: { sector: string; weight: number }[] = [];
    for (const entry of sectorWeightings) {
      for (const [key, value] of Object.entries(entry)) {
        // Yahoo returns either a plain number OR { raw: number, fmt: string }
        const weight = typeof value === 'number' ? value : (value as Record<string, number>)?.raw ?? 0;
        if (weight > 0) {
          result.push({ sector: YAHOO_SECTOR_KEY_MAP[key] ?? key, weight });
        }
      }
    }
    return result;
  } catch {
    return [];
  }
};

// Sector for an EQUITY via Yahoo quoteSummary — fallback when Finnhub has no data
// (common for European-exchange listings like AMD.HM, NOV.DE)
export const getEquitySectorYahoo = async (symbol: string): Promise<string | null> => {
  const fetchSector = async (sym: string): Promise<string | null> => {
    const auth = await getYahooCrumb();
    if (!auth) return null;
    const reqHeaders: Record<string, string> = { 'User-Agent': YAHOO_UA };
    if (auth.cookie) reqHeaders['Cookie'] = auth.cookie;
    try {
      const resp = await yahoo1.get(`/v10/finance/quoteSummary/${sym}`, {
        params: { modules: 'assetProfile,summaryProfile', crumb: auth.crumb },
        headers: reqHeaders,
      });
      const result = resp.data?.quoteSummary?.result?.[0];
      const sector =
        result?.assetProfile?.sector ??
        result?.summaryProfile?.sector ?? null;
      return typeof sector === 'string' && sector ? sector : null;
    } catch {
      // 404 = symbol not found on Yahoo (e.g. exchange-suffixed tickers); return null so caller can try base ticker
      return null;
    }
  };
  try {
    const sector = await fetchSector(symbol);
    if (sector) return sector;
    // Yahoo often has no profile for exchange-suffixed tickers (e.g. AMD.HM, VOD.L).
    // Try the base ticker (part before the first dot) as a fallback.
    const dotIndex = symbol.indexOf('.');
    if (dotIndex > 0) {
      const baseTicker = symbol.slice(0, dotIndex);
      await new Promise((r) => setTimeout(r, 400));
      return fetchSector(baseTicker);
    }
    return null;
  } catch {
    return null;
  }
};

export const getEtfInfo = async (symbol: string): Promise<EtfInfo | null> => {
  const cacheKey = `${symbol}:etfInfo:v1`;
  // 1. in-memory
  const mem = cacheGet<EtfInfo | null>(cacheKey);
  if (mem !== undefined) return mem;
  // 2. AsyncStorage
  const persisted = await persistGet<EtfInfo | null>(cacheKey);
  if (persisted !== undefined) { cacheSet(cacheKey, persisted, TTL_24H); return persisted; }
  // 3. fetch
  try {
    // 1. Yahoo Finance chart → longName + inceptionDate (fast, no auth needed)
    const chartResp = await yahoo1.get(`/v8/finance/chart/${symbol}`, {
      params: { interval: '1d', range: '1d' },
    });
    const meta = chartResp.data?.chart?.result?.[0]?.meta ?? {};
    const longName = (meta.longName ?? meta.shortName ?? '') as string;
    const firstTradeDate = meta.firstTradeDate as number | null;
    const inceptionDate = firstTradeDate
      ? new Date(firstTradeDate * 1000).toISOString().slice(0, 10)
      : null;

    // 2. Yahoo Finance quoteSummary → TER, category, family, AUM, holdings, returns, allocation
    let expenseRatio: number | null = ETF_TER[symbol] ?? ETF_TER[symbol.toUpperCase()] ?? null;
    let category: string | null = null;
    let family: string | null = parseEtfFamily(longName);
    let totalAssets: number | null = null;
    let holdingsTurnover: number | null = null;
    let holdings: { name: string; pct: number }[] = [];
    let annualReturns: { year: string; value: number }[] = [];
    let assetAllocation: EtfInfo['assetAllocation'] = { stocks: null, bonds: null, cash: null, other: null };
    let yahooSectorWeighting: { sector: string; weight: number }[] = [];

    const auth = await getYahooCrumb();
    if (auth) {
      try {
        const reqHeaders: Record<string, string> = { 'User-Agent': YAHOO_UA };
        if (auth.cookie) reqHeaders['Cookie'] = auth.cookie;
        const { data } = await yahoo1.get(`/v10/finance/quoteSummary/${symbol}`, {
          params: { modules: 'fundProfile,defaultKeyStatistics,topHoldings,fundPerformance', crumb: auth.crumb },
          headers: reqHeaders,
        });
        const result = data?.quoteSummary?.result?.[0];
        const fp = result?.fundProfile ?? {};
        const ks = result?.defaultKeyStatistics ?? {};
        const th = result?.topHoldings ?? {};
        const perf = result?.fundPerformance ?? {};

        // Expense ratio (TER)
        const fees = fp.feesExpensesInvestment ?? {};
        const rawTer =
          fees.annualReportExpenseRatio?.raw ??
          fees.netExpRatio?.raw ??
          fees.grossExpRatio?.raw ?? null;
        if (typeof rawTer === 'number' && rawTer > 0) expenseRatio = rawTer;

        // Holdings turnover
        const rawTurnover = fees.annualHoldingsTurnover?.raw ?? null;
        if (typeof rawTurnover === 'number' && rawTurnover > 0) holdingsTurnover = rawTurnover;

        // Category & family
        if (typeof fp.categoryName === 'string' && fp.categoryName) category = fp.categoryName;
        if (typeof fp.family === 'string' && fp.family) family = fp.family;

        // AUM
        const rawAssets = ks.totalAssets?.raw ?? null;
        if (typeof rawAssets === 'number' && rawAssets > 0) totalAssets = rawAssets;

        // Inception date override from keyStatistics (more reliable)
        // (inceptionDate already set from chart meta above)

        // Top holdings
        if (Array.isArray(th.holdings)) {
          holdings = (th.holdings as Record<string, unknown>[])
            .map((h) => ({
              name: String(h.holdingName ?? ''),
              pct: typeof (h.holdingPercent as Record<string, unknown>)?.raw === 'number'
                ? (h.holdingPercent as Record<string, unknown>).raw as number
                : typeof h.holdingPercent === 'number' ? h.holdingPercent : 0,
            }))
            .filter((h) => h.name && h.pct > 0);
        }

        // Asset allocation
        const rawStock = th.stockPosition?.raw ?? null;
        const rawBond  = th.bondPosition?.raw ?? null;
        const rawCash  = th.cashPosition?.raw ?? null;
        const rawOther = th.otherPosition?.raw ?? null;
        assetAllocation = {
          stocks: typeof rawStock === 'number' ? rawStock : null,
          bonds:  typeof rawBond  === 'number' ? rawBond  : null,
          cash:   typeof rawCash  === 'number' ? rawCash  : null,
          other:  typeof rawOther === 'number' ? rawOther : null,
        };

        // Sector weighting from Yahoo (used as fallback when FMP has no data, e.g. EU-listed ETFs)
        const swEntries = (th.sectorWeightings ?? []) as Record<string, unknown>[];
        for (const entry of swEntries) {
          for (const [key, value] of Object.entries(entry)) {
            const w = typeof value === 'number' ? value : (value as Record<string, number>)?.raw ?? 0;
            if (w > 0) yahooSectorWeighting.push({ sector: YAHOO_SECTOR_KEY_MAP[key] ?? key, weight: w });
          }
        }
        yahooSectorWeighting.sort((a, b) => b.weight - a.weight);

        // Annual returns
        const returns = perf?.annualTotalReturns?.returns ?? [];
        if (Array.isArray(returns)) {
          annualReturns = (returns as Record<string, unknown>[])
            .map((r) => ({
              year: String(r.year ?? ''),
              value: typeof (r.annualValue as Record<string, unknown>)?.raw === 'number'
                ? (r.annualValue as Record<string, unknown>).raw as number
                : 0,
            }))
            .filter((r) => r.year)
            .sort((a, b) => Number(a.year) - Number(b.year));
        }
      } catch { /* quoteSummary failed, use fallbacks */ }
    }

    // 3. FMP sector weighting (no-op if no key)
    let sectorWeighting: { sector: string; weight: number }[] = [];
    if (FMP_KEY) {
      const base = symbol.includes('.') ? symbol.split('.')[0] : symbol;
      const swRes = await fmp.get('/stable/etf/sector-weighting', { params: { symbol: base, apikey: FMP_KEY } }).catch(() => ({ data: [] }));
      if (Array.isArray(swRes.data)) {
        sectorWeighting = (swRes.data as Record<string, unknown>[])
          .map((d) => {
            const raw = parseFloat(String(d.weightPercentage ?? d.weight ?? '0').replace('%', ''));
            // FMP returns percent values (e.g. 25.5) — normalise to 0-1
            const weight = raw > 1 ? raw / 100 : raw;
            return { sector: String(d.sector ?? d.sectorName ?? ''), weight: weight || 0 };
          })
          .filter((d) => d.sector && d.weight > 0)
          .sort((a, b) => b.weight - a.weight);
      }
    }
    // Fallback: use Yahoo Finance sector data when FMP returns nothing (e.g. EU-listed ETFs)
    if (sectorWeighting.length === 0 && yahooSectorWeighting.length > 0) {
      sectorWeighting = yahooSectorWeighting;
    }

    const result: EtfInfo = {
      family,
      category,
      expenseRatio,
      totalAssets,
      inceptionDate,
      dividendYield: null,
      dayHigh: null,
      dayLow: null,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      holdingsTurnover,
      holdings,
      annualReturns,
      assetAllocation,
      sectorWeighting,
    };
    cacheSet(cacheKey, result, TTL_24H);
    persistSet(cacheKey, result, TTL_24H);
    return result;
  } catch {
    return null;
  }
};

export interface Fundamentals {
  // Valorização
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  enterpriseValue: number | null;
  // Rentabilidade
  trailingEps: number | null;
  forwardEps: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  profitMargins: number | null;
  operatingMargins: number | null;
  grossMargins: number | null;
  // Crescimento
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  roic: number | null;
  wacc: number | null;
  totalRevenue: number | null;
  forwardRevenue: number | null;
  ebitda: number | null;
  evToEbitda: number | null;
  // Balanço
  totalCash: number | null;
  totalDebt: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  // Mercado
  beta: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  averageVolume: number | null;
  dividendYield: number | null;
  buybackYield: number | null;
  payoutRatio: number | null;
  fcfPayoutRatio: number | null;
  dividendPerShare: number | null;
  dividendDate: string | null;
  exDividendDate: string | null;
  dividendFrequency: string | null;
  revenueHistory: Array<{ year: string; revenue: number }>;
  // Perfil
  sector: string | null;
  industry: string | null;
  employees: number | null;
  sharesOutstanding: number | null;
  description: string | null;
  website: string | null;
  logoUrl: string | null;
}

const DEFAULT_FMP_KEY = 'YluwKMMsNomEfMhv3H0FaPI73VGAVPSg';
let FMP_KEY = DEFAULT_FMP_KEY;
export const fmp = axios.create({
  baseURL: '/api/fmp',
});

// ── FMP rate limiter: max 3 concurrent requests, min 300ms between each ────────
let _fmpActive = 0;
const _fmpQueue: Array<() => void> = [];
const FMP_MAX_CONCURRENT = 3;
const FMP_MIN_DELAY_MS   = 300;
let _fmpLastCall = 0;

function _fmpNext() {
  if (_fmpActive >= FMP_MAX_CONCURRENT || _fmpQueue.length === 0) return;
  const now = Date.now();
  const wait = Math.max(0, _fmpLastCall + FMP_MIN_DELAY_MS - now);
  setTimeout(() => {
    if (_fmpQueue.length === 0) return;
    _fmpActive++;
    _fmpLastCall = Date.now();
    const run = _fmpQueue.shift()!;
    run();
  }, wait);
}

fmp.interceptors.request.use(config =>
  new Promise(resolve => {
    _fmpQueue.push(() => resolve(config));
    _fmpNext();
  })
);
fmp.interceptors.response.use(
  res  => { _fmpActive--; _fmpNext(); return res; },
  err  => { _fmpActive--; _fmpNext(); return Promise.reject(err); }
);
export const getFmpKey = () => FMP_KEY;

let FH_KEY = '';
const fh = axios.create({ baseURL: '/api/fh' });

let AV_KEY = 'DAZQBTW5WH6CYCCI';
const av = axios.create({ baseURL: '/api/av' });

/** Called by SettingsContext on startup and whenever the user saves new keys */
export const setApiKeys = (fmpKey: string, fhKey: string, avKey?: string): void => {
  FMP_KEY = fmpKey.trim() || DEFAULT_FMP_KEY;
  FH_KEY = fhKey.trim();
  if (avKey != null) AV_KEY = avKey.trim() || 'DAZQBTW5WH6CYCCI';
};

// ─── Alpha Vantage — Technical Indicators + News Sentiment ────────────────────
export interface AVTechnicals {
  rsi: number | null;           // 14-period RSI (weekly)
  macd: number | null;          // MACD line
  macdSignal: number | null;    // Signal line
  macdHist: number | null;      // Histogram
  sma50: number | null;         // 50-period SMA (weekly)
  sma200: number | null;        // 200-period SMA (weekly)
  news: { title: string; sentiment: string; score: number }[];
}

export async function fetchAVTechnicals(symbol: string): Promise<AVTechnicals> {
  const cacheKey = `av:tech:${symbol}`;
  const cached = cacheGet<AVTechnicals>(cacheKey);
  if (cached) return cached;

  const base = `https://www.alphavantage.co/query`;
  const p = (fn: string, extra: Record<string, string> = {}) =>
    axios.get(base, { params: { function: fn, symbol, interval: 'weekly', apikey: AV_KEY, ...extra } })
      .catch(() => ({ data: {} }));

  const [rsiRes, macdRes, sma50Res, newsRes] = await Promise.all([
    p('RSI', { time_period: '14', series_type: 'close' }),
    p('MACD', { series_type: 'close' }),
    p('SMA', { time_period: '50', series_type: 'close' }),
    axios.get(base, { params: { function: 'NEWS_SENTIMENT', tickers: symbol, limit: '5', apikey: AV_KEY } })
      .catch(() => ({ data: {} })),
  ]);

  const latestVal = (data: Record<string, unknown>, outerKey: string, innerKey: string): number | null => {
    const ts = data[outerKey] as Record<string, Record<string, string>> | undefined;
    if (!ts) return null;
    const latest = Object.values(ts)[0];
    if (!latest) return null;
    const n = parseFloat(latest[innerKey]);
    return isNaN(n) ? null : n;
  };

  const rsi = latestVal(rsiRes.data, 'Technical Analysis: RSI', 'RSI');
  const macd = latestVal(macdRes.data, 'Technical Analysis: MACD', 'MACD');
  const macdSignal = latestVal(macdRes.data, 'Technical Analysis: MACD', 'MACD_Signal');
  const macdHist = latestVal(macdRes.data, 'Technical Analysis: MACD', 'MACD_Hist');
  const sma50 = latestVal(sma50Res.data, 'Technical Analysis: SMA', 'SMA');
  // 200-SMA: use 4th value of 50-SMA as proxy (weekly 50-SMA ≈ 200-day)
  const sma200Val = (() => {
    const ts = sma50Res.data['Technical Analysis: SMA'] as Record<string, Record<string, string>> | undefined;
    if (!ts) return null;
    const vals = Object.values(ts);
    const v = vals[3]?.['SMA'];
    if (!v) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  })();

  const feed = (newsRes.data?.feed as Array<Record<string, unknown>>) ?? [];
  const news = feed.slice(0, 5).map((item) => {
    const tickerSent = (item.ticker_sentiment as Array<Record<string, string>> | undefined)
      ?.find((t) => t.ticker === symbol);
    const label = (tickerSent?.ticker_sentiment_label ?? item.overall_sentiment_label ?? 'Neutral') as string;
    const score = parseFloat((tickerSent?.ticker_sentiment_score ?? item.overall_sentiment_score ?? '0') as string);
    return {
      title: (item.title as string) ?? '',
      sentiment: label,
      score: isNaN(score) ? 0 : score,
    };
  });

  const result: AVTechnicals = { rsi, macd, macdSignal, macdHist, sma50, sma200: sma200Val, news };
  cacheSet(cacheKey, result, 60 * 60_000); // 1h cache
  return result;
}

// Verifica se data do FMP é válida (array não vazio com campos key)
const fmpHasData = (data: unknown): boolean =>
  Array.isArray(data) && data.length > 0 && Object.keys(data[0] as object).length > 1;

export const getFundamentals = async (symbol: string): Promise<Fundamentals | null> => {
  const key = `${symbol}:fundamentals:v4`;
  // 1. in-memory
  const mem = cacheGet<Fundamentals | null>(key);
  if (mem !== undefined) return mem;
  // 2. persistent (AsyncStorage)
  const persisted = await persistGet<Fundamentals | null>(key);
  if (persisted !== undefined) { cacheSet(key, persisted, TTL.fundamentals); return persisted; }
  // 3. fetch
  const result = await _getFundamentals(symbol);
  cacheSet(key, result, TTL.fundamentals);
  persistSet(key, result, TTL.fundamentals);
  return result;
};

async function _getFundamentals(symbol: string): Promise<Fundamentals | null> {
  const base = symbol.includes('.') ? symbol.split('.')[0] : symbol;
  const [profileRes, ratiosRes, chartRes, estimatesRes, incomeRes, fhMetricRes, fhDivRes, fhCfRes, fhProfileRes, keyMetricsRes, waccRes, balanceRes] = await Promise.all([
    fmp.get('/stable/profile', { params: { symbol, apikey: FMP_KEY } }).catch(() => ({ data: [] })),
    fmp.get('/stable/ratios-ttm', { params: { symbol, apikey: FMP_KEY } }).catch(() => ({ data: [] })),
    yahoo1.get(`/v8/finance/chart/${symbol}`, { params: { interval: '1d', range: '1d' } }).catch(() => ({ data: {} })),
    fmp.get('/stable/analyst-estimates', { params: { symbol, period: 'annual', limit: 5, apikey: FMP_KEY } }).catch(() => ({ data: [] })),
    fmp.get('/stable/income-statement', { params: { symbol, period: 'annual', limit: 8, apikey: FMP_KEY } }).catch(() => ({ data: [] })),
    fh.get('/stock/metric', { params: { symbol, metric: 'all', token: FH_KEY } }).catch(() => ({ data: {} })),
    yahoo1.get(`/v8/finance/chart/${symbol}`, { params: { interval: '1d', range: '2y', events: 'div' } }).catch(() => ({ data: {} })),
    fh.get('/stock/financials-reported', { params: { symbol, freq: 'annual', token: FH_KEY } }).catch(() => ({ data: {} })),
    fh.get('/stock/profile2', { params: { symbol: base, token: FH_KEY } }).catch(() => ({ data: {} })),
    fmp.get('/stable/key-metrics-ttm', { params: { symbol, apikey: FMP_KEY } }).catch(() => ({ data: [] })),
    fmp.get('/stable/wacc', { params: { symbol, apikey: FMP_KEY } }).catch(() => ({ data: [] })),
    fmp.get('/stable/balance-sheet-statement', { params: { symbol, period: 'annual', limit: 2, apikey: FMP_KEY } }).catch(() => ({ data: [] })),
  ]);

  const fmpProfileOk = fmpHasData(profileRes.data);
  const fmpRatiosOk = fmpHasData(ratiosRes.data);

  // Finnhub metrics sempre disponíveis (fetched na Promise.all inicial)
  let fhMetric: Record<string, unknown> | null =
    (fhMetricRes.data?.metric && Object.keys(fhMetricRes.data.metric).length > 0)
      ? fhMetricRes.data.metric as Record<string, unknown>
      : null;

  // Finnhub profile sempre buscado em paralelo
  let fhProfile: Record<string, unknown> | null =
    (fhProfileRes.data && Object.keys(fhProfileRes.data).length > 0) ? fhProfileRes.data as Record<string, unknown> : null;

  // Descrição vem sempre do FMP profile (Finnhub não tem)
  let fmpDescription: string | null = fmpProfileOk
    ? ((Array.isArray(profileRes.data) ? profileRes.data[0] : null)?.description as string) ?? null
    : null;
  // Se FMP não tiver dados de perfil ou rácios, busca métricas do Finnhub como fallback
  if ((!fmpProfileOk || !fmpRatiosOk) && !fhMetric) {
    const fhMetricFallback = await fh.get('/stock/metric', { params: { symbol, metric: 'all', token: FH_KEY } }).catch(() => ({ data: {} }));
    fhMetric = (fhMetricFallback.data?.metric && Object.keys(fhMetricFallback.data.metric).length > 0) ? fhMetricFallback.data.metric as Record<string, unknown> : null;
  }

  const profile = fmpProfileOk ? (Array.isArray(profileRes.data) ? profileRes.data[0] : null) : null;
  const ratios = fmpRatiosOk ? (Array.isArray(ratiosRes.data) ? ratiosRes.data[0] : null) : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartMeta = (chartRes.data as any)?.chart?.result?.[0]?.meta ?? {};

  // Primeiro estimate futuro para forward PE/EPS
  const today = Date.now();
  const estimates: Record<string, unknown>[] = Array.isArray(estimatesRes.data) ? estimatesRes.data : [];
  const nextEstimate = estimates
    .filter((e) => new Date(e.date as string).getTime() > today)
    .sort((a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime())[0] ?? null;

  // Crescimento YoY a partir do income statement (2 anos)
  const incomeStmts: Record<string, unknown>[] = Array.isArray(incomeRes.data) ? incomeRes.data : [];
  const calcYoY = (key: string): number | null => {
    if (incomeStmts.length < 2) return null;
    const curr = Number(incomeStmts[0][key]);
    const prev = Number(incomeStmts[1][key]);
    if (!prev || prev === 0) return null;
    return (curr - prev) / Math.abs(prev);
  };
  const revenueGrowthYoY = calcYoY('revenue');
  const earningsGrowthYoY = calcYoY('netIncome');
  const totalRevenueLatest = incomeStmts[0] ? Number(incomeStmts[0].revenue) || null : null;
  // Past estimates sorted newest-first (fallback when income statements are empty, e.g. EU stocks)
  const pastEstimates = estimates
    .filter((e) => new Date(e.date as string).getTime() <= today)
    .sort((a, b) => new Date(b.date as string).getTime() - new Date(a.date as string).getTime());
  const latestPastEst = pastEstimates[0] ?? null;
  const prevPastEst   = pastEstimates[1] ?? null;
  const netIncomeLatest = incomeStmts[0] ? Number(incomeStmts[0].netIncome) || null : null;
  const totalDebtLatest = incomeStmts[0] ? null : null; // debt está no balanço, não no income

  if (!profile && !fhProfile && !fhMetric) return null;

  const n = (val: unknown): number | null => {
    if (val == null || val === '') return null;
    const num = typeof val === 'number' ? val : Number(val);
    return isNaN(num) || num === 0 ? null : num;
  };

  // Helper: FMP first, Finnhub as fallback
  const fv = (fmpVal: unknown, fhVal: unknown): number | null => n(fmpVal) ?? n(fhVal);

  const result: Fundamentals = {
    marketCap: n(profile?.mktCap) ?? (fhMetric?.marketCapitalization ? Number(fhMetric.marketCapitalization) * 1e6 : null) ?? (fhProfile ? Number(fhProfile.marketCapitalization) * 1e6 : null),
    trailingPE: fv(ratios?.priceToEarningsRatioTTM, fhMetric?.peTTM),
    forwardPE: (() => {
      // FMP: price / epsAvg do próximo estimate
      const fwdEps = n(nextEstimate?.epsAvg);
      const price = n(profile?.price);
      if (fwdEps && price && fwdEps > 0) return price / fwdEps;
      // Finnhub fallback: forwardPE direto
      return n(fhMetric?.forwardPE);
    })(),
    priceToBook: fv(ratios?.priceToBookRatioTTM, fhMetric?.pbAnnual),
    priceToSales: fv(ratios?.priceToSalesRatioTTM, fhMetric?.psTTM),
    enterpriseValue: fv(ratios?.enterpriseValueTTM, null),
    trailingEps: fv(ratios?.netIncomePerShareTTM, fhMetric?.epsTTM),
    forwardEps: (() => {
      // FMP: epsAvg do próximo estimate
      const fwdEps = n(nextEstimate?.epsAvg);
      if (fwdEps) return fwdEps;
      // Finnhub fallback: preço / forwardPE
      const fhFwdPE = n(fhMetric?.forwardPE);
      const fhPrice = n(fhMetric?.revenuePerShareTTM) ? null : null; // sem preço direto
      // Usar price do profile FMP se disponível
      const price = n(profile?.price);
      if (fhFwdPE && price && fhFwdPE > 0) return price / fhFwdPE;
      return null;
    })(),
    returnOnEquity: n(fhMetric ? Number(fhMetric.roeTTM) / 100 : null),
    returnOnAssets: n(fhMetric ? Number(fhMetric.roaTTM) / 100 : null),
    profitMargins: fv(ratios?.netProfitMarginTTM, fhMetric ? Number(fhMetric.netProfitMarginTTM) / 100 : null),
    operatingMargins: fv(ratios?.operatingProfitMarginTTM, fhMetric ? Number(fhMetric.operatingMarginTTM) / 100 : null),
    grossMargins: fv(ratios?.grossProfitMarginTTM, fhMetric ? Number(fhMetric.grossMarginTTM) / 100 : null),
    revenueGrowth: revenueGrowthYoY ?? (fhMetric ? Number(fhMetric.revenueGrowthTTMYoy) / 100 : null) ?? (() => {
      const r1 = n(latestPastEst?.revenueAvg); const r0 = n(prevPastEst?.revenueAvg);
      return r1 && r0 ? (r1 - r0) / Math.abs(r0) : null;
    })(),
    earningsGrowth: earningsGrowthYoY ?? (fhMetric ? Number(fhMetric.epsGrowthTTMYoy) / 100 : null) ?? (() => {
      const i1 = n(latestPastEst?.netIncomeAvg); const i0 = n(prevPastEst?.netIncomeAvg);
      return i1 && i0 ? (i1 - i0) / Math.abs(i0) : null;
    })(),
    roic: (() => {
      const km = fmpHasData(keyMetricsRes.data) ? (Array.isArray(keyMetricsRes.data) ? keyMetricsRes.data[0] : null) : null;
      // 1. FMP key-metrics-ttm direct field
      const fmpRoic = n(km?.returnOnInvestedCapitalTTM);
      if (fmpRoic != null) return fmpRoic;
      // 2. FMP ratios-ttm
      const ratioRoic = n(ratios?.returnOnInvestedCapitalTTM);
      if (ratioRoic != null) return ratioRoic;
      // 3. Finnhub (value is %, divide by 100)
      if (fhMetric?.roicTTM != null) {
        const v = Number(fhMetric.roicTTM);
        if (!isNaN(v) && v !== 0) return v / 100;
      }
      // 4. Manual: NOPAT / investedCapitalTTM (from same key-metrics call — avoids extra fetch)
      const inc = incomeStmts[0];
      const investedCapKM = n(km?.investedCapitalTTM);
      if (inc && investedCapKM && investedCapKM > 0) {
        const ebit = Number(inc.operatingIncome) || 0;
        const preTax = Number(inc.incomeBeforeTax) || 0;
        const tax = Number(inc.incomeTaxExpense) || 0;
        const taxRate = preTax > 0 ? Math.min(Math.max(tax / preTax, 0), 0.4) : 0.21;
        const nopat = ebit * (1 - taxRate);
        if (nopat !== 0) return nopat / investedCapKM;
      }
      // 5. Manual with balance sheet data
      const balStmts: Record<string, unknown>[] = Array.isArray(balanceRes.data) ? balanceRes.data : [];
      const bal = balStmts[0];
      if (inc && bal) {
        const ebit = Number(inc.operatingIncome) || 0;
        const preTax = Number(inc.incomeBeforeTax) || 0;
        const tax = Number(inc.incomeTaxExpense) || 0;
        const taxRate = preTax > 0 ? Math.min(Math.max(tax / preTax, 0), 0.4) : 0.21;
        const nopat = ebit * (1 - taxRate);
        const equity = Math.abs(Number(bal.totalStockholdersEquity) || 0);
        const debt = Math.abs(Number(bal.totalDebt) || 0);
        const investedCapital = equity + debt;
        if (investedCapital > 0 && nopat !== 0) return nopat / investedCapital;
      }
      return null;
    })(),
    wacc: (() => {
      // 1. FMP /stable/wacc (premium plan)
      const w = fmpHasData(waccRes.data) ? (Array.isArray(waccRes.data) ? waccRes.data[0] : null) : null;
      if (w?.wacc != null) {
        const v = Number(w.wacc);
        if (!isNaN(v) && v !== 0) return v > 1 ? v / 100 : v;
      }
      // 2. Manual WACC using market cap for equity weight (Brealey/Myers approach)
      const betaVal = n(profile?.beta) ?? (fhMetric?.beta != null ? Number(fhMetric.beta) : null);
      const mktCap = n(profile?.mktCap) ?? (fhMetric?.marketCapitalization ? Number(fhMetric.marketCapitalization) * 1e6 : null);
      const inc2 = incomeStmts[0];
      const balStmts2: Record<string, unknown>[] = Array.isArray(balanceRes.data) ? balanceRes.data : [];
      const bal2 = balStmts2[0];
      if (betaVal == null || mktCap == null || mktCap <= 0) return null;
      const RF = 0.045;   // 10-year risk-free
      const MRP = 0.055;  // equity risk premium
      const costOfEquity = RF + Math.min(Math.max(betaVal, 0.3), 3.0) * MRP;
      const totalDebtVal = bal2 ? Math.abs(Number(bal2.totalDebt) || 0) : 0;
      const preTax = inc2 ? (Number(inc2.incomeBeforeTax) || 0) : 0;
      const tax = inc2 ? (Number(inc2.incomeTaxExpense) || 0) : 0;
      const taxRate = preTax > 0 ? Math.min(Math.max(tax / preTax, 0), 0.4) : 0.21;
      // Cost of debt: actual if available; else Damodaran spread by debt/ebitda leverage
      let costOfDebt = 0;
      const interestExp = inc2 ? Math.abs(Number(inc2.interestExpense) || 0) : 0;
      if (interestExp > 0 && totalDebtVal > 0) {
        costOfDebt = interestExp / totalDebtVal;
      } else if (totalDebtVal > 0) {
        const ebitdaVal = inc2 ? (Math.abs(Number(inc2.ebitda) || 0)) : 0;
        const leverage = ebitdaVal > 0 ? totalDebtVal / ebitdaVal : 0;
        // Damodaran default spread: low leverage → +0.75%, rising to +3% for junk
        const spread = leverage <= 0 ? 0.005 : leverage <= 1 ? 0.0075 : leverage <= 2 ? 0.0125 : leverage <= 3 ? 0.02 : 0.03;
        costOfDebt = RF + spread;
      }
      const V = mktCap + totalDebtVal;
      return (mktCap / V) * costOfEquity + (totalDebtVal / V) * costOfDebt * (1 - taxRate);
    })(),
    totalRevenue: totalRevenueLatest ?? n(latestPastEst?.revenueAvg),
    forwardRevenue: n(nextEstimate?.revenueAvg),
    ebitda: (incomeStmts[0] ? (Number(incomeStmts[0].ebitda) || null) : null) ?? n(latestPastEst?.ebitdaAvg),
    evToEbitda: n(fhMetric?.evEbitdaTTM),
    totalCash: (() => {
      const fhReports: Array<Record<string, unknown>> = Array.isArray(fhCfRes.data?.data) ? fhCfRes.data.data : [];
      const annual = fhReports[0];
      if (!annual) return null;
      const bs = ((annual.report as Record<string, unknown>)?.bs ?? []) as Array<Record<string, unknown>>;
      const findBS = (...keys: string[]) => {
        const item = bs.find((x) => { const c = x.concept; return typeof c === 'string' && keys.some((k) => c.includes(k)); });
        return item?.value != null ? Math.abs(Number(item.value)) : null;
      };
      return findBS('CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsAndShortTermInvestments');
    })(),
    totalDebt: (() => {
      const fhReports: Array<Record<string, unknown>> = Array.isArray(fhCfRes.data?.data) ? fhCfRes.data.data : [];
      const annual = fhReports[0];
      if (!annual) return null;
      const bs = ((annual.report as Record<string, unknown>)?.bs ?? []) as Array<Record<string, unknown>>;
      const findBS = (...keys: string[]) => {
        const item = bs.find((x) => { const c = x.concept; return typeof c === 'string' && keys.some((k) => c.includes(k)); });
        return item?.value != null ? Math.abs(Number(item.value)) : null;
      };
      const shortTerm = findBS('LongTermDebtCurrent', 'ShortTermBorrowings', 'CommercialPaper') ?? 0;
      const longTerm = findBS('LongTermDebtNoncurrent') ?? 0;
      const total = shortTerm + longTerm;
      return total > 0 ? total : null;
    })(),
    debtToEquity: fv(n(ratios?.debtToEquityRatioTTM), fhMetric ? Number(fhMetric['totalDebt/totalEquityAnnual']) : null),
    currentRatio: fv(ratios?.currentRatioTTM, fhMetric?.currentRatioAnnual),
    beta: fv(profile?.beta, fhMetric?.beta),
    fiftyTwoWeekHigh: fv(chartMeta.fiftyTwoWeekHigh, fhMetric?.['52WeekHigh']),
    fiftyTwoWeekLow: fv(chartMeta.fiftyTwoWeekLow, fhMetric?.['52WeekLow']),
    averageVolume: n(profile?.volAvg),
    dividendYield: fv(ratios?.dividendYieldTTM, fhMetric ? Number(fhMetric.currentDividendYieldTTM) / 100 : null),
    buybackYield: null, // computed below after result.marketCap is available
    payoutRatio: fv(ratios?.dividendPayoutRatioTTM, fhMetric ? Number(fhMetric.payoutRatioTTM) / 100 : null),
    fcfPayoutRatio: (() => {
      const fhReports: Array<Record<string, unknown>> = Array.isArray(fhCfRes.data?.data) ? fhCfRes.data.data : [];
      const annual = fhReports[0];
      if (!annual) return null;
      const cf = ((annual.report as Record<string, unknown>)?.cf ?? []) as Array<Record<string, unknown>>;
      const findCF = (...keys: string[]) => {
        const item = cf.find((x) => { const c = x.concept; return typeof c === 'string' && keys.some((k) => c.includes(k)); });
        return item?.value != null ? Math.abs(Number(item.value)) : null;
      };
      const operatingCF = findCF('NetCashProvidedByUsedInOperatingActivities');
      const capex = findCF('PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets');
      const divPaid = findCF('PaymentsOfDividends', 'PaymentsOfDividendsCommonStock');
      if (operatingCF == null || capex == null || divPaid == null) return null;
      const fcf = operatingCF - capex;
      if (fcf <= 0) return null;
      return divPaid / fcf;
    })(),
    dividendPerShare: n(fhMetric?.dividendPerShareAnnual),
    dividendDate: null,
    exDividendDate: (() => {
      // Yahoo chart events=div: keys are unix timestamps (seconds), each entry is { date, amount }
      const events = fhDivRes.data?.chart?.result?.[0]?.events?.dividends as Record<string, { date: number; amount: number }> | undefined;
      if (!events) return null;
      const timestamps = Object.keys(events).map(Number).sort((a, b) => b - a);
      if (timestamps.length === 0) return null;
      const mostRecent = new Date(timestamps[0] * 1000);
      return mostRecent.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    })(),
    dividendFrequency: null,
    revenueHistory: (() => {
      const stmts: Record<string, unknown>[] = Array.isArray(incomeRes.data) ? incomeRes.data : [];
      return stmts
        .filter(s => s.date && Number(s.revenue) > 0)
        .map(s => ({ year: String(s.date).slice(0, 4), revenue: Number(s.revenue) }))
        .reverse();
    })(),
    sector: (profile?.sector as string) ?? (fhProfile?.finnhubIndustry as string) ?? null,
    industry: (profile?.industry as string) ?? null,
    employees: n(profile?.fullTimeEmployees) != null ? Math.round(n(profile.fullTimeEmployees)!) : null,
    sharesOutstanding: fhProfile?.shareOutstanding != null ? Number(fhProfile.shareOutstanding) * 1e6 : (profile?.sharesOutstanding != null ? Number(profile.sharesOutstanding) : null),
    description: fmpDescription ?? null,
    website: (profile?.website as string) ?? (fhProfile?.weburl as string) ?? null,
    logoUrl: (fhProfile?.logo as string) ?? (profile?.image as string) ?? null,
  };

  // Compute buybackYield = (Repurchases - Issuance) / MarketCap  using annual 10-K from Finnhub
  if (result.buybackYield == null && result.marketCap && result.marketCap > 0) {
    const fhReports: Array<Record<string, unknown>> = Array.isArray(fhCfRes.data?.data) ? fhCfRes.data.data : [];
    const latestAnnual = fhReports[0];
    if (latestAnnual) {
      const cf = ((latestAnnual.report as Record<string, unknown>)?.cf ?? []) as Array<Record<string, unknown>>;
      const findCF = (...keywords: string[]) => {
        const item = cf.find((x) => { const c = x.concept; return typeof c === 'string' && keywords.some((k) => c.includes(k)); });
        return item?.value != null ? Math.abs(Number(item.value)) : 0;
      };
      const repurchases = findCF('PaymentsForRepurchaseOfCommonStock', 'PaymentsForRepurchaseOfEquity');
      const issuance = findCF('ProceedsFromIssuanceOfCommonStock', 'ProceedsFromIssuanceOfSharesUnderIncentiveAndShareBasedCompensationPlans');
      const netBuybacks = repurchases - issuance;
      if (netBuybacks > 0) result.buybackYield = netBuybacks / result.marketCap;
    }
  }

  return result;
};

export interface NewsItem {
  title: string;
  publisher: string;
  link: string;
  publishTime: number;
}

export const getNews = async (symbol: string, page = 1): Promise<NewsItem[]> => {
  const PAGE_SIZE = 10;
  const { data } = await yahoo1.get('/v1/finance/search', {
    params: { q: symbol, newsCount: PAGE_SIZE, newsStart: (page - 1) * PAGE_SIZE, quotesCount: 0, listsCount: 0 },
  });
  return ((data?.news ?? []) as Record<string, unknown>[]).map((n) => ({
    title: n.title as string,
    publisher: n.publisher as string,
    link: n.link as string,
    publishTime: n.providerPublishTime as number,
  }));
};

export const getFinnhubNews = async (symbol: string, page = 1): Promise<NewsItem[]> => {
  const DAYS_PER_PAGE = 30;
  const base = new Date();
  const to = new Date(base.getTime() - (page - 1) * DAYS_PER_PAGE * 24 * 60 * 60 * 1000);
  const from = new Date(to.getTime() - DAYS_PER_PAGE * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const { data } = await fh.get('/company-news', {
    params: { symbol, from: fmt(from), to: fmt(to), token: FH_KEY },
  });
  return ((Array.isArray(data) ? data : []) as Record<string, unknown>[])
    .slice(0, 20)
    .filter((n) => n.headline && n.url)
    .map((n) => ({
      title: n.headline as string,
      publisher: n.source as string,
      link: n.url as string,
      publishTime: n.datetime as number,
    }));
};

export interface EarningsEvent {
  date: string;          // 'YYYY-MM-DD' fiscal quarter-end date (used for sorting/keying)
  reportDate?: string;   // 'YYYY-MM-DD' actual announcement date from earnings calendar
  epsActual: number | null;
  epsEstimated: number | null;
  surprisePct: number | null; // Finnhub pre-calculated (same basis), positive = BEAT, negative = MISS
  revenueActual: number | null;
  revenueEstimated: number | null;
  hour: 'bmo' | 'amc' | 'dmh' | null;  // before market open / after market close / during market hours
}

export const getEarnings = async (symbol: string, period: 'quarter' | 'annual' = 'quarter'): Promise<EarningsEvent[]> => {
  const key = `${symbol}:earnings:${period}:v50`;
  const mem = cacheGet<EarningsEvent[]>(key);
  if (mem !== undefined) return mem;
  const persisted = await persistGet<EarningsEvent[]>(key);
  if (persisted !== undefined) { cacheSet(key, persisted, TTL.earnings); return persisted; }
  const result = await _getEarnings(symbol, period);
  cacheSet(key, result, TTL.earnings);
  persistSet(key, result, TTL.earnings);
  return result;
};

async function _getEarnings(symbol: string, period: 'quarter' | 'annual' = 'quarter'): Promise<EarningsEvent[]> {
  // Annual mode: use Finnhub financials-reported (FMP income-statement is plan-gated)
  if (period === 'annual') {
    try {
      const { data } = await fh.get('/stock/financials-reported', {
        params: { symbol, freq: 'annual', token: FH_KEY },
      });
      const reports: Array<Record<string, unknown>> = Array.isArray(data?.data) ? data.data : [];
      const annuals = reports.filter((r) => r.quarter === 0).slice(0, 6);
      if (annuals.length > 0) {
        return annuals.map((r) => {
          const ic: Array<Record<string, unknown>> = Array.isArray((r.report as Record<string, unknown>)?.ic)
            ? (r.report as Record<string, unknown>).ic as Array<Record<string, unknown>>
            : [];
          const find = (keyword: string) =>
            ic.find((x) => typeof x.concept === 'string' && x.concept.includes(keyword))?.value ?? null;
          const revenue = find('RevenueFromContractWithCustomer') ?? find('Revenues') ?? find('Revenue');
          const eps = find('EarningsPerShareDiluted') ?? find('EarningsPerShareBasic');
          return {
            date: `${r.year}-12-31` as string,
            epsActual: eps != null ? Number(eps) : null,
            epsEstimated: null,
            surprisePct: null,
            revenueActual: revenue != null ? Number(revenue) : null,
            revenueEstimated: null,
            hour: null,
          };
        });
      }
    } catch { /* ignore */ }
    return [];
  }

  // Quarterly mode:
  // - Alpha Vantage EARNINGS → authoritative beat/miss (reportedEPS + estimatedEPS + surprisePercentage, all non-GAAP adjusted)
  // - Finnhub /stock/earnings → past EPS actuals/estimates fallback
  // - FMP /stable/earnings → past revenueActual + revenueEstimated (primary source)
  // - Finnhub /stock/financials-reported → quarterly revenue fallback (same source as charts)
  // - Finnhub /calendar/earnings → upcoming events + hour enrichment for past
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  const today = now.getTime();
  const calFrom = fmt(now);
  const calTo = fmt(new Date(today + 180 * 24 * 3600 * 1000));
  // Also fetch past calendar to retrieve revenueEstimate values for already-reported quarters
  const calPastFrom = fmt(new Date(today - 450 * 24 * 3600 * 1000));
  const calPastTo = fmt(now);

  // Fetch Yahoo crumb before parallel calls (shared with other Yahoo calls, cached in memory)
  const yahooAuth = await getYahooCrumb().catch(() => null);

  const [avRes, avIncRes, fhEpsRes, fmpRevRes, fmpEstRes, fmpIncRes, calData, calPastData, fhFinRes, fhFinAnnualRes, yhEarnRes] = await Promise.allSettled([
    av.get('/query', { params: { function: 'EARNINGS', symbol, apikey: AV_KEY } }),
    av.get('/query', { params: { function: 'INCOME_STATEMENT', symbol, apikey: AV_KEY } }),
    fh.get('/stock/earnings', { params: { symbol, limit: 8, token: FH_KEY } }),
    fmp.get('/stable/earnings', { params: { symbol, limit: 12, apikey: FMP_KEY } }),
    fmp.get('/stable/analyst-estimates', { params: { symbol, limit: 12, period: 'quarter', apikey: FMP_KEY } }),
    fmp.get('/stable/income-statement', { params: { symbol, limit: 6, period: 'quarter', apikey: FMP_KEY } }),
    fh.get('/calendar/earnings', { params: { symbol, from: calFrom, to: calTo, token: FH_KEY } }),
    fh.get('/calendar/earnings', { params: { symbol, from: calPastFrom, to: calPastTo, token: FH_KEY } }),
    fh.get('/stock/financials-reported', { params: { symbol, freq: 'quarterly', token: FH_KEY } }),
    fh.get('/stock/financials-reported', { params: { symbol, freq: 'annual', token: FH_KEY } }),
    (() => {
      if (!yahooAuth) return Promise.reject('no-crumb');
      const reqHeaders: Record<string, string> = { 'User-Agent': YAHOO_UA };
      if (yahooAuth.cookie) reqHeaders['Cookie'] = yahooAuth.cookie;
      return yahoo1.get(`/v10/finance/quoteSummary/${symbol}`, {
        params: { modules: 'earningsHistory', crumb: yahooAuth.crumb },
        headers: reqHeaders,
      });
    })(),
  ]);

  // Yahoo Finance earningsHistory: non-GAAP adjusted EPS beat/miss — most reliable source
  // Yahoo always uses the same adjusted basis for both actual and estimate, matching street consensus
  // surprisePercent from Yahoo is a decimal fraction (e.g. 0.0096 = +0.96%), multiply by 100
  const yahooLookup = new Map<string, { surprisePct: number | null }>();
  if (yhEarnRes.status === 'fulfilled') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yhData = (yhEarnRes as PromiseFulfilledResult<{ data: Record<string, unknown> }>).value.data as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hist: Array<Record<string, any>> =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((yhData?.quoteSummary as any)?.result?.[0]?.earningsHistory?.history) ?? [];
    for (const h of hist) {
      const ts = h.quarter?.raw;
      if (!ts) continue;
      const date = new Date((ts as number) * 1000).toISOString().slice(0, 10);
      const surprisePct = h.surprisePercent?.raw != null ? Number(h.surprisePercent.raw) * 100 : null;
      yahooLookup.set(date, { surprisePct });
    }
  }

  // Alpha Vantage: authoritative beat/miss lookup keyed by fiscal quarter-end date
  // AV uses non-GAAP adjusted EPS on both sides, matching market consensus
  const avLookup = new Map<string, { epsActual: number; epsEstimated: number | null; surprisePct: number | null }>();
  // AV reported-date list for closest-match lookup — keyed by reportedDate, not fiscalDateEnding.
  // Non-calendar FY companies (GME, MU, Visa...) have Finnhub period = calendar quarter-end where
  // the announcement fell, which can be 30-60 days away from AV's fiscalDateEnding.
  // Closest-match by reportedDate to Finnhub period is far more reliable than fuzzy fiscalDateEnding.
  const avReportedDates: Array<{ reportedDate: string }> = [];
  if (avRes.status === 'fulfilled') {
    const quarterly: Array<Record<string, unknown>> = Array.isArray(avRes.value.data?.quarterlyEarnings)
      ? avRes.value.data.quarterlyEarnings : [];
    for (const q of quarterly) {
      const date = q.fiscalDateEnding as string;
      const reported = q.reportedEPS != null && q.reportedEPS !== 'None' ? Number(q.reportedEPS) : null;
      const estimated = q.estimatedEPS != null && q.estimatedEPS !== 'None' ? Number(q.estimatedEPS) : null;
      const avSurprisePct = q.surprisePercentage != null && q.surprisePercentage !== 'None' ? Number(q.surprisePercentage) : null;
      // Compute surprise from reportedEPS vs estimatedEPS when AV hasn't pre-calculated it yet
      // Both fields are non-GAAP adjusted — same basis as analyst consensus
      const computedSurprisePct = avSurprisePct ?? (
        reported != null && estimated != null && estimated !== 0
          ? ((reported - estimated) / Math.abs(estimated)) * 100
          : null
      );
      if (reported != null) {
        avLookup.set(date, { epsActual: reported, epsEstimated: estimated, surprisePct: computedSurprisePct });
      }
      if (q.reportedDate != null && q.reportedDate !== 'None') {
        avReportedDates.push({ reportedDate: q.reportedDate as string });
      }
    }
  }

  // FMP revenue + EPS lookup by quarter-end date
  const revLookup = new Map<string, { revenueActual: number | null; revenueEstimated: number | null; epsActual: number | null; epsEstimated: number | null }>();
  if (fmpRevRes.status === 'fulfilled') {
    const arr: Array<Record<string, unknown>> = Array.isArray(fmpRevRes.value.data) ? fmpRevRes.value.data : [];
    for (const e of arr) {
      revLookup.set(e.date as string, {
        revenueActual: e.revenueActual != null ? Number(e.revenueActual) : null,
        revenueEstimated: e.revenueEstimated != null ? Number(e.revenueEstimated) : null,
        epsActual: e.eps != null ? Number(e.eps) : null,
        epsEstimated: e.epsEstimated != null ? Number(e.epsEstimated) : null,
      });
    }
  }

  // Alpha Vantage INCOME_STATEMENT quarterly: revenue keyed by fiscalDateEnding
  // This fills gaps when FMP/Finnhub lag behind on recently-reported quarters
  const avRevLookup = new Map<string, number>();
  if (avIncRes.status === 'fulfilled') {
    const d = avIncRes.value.data as Record<string, unknown>;
    const quarters: Array<Record<string, unknown>> = Array.isArray(d?.quarterlyReports)
      ? d.quarterlyReports as Array<Record<string, unknown>> : [];
    for (const q of quarters) {
      const date = q.fiscalDateEnding as string;
      const rev = q.totalRevenue != null && q.totalRevenue !== 'None' ? Number(q.totalRevenue) : null;
      if (date && rev != null) avRevLookup.set(date, rev);
    }
  }

  // FMP income-statement quarterly: dedicated revenue source, more up-to-date than /stable/earnings
  const fmpIncRevLookup = new Map<string, number>();
  if (fmpIncRes.status === 'fulfilled') {
    const arr: Array<Record<string, unknown>> = Array.isArray(fmpIncRes.value.data) ? fmpIncRes.value.data : [];
    for (const r of arr) {
      const date = r.date as string;
      const rev = r.revenue != null ? Number(r.revenue) : null;
      if (date && rev != null) fmpIncRevLookup.set(date, rev);
    }
  }

  // FMP analyst-estimates: revenue estimates for past quarters (keyed by date)
  const fmpRevEstLookup = new Map<string, number>();
  if (fmpEstRes.status === 'fulfilled') {
    const arr: Array<Record<string, unknown>> = Array.isArray(fmpEstRes.value.data) ? fmpEstRes.value.data : [];
    for (const e of arr) {
      const date = e.date as string;
      const revEst = e.estimatedRevenueAvg != null ? Number(e.estimatedRevenueAvg) : null;
      if (date && revEst != null) fmpRevEstLookup.set(date, revEst);
    }
  }

  // Finnhub financials-reported: quarterly revenue fallback keyed by "year-quarter"
  // SEC 10-Q filings report YTD revenue (Q2=Q1+Q2, Q3=Q1+Q2+Q3), so we compute deltas.
  // Q4 is not filed separately (comes from 10-K annual), so we derive it: Q4 = Annual - YTD_Q3
  const fhRevLookup = new Map<string, number>();
  if (fhFinRes.status === 'fulfilled') {
    const reports: Array<Record<string, unknown>> = Array.isArray(fhFinRes.value.data?.data) ? fhFinRes.value.data.data : [];
    // First pass: collect raw YTD values for quarterly + annual from quarterly endpoint
    const fhRevYTD = new Map<string, number>();
    const fhRevAnnual = new Map<number, number>(); // year → annual revenue
    for (const r of reports) {
      const ic: Array<Record<string, unknown>> = Array.isArray((r.report as Record<string, unknown>)?.ic)
        ? (r.report as Record<string, unknown>).ic as Array<Record<string, unknown>> : [];
      const revenue = ['RevenueFromContractWithCustomer', 'Revenues', 'SalesRevenueNet', 'Revenue'].reduce<number | null>((acc, kw) => {
        if (acc != null) return acc;
        const found = ic.find((x) => typeof x.concept === 'string' && x.concept.includes(kw));
        return found?.value != null ? Number(found.value) : null;
      }, null);
      if (revenue == null) continue;
      if ((r.quarter as number) === 0) {
        fhRevAnnual.set(r.year as number, revenue);
      } else {
        fhRevYTD.set(`${r.year}-${r.quarter}`, revenue);
      }
    }
    // Also pull annual data from the dedicated annual fetch
    if (fhFinAnnualRes.status === 'fulfilled') {
      const annualReports: Array<Record<string, unknown>> = Array.isArray(fhFinAnnualRes.value.data?.data) ? fhFinAnnualRes.value.data.data : [];
      for (const r of annualReports) {
        if ((r.quarter as number) !== 0) continue;
        const ic: Array<Record<string, unknown>> = Array.isArray((r.report as Record<string, unknown>)?.ic)
          ? (r.report as Record<string, unknown>).ic as Array<Record<string, unknown>> : [];
        const revenue = ['RevenueFromContractWithCustomer', 'Revenues', 'SalesRevenueNet', 'Revenue'].reduce<number | null>((acc, kw) => {
          if (acc != null) return acc;
          const found = ic.find((x) => typeof x.concept === 'string' && x.concept.includes(kw));
          return found?.value != null ? Number(found.value) : null;
        }, null);
        if (revenue != null) fhRevAnnual.set(r.year as number, revenue);
      }
    }
    // Second pass: convert YTD to actual quarterly
    for (const [key, ytd] of fhRevYTD) {
      const [year, quarter] = key.split('-').map(Number);
      if (quarter === 1) {
        fhRevLookup.set(key, ytd);
      } else {
        const prevYTD = fhRevYTD.get(`${year}-${quarter - 1}`) ?? null;
        fhRevLookup.set(key, prevYTD != null ? ytd - prevYTD : ytd);
      }
    }
    // Derive Q4 = Annual - YTD_Q3 for each year
    for (const [year, annual] of fhRevAnnual) {
      const q3ytd = fhRevYTD.get(`${year}-3`) ?? null;
      if (q3ytd != null) {
        fhRevLookup.set(`${year}-4`, annual - q3ytd);
      }
    }
  }

  // Finnhub calendar: upcoming events + hour lookup (keyed by "year-quarter")
  const hourLookup = new Map<string, EarningsEvent['hour']>();
  const calRevEstLookup = new Map<string, number>(); // keyed by "year-quarter"
  const reportDateLookup = new Map<string, string>(); // keyed by "year-quarter" → actual announcement date
  // All past calendar announcement dates for closest-match fallback (when AV is rate-limited)
  const calAnnouncementDates: string[] = [];
  const calUpcoming: EarningsEvent[] = [];

  // Process both past and future calendar data to capture revenueEstimate for all quarters
  const allCalEntries: Array<Record<string, unknown>> = [];
  if (calData.status === 'fulfilled') {
    const cal = Array.isArray(calData.value.data?.earningsCalendar) ? calData.value.data.earningsCalendar : [];
    allCalEntries.push(...cal);
  }
  if (calPastData.status === 'fulfilled') {
    const cal = Array.isArray(calPastData.value.data?.earningsCalendar) ? calPastData.value.data.earningsCalendar : [];
    allCalEntries.push(...cal);
  }

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  for (const e of allCalEntries) {
      const date = e.date as string;
      const hour = (['bmo', 'amc', 'dmh'].includes(e.hour as string) ? e.hour : null) as EarningsEvent['hour'];
      if (e.year != null && e.quarter != null) {
        hourLookup.set(`${e.year}-${e.quarter}`, hour);
        if (e.revenueEstimate != null) {
          calRevEstLookup.set(`${e.year}-${e.quarter}`, Number(e.revenueEstimate));
        }
        if (date) reportDateLookup.set(`${e.year}-${e.quarter}`, date);
      }
      // Collect past announcement dates for closest-match fallback
      if (date && new Date(date + 'T12:00:00').getTime() < startOfToday) {
        calAnnouncementDates.push(date);
      }
      // Include today's earnings as upcoming until Finnhub updates its /stock/earnings endpoint
      if (new Date(date).getTime() >= startOfToday) {
        calUpcoming.push({
          date,
          epsActual: null,
          epsEstimated: e.epsEstimate != null ? Number(e.epsEstimate) : null,
          surprisePct: null,
          revenueActual: null,
          revenueEstimated: e.revenueEstimate != null ? Number(e.revenueEstimate) : null,
          hour,
        });
      }
  }

  // Helper: fuzzy ±3-day lookup for maps keyed by YYYY-MM-DD
  const fuzzyGet = <T>(map: Map<string, T>, dateStr: string, windowDays = 3): T | undefined => {
    const exact = map.get(dateStr);
    if (exact !== undefined) return exact;
    const ts = new Date(dateStr).getTime();
    for (const [key, val] of map.entries()) {
      if (Math.abs(new Date(key).getTime() - ts) <= windowDays * 24 * 3600 * 1000) return val;
    }
    return undefined;
  };

  // Past: AV beat/miss (primary) + FMP revenue + Finnhub fallback + hour from calendar
  const past: EarningsEvent[] = (() => {
    if (fhEpsRes.status !== 'fulfilled') return [];
    const arr: Array<Record<string, unknown>> = Array.isArray(fhEpsRes.value.data) ? fhEpsRes.value.data : [];
    return arr.map((e) => {
      const period = e.period as string;
      const av = fuzzyGet(avLookup, period);
      const rev = fuzzyGet(revLookup, period);
      const d = new Date(period);
      const q = Math.ceil((d.getMonth() + 1) / 3);
      const fhFiscalY = e.year != null ? Number(e.year) : d.getFullYear();
      const fhFiscalQ = e.quarter != null ? Number(e.quarter) : q;
      // Use fiscal year/quarter for Finnhub revenue lookup (companies with non-calendar FY
      // e.g. Visa FY ends Sep: Dec 31 quarter = fiscal 2026-Q1, not calendar 2025-Q4)
      const fhRevenue = fhRevLookup.get(`${fhFiscalY}-${fhFiscalQ}`) ?? fhRevLookup.get(`${d.getFullYear()}-${q}`) ?? null;
      const calRevEst = calRevEstLookup.get(`${fhFiscalY}-${fhFiscalQ}`) ?? calRevEstLookup.get(`${d.getFullYear()}-${q}`) ?? null;

      const avRevenue = fuzzyGet(avRevLookup, period) ?? null;

      // EPS actual: AV reported (non-GAAP adjusted) > FMP eps > Finnhub actual
      const epsActual = av?.epsActual ?? rev?.epsActual ?? (e.actual != null ? Number(e.actual) : null);
      const epsEstimated = av?.epsEstimated ?? rev?.epsEstimated ?? (e.estimate != null ? Number(e.estimate) : null);
      // surprisePct priority:
      // 1. Yahoo earningsHistory — non-GAAP adjusted on both sides, most reliable
      // 2. AV EARNINGS surprisePercentage — also non-GAAP adjusted
      // 3. Finnhub pre-calculated surprisePercent (skip FMP manual computation: FMP mixes GAAP actual vs non-GAAP estimate)
      const yahoo = fuzzyGet(yahooLookup, period);
      const surprisePct = yahoo?.surprisePct ?? av?.surprisePct ?? (e.surprisePercent != null ? Number(e.surprisePercent) : null);

      const fmpRev = fuzzyGet(revLookup, period, 45)?.revenueActual ?? fuzzyGet(fmpIncRevLookup, period, 45) ?? null;
      const finalRev = avRevenue ?? fmpRev ?? fhRevenue;

      // Find actual announcement date. Priority:
      // 1. AV reportedDate — closest-match within 65 days (most accurate, handles off-cycle FY)
      // 2. Finnhub calendar by fiscal year/quarter key
      // 3. Finnhub calendar closest-match (fallback when AV rate-limited)
      const periodTs = new Date(period + 'T12:00:00').getTime();
      const maxWindow = 65 * 24 * 3600 * 1000;
      let avRD: string | undefined;
      let avRDDist = Infinity;
      for (const { reportedDate } of avReportedDates) {
        const dist = Math.abs(new Date(reportedDate + 'T12:00:00').getTime() - periodTs);
        if (dist < avRDDist && dist <= maxWindow) { avRDDist = dist; avRD = reportedDate; }
      }
      const calKeyRD = reportDateLookup.get(`${fhFiscalY}-${fhFiscalQ}`) ?? reportDateLookup.get(`${d.getFullYear()}-${q}`);
      let calClosestRD: string | undefined;
      let calClosestDist = Infinity;
      for (const annoDate of calAnnouncementDates) {
        const dist = Math.abs(new Date(annoDate + 'T12:00:00').getTime() - periodTs);
        if (dist < calClosestDist && dist <= maxWindow) { calClosestDist = dist; calClosestRD = annoDate; }
      }
      const reportDate = avRD ?? calKeyRD ?? calClosestRD;
      return {
        date: period,
        ...(reportDate ? { reportDate } : {}),
        epsActual,
        epsEstimated,
        surprisePct,
        revenueActual: finalRev,
        revenueEstimated: rev?.revenueEstimated ?? fuzzyGet(fmpRevEstLookup, period) ?? calRevEst,
        hour: hourLookup.get(`${d.getFullYear()}-${q}`) ?? null,
      };
    }).sort((a, b) => b.date.localeCompare(a.date));
  })();

  // Upcoming: furthest first (Jul 28, Apr 29), then past: newest first (Dec 31, Sep 30...)
  // Deduplicate by date (Apr 28 can appear in both past+future calendar fetches)
  const upcomingMap = new Map<string, EarningsEvent>();
  for (const e of calUpcoming) upcomingMap.set(e.date, e);
  const upcoming = [...upcomingMap.values()].sort((a, b) => b.date.localeCompare(a.date));
  // Also remove from upcoming any date already present in past (Finnhub updated)
  const pastDates = new Set(past.map(e => e.date));
  const upcomingFiltered = upcoming.filter(e => !pastDates.has(e.date));
  return [...upcomingFiltered, ...past];
};

// ── Financial Statements ───────────────────────────────────────────────────────
export interface FinancialPeriod {
  label: string;
  year: number;
  quarter: number; // 0 = annual
  endDate: string;
  // Income Statement
  revenue: number | null;
  costOfRevenue: number | null;
  grossProfit: number | null;
  rAndD: number | null;
  sgAndA: number | null;
  operatingIncome: number | null;
  ebitda: number | null;          // NEW
  ebit: number | null;            // NEW
  interestExpense: number | null; // NEW
  pretaxIncome: number | null;
  incomeTax: number | null;
  netIncome: number | null;
  epsDiluted: number | null;
  sbc: number | null;             // NEW — stock-based compensation
  // Balance Sheet
  cash: number | null;
  cashAndShortTermInvestments: number | null; // NEW
  currentAssets: number | null;
  totalAssets: number | null;
  currentLiabilities: number | null;
  shortTermDebt: number | null;
  longTermDebt: number | null;
  netDebt: number | null;         // NEW
  totalLiabilities: number | null;
  equity: number | null;
  goodwill: number | null;        // NEW
  retainedEarnings: number | null; // NEW
  // Cash Flow
  operatingCF: number | null;
  capex: number | null;
  investingCF: number | null;
  financingCF: number | null;
  dAndA: number | null;
  dividendsPaid: number | null;
  buybacks: number | null;        // NEW — share repurchases
  sharesDiluted: number | null;
}

export const getFinancials = async (
  symbol: string,
  freq: 'quarterly' | 'annual',
): Promise<FinancialPeriod[]> => {
  const key = `${symbol}:financials:v6:${freq}`;
  const mem = cacheGet<FinancialPeriod[]>(key);
  if (mem !== undefined) return mem;
  const persisted = await persistGet<FinancialPeriod[]>(key);
  if (persisted !== undefined) { cacheSet(key, persisted, TTL.financials); return persisted; }
  const result = await _getFinancials(symbol, freq);
  cacheSet(key, result, TTL.financials);
  persistSet(key, result, TTL.financials);
  return result;
};

async function _getFinancials(
  symbol: string,
  freq: 'quarterly' | 'annual',
): Promise<FinancialPeriod[]> {
  try {
    // Helper to extract a field from an XBRL section by concept keyword
    const g = (section: Array<Record<string, unknown>>, ...keys: string[]): number | null => {
      for (const key of keys) {
        const found = section.find((x) => typeof x.concept === 'string' && x.concept.includes(key));
        if (found?.value != null) return Number(found.value);
      }
      return null;
    };

    const mapReport = (r: Record<string, unknown>, lFreq: 'quarterly' | 'annual'): FinancialPeriod => {
      const rep = r.report as Record<string, Array<Record<string, unknown>>> ?? {};
      const ic: Array<Record<string, unknown>> = rep.ic ?? [];
      const bs: Array<Record<string, unknown>> = rep.bs ?? [];
      const cf: Array<Record<string, unknown>> = rep.cf ?? [];
      const edStr = typeof r.endDate === 'string' ? r.endDate.split(' ')[0] : '';
      const label = lFreq === 'annual'
        ? `FY ${r.year}`
        : `Q${r.quarter as number}'${String(r.year as number).slice(2)}`;
      const operatingCF = g(cf, 'NetCashProvidedByUsedInOperatingActivities');
      const capex = g(cf, 'PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets');
      const operatingIncome = g(ic, 'OperatingIncomeLoss');
      const dAndA = g(cf, 'DepreciationDepletionAndAmortization', 'DepreciationAndAmortization');
      const cash = g(bs, 'CashAndCashEquivalentsAtCarryingValue');
      const shortTermInv = g(bs, 'AvailableForSaleSecuritiesCurrent', 'ShortTermInvestments', 'MarketableSecuritiesCurrent');
      const shortTermDebt = g(
        bs,
        'LongTermDebtCurrent',
        'ShortTermBorrowings',
        'CommercialPaper',
        'LongTermDebtAndCapitalLeaseObligationsCurrent',
        'LongTermDebtAndFinanceLeaseObligationsCurrent',
        'CurrentPortionOfLongTermDebt',
      );
      const longTermDebt = g(
        bs,
        'LongTermDebtNoncurrent',
        'LongTermDebtAndCapitalLeaseObligations',
        'LongTermDebtAndFinanceLeaseObligations',
        'LongTermDebtAndCapitalLeaseObligationsNoncurrent',
      );
      const totalDebt = (shortTermDebt != null || longTermDebt != null) ? (shortTermDebt ?? 0) + (longTermDebt ?? 0) : null;
      return {
        label,
        year: r.year as number,
        quarter: r.quarter as number,
        endDate: edStr,
        revenue: g(ic, 'RevenueFromContractWithCustomer', 'Revenues', 'SalesRevenueNet'),
        costOfRevenue: g(ic, 'CostOfGoodsAndServicesSold', 'CostOfRevenue'),
        grossProfit: g(ic, 'GrossProfit'),
        rAndD: g(ic, 'ResearchAndDevelopmentExpense'),
        sgAndA: g(ic, 'SellingGeneralAndAdministrativeExpense'),
        operatingIncome,
        ebitda: (operatingIncome != null && dAndA != null) ? operatingIncome + dAndA : null,
        ebit: operatingIncome,
        interestExpense: g(ic, 'InterestExpense', 'InterestAndDebtExpense'),
        pretaxIncome: g(ic, 'IncomeLossFromContinuingOperationsBeforeIncomeTax'),
        incomeTax: g(ic, 'IncomeTaxExpenseBenefit'),
        netIncome: g(ic, 'NetIncomeLoss', 'ProfitLoss'),
        epsDiluted: g(ic, 'EarningsPerShareDiluted'),
        sbc: g(cf, 'ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'),
        cash,
        cashAndShortTermInvestments: (cash != null || shortTermInv != null) ? (cash ?? 0) + (shortTermInv ?? 0) : null,
        currentAssets: g(bs, 'AssetsCurrent'),
        totalAssets: g(bs, 'Assets'),
        currentLiabilities: g(bs, 'LiabilitiesCurrent'),
        shortTermDebt,
        longTermDebt,
        netDebt: (totalDebt != null && cash != null) ? totalDebt - cash : null,
        totalLiabilities: g(bs, 'Liabilities'),
        equity: g(bs, 'StockholdersEquity'),
        goodwill: g(bs, 'Goodwill'),
        retainedEarnings: g(bs, 'RetainedEarningsAccumulatedDeficit'),
        operatingCF,
        capex,
        investingCF: g(cf, 'NetCashProvidedByUsedInInvestingActivities'),
        financingCF: g(cf, 'NetCashProvidedByUsedInFinancingActivities'),
        dAndA,
        dividendsPaid: g(cf, 'PaymentsOfDividends', 'PaymentsOfDividendsCommonStock'),
        buybacks: g(cf, 'PaymentsForRepurchaseOfCommonStock', 'PaymentsForRepurchaseOfEquity'),
        sharesDiluted: g(ic, 'WeightedAverageNumberOfDilutedSharesOutstanding'),
      };
    };

    // FMP fallback fetch helper — fetches income, balance, cashflow in parallel.
    // limit capped at 5 to stay within free-plan constraints.
    const fetchFmpFallback = async (period: 'annual' | 'quarter', limit: number) => {
      const safeLimit = Math.min(limit, 5);
      const params = { symbol, period, limit: safeLimit, apikey: FMP_KEY };
      const [incR, balR, cfR] = await Promise.all([
        fmp.get('/stable/income-statement', { params }).catch(() => ({ data: [] })),
        fmp.get('/stable/balance-sheet-statement', { params }).catch(() => ({ data: [] })),
        fmp.get('/stable/cash-flow-statement', { params }).catch(() => ({ data: [] })),
      ]);
      const incArr: Record<string, unknown>[] = Array.isArray(incR.data) ? incR.data : [];
      const balArr: Record<string, unknown>[] = Array.isArray(balR.data) ? balR.data : [];
      const cfArr: Record<string, unknown>[] = Array.isArray(cfR.data) ? cfR.data : [];
      // key by date
      const balMap = new Map(balArr.map(r => [r.date as string, r]));
      const cfMap  = new Map(cfArr.map(r => [r.date as string, r]));
      return incArr.map(inc => {
        const bal = balMap.get(inc.date as string) ?? {};
        const cf  = cfMap.get(inc.date as string) ?? {};
        return { inc, bal, cf };
      });
    };

    // Merges FMP data into a FinancialPeriod.
    // preferFmpIS = true  → FMP wins for IS/CF fields (use in quarterly mode: Finnhub XBRL 10-Qs
    //                        report YTD cumulative values, FMP returns standalone quarter figures).
    // preferFmpIS = false → FMP is fallback only (fills nulls), used for annual mode.
    const applyFmpFallback = (p: FinancialPeriod, inc: Record<string, unknown>, bal: Record<string, unknown>, cf: Record<string, unknown>, preferFmpIS = false): FinancialPeriod => {
      const nv = (v: unknown): number | null => { if (v == null) return null; const n = Number(v); return isNaN(n) ? null : n; };
      const nvAbs = (v: unknown): number | null => { const n = nv(v); return n == null ? null : Math.abs(n); };
      // fb: existing-first (FMP fills nulls) — used for annual & balance sheet
      const fb = <T>(existing: T | null, fmpVal: unknown): T | null => existing != null ? existing : nv(fmpVal) as T | null;
      const fbAbs = (existing: number | null, fmpVal: unknown): number | null => existing != null ? existing : nvAbs(fmpVal);
      // fi: FMP-first (FMP overrides Finnhub YTD) — used for IS/CF in quarterly mode
      const fi = (existing: number | null, fmpVal: unknown): number | null => { const n = nv(fmpVal); return n != null ? n : existing; };
      const fiAbs = (existing: number | null, fmpVal: unknown): number | null => { const n = nvAbs(fmpVal); return n != null ? n : existing; };
      const useIS  = preferFmpIS ? fi    : fb;
      const useISA = preferFmpIS ? fiAbs : fbAbs;
      // Balance sheet always uses fb (point-in-time snapshot, not cumulative)
      const cash = fb(p.cash, bal.cashAndCashEquivalents);
      const stInv = fb(null, bal.shortTermInvestments);
      const stDebt = fb(p.shortTermDebt, bal.shortTermDebt ?? bal.currentDebt);
      const ltDebtBase = fb(p.longTermDebt, bal.longTermDebt);
      const totalDebtFallback = nv(bal.totalDebt);
      const ltDebt = ltDebtBase ?? (totalDebtFallback != null ? Math.max(totalDebtFallback - (stDebt ?? 0), 0) : null);
      const totalDebt = (stDebt != null || ltDebt != null) ? (stDebt ?? 0) + (ltDebt ?? 0) : null;
      const operatingIncome = useIS(p.operatingIncome, inc.operatingIncome);
      const dAndA = useIS(p.dAndA, cf.depreciationAndAmortization);
      return {
        ...p,
        revenue:         useIS(p.revenue, inc.revenue),
        costOfRevenue:   useIS(p.costOfRevenue, inc.costOfRevenue),
        grossProfit:     useIS(p.grossProfit, inc.grossProfit),
        rAndD:           useIS(p.rAndD, inc.researchAndDevelopmentExpenses),
        sgAndA:          useIS(p.sgAndA, inc.sellingGeneralAndAdministrativeExpenses),
        operatingIncome,
        ebitda:          useIS(p.ebitda, inc.ebitda) ?? (operatingIncome != null && dAndA != null ? operatingIncome + dAndA : null),
        ebit:            useIS(p.ebit, inc.ebit) ?? operatingIncome,
        interestExpense: useIS(p.interestExpense, inc.interestExpense),
        pretaxIncome:    useIS(p.pretaxIncome, inc.incomeBeforeTax),
        incomeTax:       useIS(p.incomeTax, inc.incomeTaxExpense),
        netIncome:       useIS(p.netIncome, inc.netIncome),
        epsDiluted:      useIS(p.epsDiluted, inc.epsDiluted),
        sbc:             useIS(p.sbc, cf.stockBasedCompensation),
        cash,
        cashAndShortTermInvestments: fb(p.cashAndShortTermInvestments, bal.cashAndShortTermInvestments) ?? ((cash != null || stInv != null) ? (cash ?? 0) + (stInv ?? 0) : null),
        currentAssets:   fb(p.currentAssets, bal.totalCurrentAssets),
        totalAssets:     fb(p.totalAssets, bal.totalAssets),
        currentLiabilities: fb(p.currentLiabilities, bal.totalCurrentLiabilities),
        shortTermDebt:   stDebt,
        longTermDebt:    ltDebt,
        netDebt:         fb(p.netDebt, bal.netDebt) ?? (totalDebt != null && cash != null ? totalDebt - cash : null),
        totalLiabilities: fb(p.totalLiabilities, bal.totalLiabilities),
        equity:          fb(p.equity, bal.totalStockholdersEquity),
        goodwill:        fb(p.goodwill, bal.goodwill),
        retainedEarnings: fb(p.retainedEarnings, bal.retainedEarnings),
        operatingCF:     useIS(p.operatingCF, cf.netCashProvidedByOperatingActivities ?? cf.operatingCashFlow),
        capex:           useISA(p.capex, cf.investmentsInPropertyPlantAndEquipment ?? cf.capitalExpenditure),
        investingCF:     useIS(p.investingCF, cf.netCashProvidedByInvestingActivities),
        financingCF:     useIS(p.financingCF, cf.netCashProvidedByFinancingActivities),
        dAndA,
        dividendsPaid:   useISA(p.dividendsPaid, cf.netDividendsPaid ?? cf.commonDividendsPaid),
        buybacks:        useISA(p.buybacks, cf.commonStockRepurchased),
        sharesDiluted:   useIS(p.sharesDiluted, inc.weightedAverageShsOutDil),
      };
    };

    if (freq === 'annual') {
      const { data } = await fh.get('/stock/financials-reported', {
        params: { symbol, freq: 'annual', token: FH_KEY },
      });
      const reports: Array<Record<string, unknown>> = Array.isArray(data?.data) ? data.data : [];
      const fhPeriods = reports.filter((r) => (r.quarter as number) === 0).slice(0, 6).map((r) => mapReport(r, 'annual'));
      // Check if any key fields are missing — if so, fetch FMP fallback
      const needsFallback = fhPeriods.length === 0 || fhPeriods.some(p => p.revenue == null && p.netIncome == null);
      if (needsFallback || fhPeriods.some(p => p.ebitda == null || p.netDebt == null)) {
        const fmpRows = await fetchFmpFallback('annual', 5);
        if (fhPeriods.length === 0) {
          // Build entirely from FMP
          return fmpRows.map(({ inc, bal, cf }) => {
            const yr = Number(String(inc.date).slice(0, 4));
            const empty: FinancialPeriod = { label: `FY ${yr}`, year: yr, quarter: 0, endDate: inc.date as string, revenue: null, costOfRevenue: null, grossProfit: null, rAndD: null, sgAndA: null, operatingIncome: null, ebitda: null, ebit: null, interestExpense: null, pretaxIncome: null, incomeTax: null, netIncome: null, epsDiluted: null, sbc: null, cash: null, cashAndShortTermInvestments: null, currentAssets: null, totalAssets: null, currentLiabilities: null, shortTermDebt: null, longTermDebt: null, netDebt: null, totalLiabilities: null, equity: null, goodwill: null, retainedEarnings: null, operatingCF: null, capex: null, investingCF: null, financingCF: null, dAndA: null, dividendsPaid: null, buybacks: null, sharesDiluted: null };
            return applyFmpFallback(empty, inc, bal, cf);
          });
        }
        // Merge FMP data as fallback for each period by matching year
        const fmpByYear = new Map(fmpRows.map(r => [Number(String(r.inc.date).slice(0, 4)), r]));
        return fhPeriods.map(p => {
          const row = fmpByYear.get(p.year);
          return row ? applyFmpFallback(p, row.inc, row.bal, row.cf) : p;
        });
      }
      return fhPeriods;
    }

    // Quarterly mode: fetch both 10-Qs and 10-Ks from Finnhub AND FMP quarterly in parallel.
    // Q4 has no 10-Q filing — compute it as: Q4 = Annual − Q1 − Q2 − Q3.
    // IMPORTANT: Finnhub 10-Q XBRL values are YTD cumulative; use FMP standalone values for Q4 subtraction.
    const [qRes, aRes, fmpRows] = await Promise.all([
      fh.get('/stock/financials-reported', { params: { symbol, freq: 'quarterly', token: FH_KEY } }),
      fh.get('/stock/financials-reported', { params: { symbol, freq: 'annual', token: FH_KEY } }),
      fetchFmpFallback('quarter', 5),
    ]);
    const allQ: Array<Record<string, unknown>> = Array.isArray(qRes.data?.data) ? qRes.data.data : [];
    const allA: Array<Record<string, unknown>> = Array.isArray(aRes.data?.data) ? aRes.data.data : [];

    const qPeriods = allQ.filter((r) => (r.quarter as number) !== 0).slice(0, 20).map((r) => mapReport(r, 'quarterly'));
    const aReports = allA.filter((r) => (r.quarter as number) === 0).slice(0, 6);

    // Build FMP lookup by end date (for Q4 computation and final override)
    const fmpByDate = new Map(fmpRows.map(r => [String(r.inc.date).slice(0, 10), r]));
    const fmpQuarterOf = (row: { inc: Record<string, unknown> }): number | null => {
      const raw = row.inc.period;
      if (typeof raw === 'number' && raw >= 1 && raw <= 4) return raw;
      if (typeof raw === 'string') {
        const match = raw.match(/Q([1-4])/i);
        if (match) return Number(match[1]);
      }
      return null;
    };
    const fmpYearOf = (row: { inc: Record<string, unknown> }): number | null => {
      const fromCalendarYear = Number(row.inc.calendarYear);
      if (Number.isFinite(fromCalendarYear)) return fromCalendarYear;
      const date = String(row.inc.date ?? '').slice(0, 10);
      const fromDate = Number(date.slice(0, 4));
      return Number.isFinite(fromDate) ? fromDate : null;
    };
    const findFmpRowForPeriod = (endDate: string, year: number, quarter: number) => {
      const exact = fmpByDate.get(endDate);
      if (exact) return exact;
      const byFiscalPeriod = fmpRows.find((row) => fmpYearOf(row) === year && fmpQuarterOf(row) === quarter);
      if (byFiscalPeriod) return byFiscalPeriod;
      const targetTs = new Date(endDate).getTime();
      const nearest = fmpRows
        .map((row) => ({ row, ts: new Date(String(row.inc.date ?? '')).getTime() }))
        .filter((entry) => Number.isFinite(entry.ts))
        .sort((a, b) => Math.abs(a.ts - targetTs) - Math.abs(b.ts - targetTs))[0];
      return nearest && Math.abs(nearest.ts - targetTs) <= 10 * 24 * 60 * 60_000 ? nearest.row : undefined;
    };

    // Helper: get a numeric IS/CF value from FMP row (returns null if missing)
    const fmpN = (row: { inc: Record<string, unknown>; cf: Record<string, unknown> } | undefined, incKey: string, cfKey?: string): number | null => {
      if (!row) return null;
      const v = row.inc[incKey] ?? (cfKey ? row.cf[cfKey] : undefined);
      if (v == null) return null;
      const n = Number(v);
      return isNaN(n) ? null : n;
    };
    const fmpAbs = (row: { inc: Record<string, unknown>; cf: Record<string, unknown> } | undefined, incKey: string, cfKey?: string): number | null => {
      const n = fmpN(row, incKey, cfKey);
      return n == null ? null : Math.abs(n);
    };

    // Subtract helper — returns null if any operand is null
    const sub = (a: number | null, ...qs: (number | null)[]): number | null => {
      if (a == null) return null;
      let s = a;
      for (const q of qs) { if (q == null) return null; s -= q; }
      return s;
    };

    const q4Periods: FinancialPeriod[] = [];
    for (const ar of aReports) {
      const yr = ar.year as number;
      const q1 = qPeriods.find((p) => p.year === yr && p.quarter === 1);
      const q2 = qPeriods.find((p) => p.year === yr && p.quarter === 2);
      const q3 = qPeriods.find((p) => p.year === yr && p.quarter === 3);
      if (!q1 || !q2 || !q3) continue;
      const ann = mapReport(ar, 'annual');

      // Use FMP standalone Q1/Q2/Q3 for subtraction — Finnhub 10-Q values are YTD cumulative, which
      // would produce a wrong (hugely negative) Q4 if used directly.
      const fmpQ1 = findFmpRowForPeriod(q1.endDate, yr, 1);
      const fmpQ2 = findFmpRowForPeriod(q2.endDate, yr, 2);
      const fmpQ3 = findFmpRowForPeriod(q3.endDate, yr, 3);
      // Also check if FMP has Q4 directly (same endDate as annual)
      const fmpQ4 = findFmpRowForPeriod(ann.endDate, yr, 4);

      // For each IS/CF field: prefer FMP Q4 direct value; fall back to Annual(FMP/Finnhub) - Q1 - Q2 - Q3(FMP standalone)
      const annFmp = findFmpRowForPeriod(ann.endDate, yr, 4); // may be same as fmpQ4 for some providers
      const q4Rev = fmpQ4 ? fmpN(fmpQ4, 'revenue') : sub(
        fmpN(annFmp, 'revenue') ?? ann.revenue,
        fmpN(fmpQ1, 'revenue') ?? q1.revenue,
        fmpN(fmpQ2, 'revenue') ?? q2.revenue,
        fmpN(fmpQ3, 'revenue') ?? q3.revenue,
      );

      // When FMP has all three quarters standalone → subtract each independently.
      // When FMP quarters are missing → Finnhub 10-Q values are YTD cumulative,
      // so Q3_ytd = Q1+Q2+Q3. Subtracting only Q3_ytd avoids double-counting.
      const hasFmpQ123 = fmpQ1 != null && fmpQ2 != null && fmpQ3 != null;

      const mkQ4IS = (annVal: number | null, fmpDirect: number | null | undefined, fmpAnnVal: number | null | undefined, q1v: number | null, q2v: number | null, q3v: number | null): number | null => {
        if (fmpDirect != null) return fmpDirect;
        const base = fmpAnnVal ?? annVal;
        // hasFmpQ123: FMP standalone quarters available → Annual - Q1 - Q2 - Q3
        // otherwise: Finnhub YTD → Annual - Q3_ytd (Q3_ytd already includes Q1+Q2+Q3)
        return hasFmpQ123 ? sub(base, q1v, q2v, q3v) : sub(base, q3v);
      };
      const mkQ4ISAbs = (annVal: number | null, fmpDirectAbs: number | null | undefined, fmpAnnAbs: number | null | undefined, q1v: number | null, q2v: number | null, q3v: number | null): number | null => {
        if (fmpDirectAbs != null) return fmpDirectAbs;
        const base = fmpAnnAbs ?? annVal;
        const result = hasFmpQ123 ? sub(base, q1v, q2v, q3v) : sub(base, q3v);
        return result == null ? null : Math.abs(result);
      };

      const fq1r = (k: string) => fmpN(fmpQ1, k) ?? (qPeriods.find(p => p.year === yr && p.quarter === 1) as unknown as Record<string, number | null>)[k];
      const fq2r = (k: string) => fmpN(fmpQ2, k) ?? (qPeriods.find(p => p.year === yr && p.quarter === 2) as unknown as Record<string, number | null>)[k];
      const fq3r = (k: string) => fmpN(fmpQ3, k) ?? (qPeriods.find(p => p.year === yr && p.quarter === 3) as unknown as Record<string, number | null>)[k];

      void q4Rev; // computed above for illustration — use mkQ4IS everywhere below
      q4Periods.push({
        label: `Q4'${String(yr).slice(2)}`,
        year: yr,
        quarter: 4,
        endDate: ann.endDate,
        // IS/CF: use FMP Q4 direct if available, else Annual - FMP_Q1 - FMP_Q2 - FMP_Q3 (standalone values)
        revenue:        mkQ4IS(ann.revenue,        fmpN(fmpQ4,'revenue'),        fmpN(annFmp,'revenue'),        fmpN(fmpQ1,'revenue')??q1.revenue,     fmpN(fmpQ2,'revenue')??q2.revenue,     fmpN(fmpQ3,'revenue')??q3.revenue),
        costOfRevenue:  mkQ4IS(ann.costOfRevenue,  fmpN(fmpQ4,'costOfRevenue'),  fmpN(annFmp,'costOfRevenue'),  fmpN(fmpQ1,'costOfRevenue')??q1.costOfRevenue,  fmpN(fmpQ2,'costOfRevenue')??q2.costOfRevenue,  fmpN(fmpQ3,'costOfRevenue')??q3.costOfRevenue),
        grossProfit:    mkQ4IS(ann.grossProfit,    fmpN(fmpQ4,'grossProfit'),    fmpN(annFmp,'grossProfit'),    fmpN(fmpQ1,'grossProfit')??q1.grossProfit,    fmpN(fmpQ2,'grossProfit')??q2.grossProfit,    fmpN(fmpQ3,'grossProfit')??q3.grossProfit),
        rAndD:          mkQ4IS(ann.rAndD,          fmpN(fmpQ4,'researchAndDevelopmentExpenses'), fmpN(annFmp,'researchAndDevelopmentExpenses'), fmpN(fmpQ1,'researchAndDevelopmentExpenses')??q1.rAndD, fmpN(fmpQ2,'researchAndDevelopmentExpenses')??q2.rAndD, fmpN(fmpQ3,'researchAndDevelopmentExpenses')??q3.rAndD),
        sgAndA:         mkQ4IS(ann.sgAndA,         fmpN(fmpQ4,'sellingGeneralAndAdministrativeExpenses'), fmpN(annFmp,'sellingGeneralAndAdministrativeExpenses'), fmpN(fmpQ1,'sellingGeneralAndAdministrativeExpenses')??q1.sgAndA, fmpN(fmpQ2,'sellingGeneralAndAdministrativeExpenses')??q2.sgAndA, fmpN(fmpQ3,'sellingGeneralAndAdministrativeExpenses')??q3.sgAndA),
        operatingIncome:mkQ4IS(ann.operatingIncome,fmpN(fmpQ4,'operatingIncome'),fmpN(annFmp,'operatingIncome'),fmpN(fmpQ1,'operatingIncome')??q1.operatingIncome, fmpN(fmpQ2,'operatingIncome')??q2.operatingIncome, fmpN(fmpQ3,'operatingIncome')??q3.operatingIncome),
        ebitda:         mkQ4IS(ann.ebitda,         fmpN(fmpQ4,'ebitda'),         fmpN(annFmp,'ebitda'),         fmpN(fmpQ1,'ebitda')??q1.ebitda,         fmpN(fmpQ2,'ebitda')??q2.ebitda,         fmpN(fmpQ3,'ebitda')??q3.ebitda),
        ebit:           mkQ4IS(ann.ebit,           fmpN(fmpQ4,'ebit'),           fmpN(annFmp,'ebit'),           fmpN(fmpQ1,'ebit')??q1.ebit,           fmpN(fmpQ2,'ebit')??q2.ebit,           fmpN(fmpQ3,'ebit')??q3.ebit),
        interestExpense:mkQ4IS(ann.interestExpense,fmpN(fmpQ4,'interestExpense'),fmpN(annFmp,'interestExpense'),fmpN(fmpQ1,'interestExpense')??q1.interestExpense, fmpN(fmpQ2,'interestExpense')??q2.interestExpense, fmpN(fmpQ3,'interestExpense')??q3.interestExpense),
        pretaxIncome:   mkQ4IS(ann.pretaxIncome,   fmpN(fmpQ4,'incomeBeforeTax'),fmpN(annFmp,'incomeBeforeTax'),fmpN(fmpQ1,'incomeBeforeTax')??q1.pretaxIncome,  fmpN(fmpQ2,'incomeBeforeTax')??q2.pretaxIncome,  fmpN(fmpQ3,'incomeBeforeTax')??q3.pretaxIncome),
        incomeTax:      mkQ4IS(ann.incomeTax,      fmpN(fmpQ4,'incomeTaxExpense'),fmpN(annFmp,'incomeTaxExpense'),fmpN(fmpQ1,'incomeTaxExpense')??q1.incomeTax,   fmpN(fmpQ2,'incomeTaxExpense')??q2.incomeTax,   fmpN(fmpQ3,'incomeTaxExpense')??q3.incomeTax),
        netIncome:      mkQ4IS(ann.netIncome,      fmpN(fmpQ4,'netIncome'),      fmpN(annFmp,'netIncome'),      fmpN(fmpQ1,'netIncome')??q1.netIncome,      fmpN(fmpQ2,'netIncome')??q2.netIncome,      fmpN(fmpQ3,'netIncome')??q3.netIncome),
        epsDiluted:     mkQ4IS(ann.epsDiluted,     fmpN(fmpQ4,'epsDiluted'),     fmpN(annFmp,'epsDiluted'),     fmpN(fmpQ1,'epsDiluted')??q1.epsDiluted,     fmpN(fmpQ2,'epsDiluted')??q2.epsDiluted,     fmpN(fmpQ3,'epsDiluted')??q3.epsDiluted),
        sbc:            mkQ4IS(ann.sbc,            fmpN(fmpQ4,'stockBasedCompensation',    'stockBasedCompensation'), fmpN(annFmp,'stockBasedCompensation','stockBasedCompensation'), fmpAbs(fmpQ1,'stockBasedCompensation')??q1.sbc, fmpAbs(fmpQ2,'stockBasedCompensation')??q2.sbc, fmpAbs(fmpQ3,'stockBasedCompensation')??q3.sbc),
        operatingCF:    mkQ4IS(ann.operatingCF,    fmpN(fmpQ4,'netCashProvidedByOperatingActivities', 'operatingCashFlow'), fmpN(annFmp,'netCashProvidedByOperatingActivities', 'operatingCashFlow'), fmpN(fmpQ1,'netCashProvidedByOperatingActivities', 'operatingCashFlow')??q1.operatingCF, fmpN(fmpQ2,'netCashProvidedByOperatingActivities', 'operatingCashFlow')??q2.operatingCF, fmpN(fmpQ3,'netCashProvidedByOperatingActivities', 'operatingCashFlow')??q3.operatingCF),
        capex:          mkQ4ISAbs(ann.capex,       fmpAbs(fmpQ4,'investmentsInPropertyPlantAndEquipment', 'capitalExpenditure'), fmpAbs(annFmp,'investmentsInPropertyPlantAndEquipment', 'capitalExpenditure'), fmpAbs(fmpQ1,'investmentsInPropertyPlantAndEquipment', 'capitalExpenditure')??q1.capex, fmpAbs(fmpQ2,'investmentsInPropertyPlantAndEquipment', 'capitalExpenditure')??q2.capex, fmpAbs(fmpQ3,'investmentsInPropertyPlantAndEquipment', 'capitalExpenditure')??q3.capex),
        investingCF:    mkQ4IS(ann.investingCF,    fmpN(fmpQ4,'netCashProvidedByInvestingActivities', 'netCashUsedForInvestingActivites'), fmpN(annFmp,'netCashProvidedByInvestingActivities', 'netCashUsedForInvestingActivites'), fmpN(fmpQ1,'netCashProvidedByInvestingActivities', 'netCashUsedForInvestingActivites')??q1.investingCF, fmpN(fmpQ2,'netCashProvidedByInvestingActivities', 'netCashUsedForInvestingActivites')??q2.investingCF, fmpN(fmpQ3,'netCashProvidedByInvestingActivities', 'netCashUsedForInvestingActivites')??q3.investingCF),
        financingCF:    mkQ4IS(ann.financingCF,    fmpN(fmpQ4,'netCashProvidedByFinancingActivities', 'netCashUsedProvidedByFinancingActivities'), fmpN(annFmp,'netCashProvidedByFinancingActivities', 'netCashUsedProvidedByFinancingActivities'), fmpN(fmpQ1,'netCashProvidedByFinancingActivities', 'netCashUsedProvidedByFinancingActivities')??q1.financingCF, fmpN(fmpQ2,'netCashProvidedByFinancingActivities', 'netCashUsedProvidedByFinancingActivities')??q2.financingCF, fmpN(fmpQ3,'netCashProvidedByFinancingActivities', 'netCashUsedProvidedByFinancingActivities')??q3.financingCF),
        dAndA:          mkQ4IS(ann.dAndA,          fmpN(fmpQ4,'depreciationAndAmortization', 'depreciationAndAmortization'), fmpN(annFmp,'depreciationAndAmortization', 'depreciationAndAmortization'), fmpN(fmpQ1,'depreciationAndAmortization', 'depreciationAndAmortization')??q1.dAndA, fmpN(fmpQ2,'depreciationAndAmortization', 'depreciationAndAmortization')??q2.dAndA, fmpN(fmpQ3,'depreciationAndAmortization', 'depreciationAndAmortization')??q3.dAndA),
        dividendsPaid:  mkQ4ISAbs(ann.dividendsPaid, fmpAbs(fmpQ4,'netDividendsPaid', 'commonDividendsPaid'), fmpAbs(annFmp,'netDividendsPaid', 'commonDividendsPaid'), fmpAbs(fmpQ1,'netDividendsPaid', 'commonDividendsPaid')??q1.dividendsPaid, fmpAbs(fmpQ2,'netDividendsPaid', 'commonDividendsPaid')??q2.dividendsPaid, fmpAbs(fmpQ3,'netDividendsPaid', 'commonDividendsPaid')??q3.dividendsPaid),
        buybacks:       mkQ4ISAbs(ann.buybacks,    fmpAbs(fmpQ4,'commonStockRepurchased'), fmpAbs(annFmp,'commonStockRepurchased'), fmpAbs(fmpQ1,'commonStockRepurchased')??q1.buybacks, fmpAbs(fmpQ2,'commonStockRepurchased')??q2.buybacks, fmpAbs(fmpQ3,'commonStockRepurchased')??q3.buybacks),
        // Balance sheet: point-in-time snapshot from 10-K (fiscal year-end)
        cash: ann.cash,
        cashAndShortTermInvestments: ann.cashAndShortTermInvestments,
        currentAssets: ann.currentAssets,
        totalAssets: ann.totalAssets,
        currentLiabilities: ann.currentLiabilities,
        shortTermDebt: ann.shortTermDebt,
        longTermDebt: ann.longTermDebt,
        netDebt: ann.netDebt,
        totalLiabilities: ann.totalLiabilities,
        equity: ann.equity,
        goodwill: ann.goodwill,
        retainedEarnings: ann.retainedEarnings,
        sharesDiluted: ann.sharesDiluted,
      });
      void fq1r; void fq2r; void fq3r; // suppress unused warning
    }

    const allPeriods = [...qPeriods, ...q4Periods];
    allPeriods.sort((a, b) => b.year !== a.year ? b.year - a.year : b.quarter - a.quarter);
    const sorted = allPeriods.slice(0, 20);

    // Apply FMP with preferFmpIS = true for Q1/Q2/Q3 (overrides YTD Finnhub values).
    // Q4 IS/CF already uses FMP standalone values from the subtraction above.
    return sorted.map(p => {
      if (p.quarter === 4) return p; // Q4 already built from FMP data above
      const row = findFmpRowForPeriod(p.endDate, p.year, p.quarter);
      return row ? applyFmpFallback(p, row.inc, row.bal, row.cf, true) : p;
    });
  } catch {
    return [];
  }
};

export interface AnalystConsensus {
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  consensus: string;
}

export interface AnalystHistorical {
  date: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export interface PriceTargetConsensus {
  targetHigh: number;
  targetLow: number;
  targetConsensus: number;
  targetMedian: number;
}

export const getAnalystData = async (symbol: string): Promise<{
  consensus: AnalystConsensus | null;
  historical: AnalystHistorical[];
  priceTargetConsensus: PriceTargetConsensus | null;
}> => {
  const key = `${symbol}:analyst`;
  const mem = cacheGet<{ consensus: AnalystConsensus | null; historical: AnalystHistorical[]; priceTargetConsensus: PriceTargetConsensus | null }>(key);
  if (mem !== undefined) return mem;
  const persisted = await persistGet<{ consensus: AnalystConsensus | null; historical: AnalystHistorical[]; priceTargetConsensus: PriceTargetConsensus | null }>(key);
  if (persisted !== undefined) { cacheSet(key, persisted, TTL.analyst); return persisted; }
  const result = await _getAnalystData(symbol);
  cacheSet(key, result, TTL.analyst);
  persistSet(key, result, TTL.analyst);
  return result;
};

async function _getAnalystData(symbol: string): Promise<{
  consensus: AnalystConsensus | null;
  historical: AnalystHistorical[];
  priceTargetConsensus: PriceTargetConsensus | null;
}> {
  // Finnhub-first for all endpoints
  const [fhRecRes, fhPtRes] = await Promise.all([
    fh.get('/stock/recommendation', { params: { symbol, token: FH_KEY } }).catch(() => ({ data: [] })),
    fh.get('/stock/price-target', { params: { symbol, token: FH_KEY } }).catch(() => ({ data: {} })),
  ]);

  const fhRecArr: Record<string, unknown>[] = Array.isArray(fhRecRes.data) ? fhRecRes.data : [];

  // ── Consensus: Finnhub first, FMP fallback ─────────────────────────────────
  let consensus: AnalystConsensus | null = null;
  if (fhRecArr.length > 0) {
    const r = fhRecArr[0];
    const sb = Number(r.strongBuy) || 0;
    const b = Number(r.buy) || 0;
    const h = Number(r.hold) || 0;
    const s = Number(r.sell) || 0;
    const ss = Number(r.strongSell) || 0;
    const total = sb + b + h + s + ss;
    let label = 'Hold';
    if (total > 0) {
      const score = (sb * 2 + b * 1 + h * 0 + s * -1 + ss * -2) / total;
      if (score > 1) label = 'Strong Buy';
      else if (score > 0.3) label = 'Buy';
      else if (score > -0.3) label = 'Hold';
      else if (score > -1) label = 'Sell';
      else label = 'Strong Sell';
    }
    consensus = { strongBuy: sb, buy: b, hold: h, sell: s, strongSell: ss, consensus: label };
  }
  if (!consensus) {
    try {
      const { data } = await fmp.get('/stable/grades-consensus', { params: { symbol, apikey: FMP_KEY } });
      const arr = Array.isArray(data) ? data : [];
      if (arr[0]) {
        consensus = {
          strongBuy: Number(arr[0].strongBuy) || 0,
          buy: Number(arr[0].buy) || 0,
          hold: Number(arr[0].hold) || 0,
          sell: Number(arr[0].sell) || 0,
          strongSell: Number(arr[0].strongSell) || 0,
          consensus: String(arr[0].consensus ?? ''),
        };
      }
    } catch { /* ignore */ }
  }

  // ── Historical: Finnhub first (monthly array), FMP fallback ───────────────
  let historical: AnalystHistorical[] = fhRecArr.length > 0
    ? fhRecArr.slice(0, 5).reverse().map((r) => ({
        date: String(r.period ?? '').slice(0, 10),
        strongBuy: Number(r.strongBuy) || 0,
        buy: Number(r.buy) || 0,
        hold: Number(r.hold) || 0,
        sell: Number(r.sell) || 0,
        strongSell: Number(r.strongSell) || 0,
      }))
    : [];
  if (historical.length === 0) {
    try {
      const { data } = await fmp.get('/stable/grades-historical', { params: { symbol, limit: 5, apikey: FMP_KEY } });
      historical = Array.isArray(data)
        ? (data as Record<string, unknown>[]).reverse().map((h) => ({
            date: h.date as string,
            strongBuy: Number(h.analystRatingsStrongBuy) || 0,
            buy: Number(h.analystRatingsBuy) || 0,
            hold: Number(h.analystRatingsHold) || 0,
            sell: Number(h.analystRatingsSell) || 0,
            strongSell: Number(h.analystRatingsStrongSell) || 0,
          }))
        : [];
    } catch { /* ignore */ }
  }

  // ── Price Target Consensus: Finnhub first, FMP fallback ───────────────────
  const fhPt = fhPtRes.data as Record<string, unknown>;
  let priceTargetConsensus: PriceTargetConsensus | null = null;
  if (fhPt && Number(fhPt.targetMean) > 0) {
    priceTargetConsensus = {
      targetHigh: Number(fhPt.targetHigh) || 0,
      targetLow: Number(fhPt.targetLow) || 0,
      targetConsensus: Number(fhPt.targetMean) || 0,
      targetMedian: Number(fhPt.targetMedian) || Number(fhPt.targetMean) || 0,
    };
  }
  if (!priceTargetConsensus) {
    try {
      const { data } = await fmp.get('/stable/price-target-consensus', { params: { symbol, apikey: FMP_KEY } });
      const arr = Array.isArray(data) ? data : [];
      if (arr[0]) {
        priceTargetConsensus = {
          targetHigh: Number(arr[0].targetHigh) || 0,
          targetLow: Number(arr[0].targetLow) || 0,
          targetConsensus: Number(arr[0].targetConsensus) || 0,
          targetMedian: Number(arr[0].targetMedian) || 0,
        };
      }
    } catch { /* ignore */ }
  }

  return { consensus, historical, priceTargetConsensus };
};

export interface InsiderTransaction {
  date: string;
  name: string;
  role: string;
  type: 'buy' | 'sell' | 'other';
  shares: number;
  value: number;
  price: number;
}

// Fetch officer title from SEC Form 4 XML using the Finnhub accession-number id
const fetchForm4Title = async (accession: string): Promise<string> => {
  try {
    const cik = accession.split('-')[0].replace(/^0+/, '');
    const accNodash = accession.replace(/-/g, '');
    const dirUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNodash}/`;
    const dirRes = await axios.get(dirUrl, {
      headers: { 'User-Agent': 'portfolio-app contact@myapp.com' },
      timeout: 5000,
    });
    const html: string = typeof dirRes.data === 'string' ? dirRes.data : '';
    // Find XML files at folder root (exclude xslF345X06/... subdirectory paths)
    const xmlFiles = [...html.matchAll(/\/Archives\/edgar\/data\/\d+\/\d+\/([^/\s"<>]+\.xml)/g)]
      .map(m => m[1]);
    for (const xf of xmlFiles) {
      const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNodash}/${xf}`;
      const xmlRes = await axios.get(xmlUrl, {
        headers: { 'User-Agent': 'portfolio-app contact@myapp.com' },
        timeout: 5000,
      });
      const xml: string = typeof xmlRes.data === 'string' ? xmlRes.data : '';
      const titleMatch = xml.match(/<officerTitle>([^<]+)</);
      if (titleMatch) return titleMatch[1].trim();
      if (/<isDirector>1</.test(xml)) return 'Director';
      if (/<isTenPercentOwner>1</.test(xml)) return '10% Owner';
    }
    return '';
  } catch {
    return '';
  }
};

export const getInsiderTransactions = async (symbol: string): Promise<InsiderTransaction[]> => {
  const key = `${symbol}:insider`;
  const mem = cacheGet<InsiderTransaction[]>(key);
  if (mem !== undefined) return mem;
  const persisted = await persistGet<InsiderTransaction[]>(key);
  if (persisted !== undefined) { cacheSet(key, persisted, TTL.insider); return persisted; }
  const result = await _getInsiderTransactions(symbol);
  if (result.length > 0) {
    cacheSet(key, result, TTL.insider);
    persistSet(key, result, TTL.insider);
  }
  return result;
};

async function _getInsiderTransactions(symbol: string): Promise<InsiderTransaction[]> {
  // Finnhub first
  try {
    const { data } = await fh.get('/stock/insider-transactions', {
      params: { symbol, token: FH_KEY },
    });
    const arr: Record<string, unknown>[] = Array.isArray(data?.data) ? data.data : [];
    const rawResults = arr.slice(0, 50).map((t) => {
      const code = String(t.transactionCode ?? '').toUpperCase();
      const shares = Math.abs(Number(t.change) || 0);
      const price = Number(t.transactionPrice) || 0;
      const rawValue = Math.abs(Number(t.value) || 0);
      return {
        id: String(t.id ?? ''),
        date: String(t.transactionDate ?? ''),
        name: String(t.name ?? ''),
        role: '',
        type: (code === 'P' ? 'buy' : code === 'S' ? 'sell' : 'other') as 'buy' | 'sell' | 'other',
        shares,
        value: rawValue > 0 ? rawValue : shares * price,
        price,
      };
    }).filter(t => t.type !== 'other' && t.shares > 0);

    if (rawResults.length > 0) {
      // Fetch titles for unique insiders in parallel (one Form 4 per unique name)
      const nameToId = new Map<string, string>();
      for (const t of rawResults) {
        if (t.id && !nameToId.has(t.name)) nameToId.set(t.name, t.id);
      }
      const titleEntries = await Promise.all(
        Array.from(nameToId.entries()).map(async ([name, id]) => {
          const title = await fetchForm4Title(id);
          return [name, title] as [string, string];
        })
      );
      const titleMap = Object.fromEntries(titleEntries);
      return rawResults.map(({ id: _id, ...t }): InsiderTransaction => ({
        ...t,
        role: titleMap[t.name] ?? '',
      }));
    }
  } catch { /* fallthrough */ }

  // FMP fallback
  try {
    const { data } = await fmp.get('/stable/insider-trading', {
      params: { symbol, limit: 50, apikey: FMP_KEY },
    });
    if (Array.isArray(data) && data.length > 0) {
      return data.map((t: Record<string, unknown>): InsiderTransaction => {
        const txType = String(t.transactionType ?? '').toLowerCase();
        const shares = Math.abs(Number(t.securitiesTransacted) || 0);
        const price = Number(t.price) || 0;
        const isBuy = txType.includes('purchase') || txType === 'p' || txType === 'buy';
        const isSell = txType.includes('sale') || txType === 's' || txType === 'sell';
        return {
          date: String(t.date ?? t.transactionDate ?? ''),
          name: String(t.reportingName ?? t.insiderName ?? ''),
          role: String(t.typeOfOwner ?? ''),
          type: isBuy ? 'buy' : isSell ? 'sell' : 'other',
          shares,
          value: shares * price || Math.abs(Number(t.securitiesValue) || 0),
          price,
        };
      }).filter(t => t.type !== 'other' && t.shares > 0);
    }
  } catch { /* ignore */ }

  return [];
};

// ── Trump / Truth Social feed ──────────────────────────────────────────────────
export interface TrumpPost {
  id: string;
  content: string;       // plain text (HTML stripped)
  createdAt: string;     // ISO 8601
  url: string;
  isReblog: boolean;
}

/** Strip HTML tags */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const getTrumpPosts = async (): Promise<TrumpPost[]> => {
  const { data } = await axios.get('/api/trump-feed', {
    timeout: 10000,
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
    responseType: 'text',
  });

  // Parse RSS XML
  const items: TrumpPost[] = [];
  const itemMatches = (data as string).match(/<item>[\s\S]*?<\/item>/g) ?? [];

  for (const item of itemMatches) {
    const getTag = (tag: string) => {
      const m = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? (m[1] ?? m[2] ?? '').trim() : '';
    };
    const getAttr = (tag: string) => {
      const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? m[1].trim() : '';
    };

    const description = getTag('description');
    const title = getTag('title');
    const pubDate = getTag('pubDate');
    const guid = getTag('guid');
    const originalUrl = getAttr('truth:originalUrl');

    const content = stripHtml(description || title);
    if (!content) continue;

    items.push({
      id: guid || originalUrl || String(items.length),
      content,
      createdAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      url: originalUrl || guid || '',
      isReblog: title.startsWith('RT '),
    });
  }

  return items;
};

// ─── Sector benchmark table for relative valuation ───────────────────────────
// Sources: Damodaran (NYU) annual dataset, FactSet sector aggregates
// Values represent typical/median ranges for healthy companies in each sector
interface SectorBenchmark {
  label: string;             // display name
  peMedian: number;          // typical trailing P/E
  peHigh: number;            // 75th pct — above this = expensive
  peLow: number;             // 25th pct — below this = cheap
  evEbitdaMedian: number;
  grossMarginTypical: number; // as decimal
  opMarginTypical: number;
  revenueGrowthTypical: number;
  debtEbitdaComfort: number; // max comfortable Debt/EBITDA
}

const SECTOR_BENCHMARKS: Record<string, SectorBenchmark> = {
  'Technology': { label: 'Technology', peMedian: 28, peHigh: 45, peLow: 18, evEbitdaMedian: 22, grossMarginTypical: 0.62, opMarginTypical: 0.20, revenueGrowthTypical: 0.12, debtEbitdaComfort: 2.0 },
  'Communication Services': { label: 'Communication Services', peMedian: 22, peHigh: 35, peLow: 14, evEbitdaMedian: 14, grossMarginTypical: 0.55, opMarginTypical: 0.18, revenueGrowthTypical: 0.08, debtEbitdaComfort: 3.0 },
  'Consumer Cyclical': { label: 'Consumer Cyclical', peMedian: 20, peHigh: 32, peLow: 13, evEbitdaMedian: 12, grossMarginTypical: 0.38, opMarginTypical: 0.10, revenueGrowthTypical: 0.07, debtEbitdaComfort: 2.5 },
  'Consumer Defensive': { label: 'Consumer Defensive', peMedian: 19, peHigh: 26, peLow: 14, evEbitdaMedian: 13, grossMarginTypical: 0.35, opMarginTypical: 0.12, revenueGrowthTypical: 0.05, debtEbitdaComfort: 2.0 },
  'Healthcare': { label: 'Healthcare', peMedian: 22, peHigh: 38, peLow: 14, evEbitdaMedian: 16, grossMarginTypical: 0.55, opMarginTypical: 0.15, revenueGrowthTypical: 0.08, debtEbitdaComfort: 2.0 },
  'Financial Services': { label: 'Financial Services', peMedian: 13, peHigh: 18, peLow: 9, evEbitdaMedian: 10, grossMarginTypical: 0.60, opMarginTypical: 0.28, revenueGrowthTypical: 0.06, debtEbitdaComfort: 6.0 },
  'Industrials': { label: 'Industrials', peMedian: 20, peHigh: 28, peLow: 13, evEbitdaMedian: 13, grossMarginTypical: 0.33, opMarginTypical: 0.12, revenueGrowthTypical: 0.06, debtEbitdaComfort: 2.5 },
  'Basic Materials': { label: 'Basic Materials', peMedian: 14, peHigh: 22, peLow: 9, evEbitdaMedian: 8, grossMarginTypical: 0.28, opMarginTypical: 0.14, revenueGrowthTypical: 0.05, debtEbitdaComfort: 2.0 },
  'Energy': { label: 'Energy', peMedian: 12, peHigh: 18, peLow: 7, evEbitdaMedian: 7, grossMarginTypical: 0.30, opMarginTypical: 0.16, revenueGrowthTypical: 0.04, debtEbitdaComfort: 2.0 },
  'Real Estate': { label: 'Real Estate', peMedian: 30, peHigh: 45, peLow: 20, evEbitdaMedian: 20, grossMarginTypical: 0.55, opMarginTypical: 0.30, revenueGrowthTypical: 0.05, debtEbitdaComfort: 7.0 },
  'Utilities': { label: 'Utilities', peMedian: 16, peHigh: 22, peLow: 12, evEbitdaMedian: 10, grossMarginTypical: 0.40, opMarginTypical: 0.18, revenueGrowthTypical: 0.03, debtEbitdaComfort: 4.5 },
};

// Industry overrides for sub-sectors that differ significantly from the parent
const INDUSTRY_OVERRIDES: Record<string, Partial<SectorBenchmark>> = {
  'Software—Application':        { peMedian: 35, peHigh: 60, peLow: 22, evEbitdaMedian: 28, grossMarginTypical: 0.72, opMarginTypical: 0.18 },
  'Software—Infrastructure':     { peMedian: 38, peHigh: 65, peLow: 24, evEbitdaMedian: 30, grossMarginTypical: 0.74, opMarginTypical: 0.20 },
  'Semiconductor':               { peMedian: 26, peHigh: 42, peLow: 16, evEbitdaMedian: 20, grossMarginTypical: 0.52, opMarginTypical: 0.22 },
  'Internet Content & Information': { peMedian: 30, peHigh: 50, peLow: 18, evEbitdaMedian: 22, grossMarginTypical: 0.70, opMarginTypical: 0.25 },
  'Biotechnology':               { peMedian: 40, peHigh: 80, peLow: 20, evEbitdaMedian: 30, grossMarginTypical: 0.75, opMarginTypical: 0.05 },
  'Drug Manufacturers—General': { peMedian: 18, peHigh: 28, peLow: 12, evEbitdaMedian: 14, grossMarginTypical: 0.65, opMarginTypical: 0.22 },
  'Banks—Diversified':           { peMedian: 11, peHigh: 15, peLow: 7,  evEbitdaMedian: 8,  grossMarginTypical: 0.65, opMarginTypical: 0.30 },
  'Insurance':                   { peMedian: 14, peHigh: 20, peLow: 9,  evEbitdaMedian: 9,  grossMarginTypical: 0.30, opMarginTypical: 0.12 },
  'Oil & Gas E&P':               { peMedian: 10, peHigh: 16, peLow: 6,  evEbitdaMedian: 5,  grossMarginTypical: 0.40, opMarginTypical: 0.20 },
  'Specialty Retail':            { peMedian: 18, peHigh: 28, peLow: 11, evEbitdaMedian: 10, grossMarginTypical: 0.32, opMarginTypical: 0.09 },
  'Auto Manufacturers':          { peMedian: 10, peHigh: 16, peLow: 6,  evEbitdaMedian: 7,  grossMarginTypical: 0.15, opMarginTypical: 0.05 },
  'Aerospace & Defense':         { peMedian: 22, peHigh: 32, peLow: 14, evEbitdaMedian: 14, grossMarginTypical: 0.20, opMarginTypical: 0.10 },
};

function getSectorBenchmark(sector: string | null, industry: string | null): SectorBenchmark | null {
  const base = sector ? SECTOR_BENCHMARKS[sector] ?? null : null;
  if (!base) return null;
  // Apply industry override if available
  const override = industry ? INDUSTRY_OVERRIDES[industry] ?? null : null;
  if (!override) return base;
  return { ...base, ...override };
}

// ─── Groq Scenario Generator (Bull / Base / Bear) ────────────────────────────

export interface ScenarioItem {
  driver: string;
  evidence: string[];
  confidence: number;
}
export interface Scenario {
  probability: number;
  priceTarget: number | null;
  items: ScenarioItem[];
}
export interface ScenarioProbabilityFactor {
  label: string;
  bullDelta: number;
  baseDelta: number;
  bearDelta: number;
  note?: string;
}
export interface ScenarioProbabilityMath {
  bullScore: number;
  baseScore: number;
  bearScore: number;
  totalScore: number;
  bullProbability: number;
  baseProbability: number;
  bearProbability: number;
  factors: ScenarioProbabilityFactor[];
}
export interface ScenarioResult {
  bull: Scenario;
  base: Scenario;
  bear: Scenario;
  expectedValue: number | null;  // weighted EV = P_bull×PT_bull + P_base×PT_base + P_bear×PT_bear
  operatingLeverage: number | null; // DOL estimate for context
  probabilityMath?: ScenarioProbabilityMath;
}

export async function generateScenarios(
  apiKey: string,
  symbol: string,
  name: string,
  f: Fundamentals,
  currentPrice: number,
  currency: string,
): Promise<ScenarioResult> {
  const fmt = (v: number | null | undefined, suffix = '') =>
    v == null ? 'N/A' : `${v.toFixed(2)}${suffix}`;
  const fmtB = (v: number | null | undefined) => {
    if (v == null) return 'N/A';
    if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    return v.toFixed(0);
  };
  const fmtPct = (v: number | null | undefined) => v == null ? 'N/A' : `${(v * 100).toFixed(1)}%`;

  // ── Sector benchmark context ──────────────────────────────────────────────
  const bench = getSectorBenchmark(f.sector, f.industry);

  // ── Deterministic probability scoring (JS math, not LLM guessing) ─────────
  let bullScore = 20;
  let bearScore = 20;
  const baseScore = 30; // constant floor for base
  const probabilityFactors: ScenarioProbabilityFactor[] = [
    { label: 'Base floor', bullDelta: 20, baseDelta: 30, bearDelta: 20, note: 'Pontuação inicial antes dos ajustes por métricas.' },
  ];
  const pushFactor = (label: string, bullDelta: number, bearDelta: number, note?: string, baseDelta = 0) => {
    if (bullDelta === 0 && bearDelta === 0 && baseDelta === 0) return;
    probabilityFactors.push({ label, bullDelta, baseDelta, bearDelta, note });
  };

  // Revenue growth — scored relative to sector typical if available
  const rev = f.revenueGrowth ?? null;
  const revTypical = bench?.revenueGrowthTypical ?? 0.07;
  if (rev !== null) {
    if (rev > revTypical * 2.5) { bullScore += 15; pushFactor('Revenue growth', 15, 0, `${fmtPct(rev)} vs típico ${fmtPct(revTypical)}`); }
    else if (rev > revTypical * 1.5) { bullScore += 8; pushFactor('Revenue growth', 8, 0, `${fmtPct(rev)} vs típico ${fmtPct(revTypical)}`); }
    else if (rev > revTypical * 0.8) { bullScore += 3; pushFactor('Revenue growth', 3, 0, `${fmtPct(rev)} vs típico ${fmtPct(revTypical)}`); }
    else if (rev < 0) { bearScore += 15; pushFactor('Revenue growth', 0, 15, `${fmtPct(rev)} vs típico ${fmtPct(revTypical)}`); }
    else if (rev < revTypical * 0.3) { bearScore += 5; pushFactor('Revenue growth', 0, 5, `${fmtPct(rev)} vs típico ${fmtPct(revTypical)}`); }
  }

  // Earnings growth
  const earn = f.earningsGrowth ?? null;
  if (earn !== null) {
    if (earn > 0.20) { bullScore += 12; pushFactor('Earnings growth', 12, 0, fmtPct(earn)); }
    else if (earn > 0.10) { bullScore += 6; pushFactor('Earnings growth', 6, 0, fmtPct(earn)); }
    else if (earn < -0.20) { bearScore += 14; pushFactor('Earnings growth', 0, 14, fmtPct(earn)); }
    else if (earn < 0) { bearScore += 7; pushFactor('Earnings growth', 0, 7, fmtPct(earn)); }
  }

  // Forward vs trailing EPS (earnings momentum)
  if (f.forwardEps != null && f.trailingEps != null && f.trailingEps > 0) {
    const epsGrowth = (f.forwardEps - f.trailingEps) / f.trailingEps;
    if (epsGrowth > 0.15) { bullScore += 10; pushFactor('Forward EPS momentum', 10, 0, fmtPct(epsGrowth)); }
    else if (epsGrowth > 0.05) { bullScore += 5; pushFactor('Forward EPS momentum', 5, 0, fmtPct(epsGrowth)); }
    else if (epsGrowth < -0.10) { bearScore += 10; pushFactor('Forward EPS momentum', 0, 10, fmtPct(epsGrowth)); }
    else if (epsGrowth < 0) { bearScore += 5; pushFactor('Forward EPS momentum', 0, 5, fmtPct(epsGrowth)); }
  }

  // Valuation — scored relative to sector median P/E
  const pe = f.trailingPE ?? null;
  const peMedian = bench?.peMedian ?? 20;
  const peHigh   = bench?.peHigh   ?? 35;
  const peLow    = bench?.peLow    ?? 12;
  if (pe !== null && pe > 0) {
    if (pe < peLow * 0.85) { bullScore += 12; pushFactor('Valuation vs sector P/E', 12, 0, `${fmt(pe)}x vs mediana ${fmt(peMedian)}x`); }
    else if (pe < peMedian) { bullScore += 6; pushFactor('Valuation vs sector P/E', 6, 0, `${fmt(pe)}x vs mediana ${fmt(peMedian)}x`); }
    else if (pe > peHigh * 1.3) { bearScore += 12; pushFactor('Valuation vs sector P/E', 0, 12, `${fmt(pe)}x vs mediana ${fmt(peMedian)}x`); }
    else if (pe > peHigh) { bearScore += 6; pushFactor('Valuation vs sector P/E', 0, 6, `${fmt(pe)}x vs mediana ${fmt(peMedian)}x`); }
  }

  // Debt/EBITDA — scored relative to sector comfort level
  const debtComfort = bench?.debtEbitdaComfort ?? 2.5;
  if (f.totalDebt != null && f.ebitda != null && f.ebitda > 0) {
    const debtRatio = f.totalDebt / f.ebitda;
    if (debtRatio < debtComfort * 0.3) { bullScore += 8; pushFactor('Debt / EBITDA', 8, 0, `${fmt(debtRatio)}x vs conforto ${fmt(debtComfort)}x`); }
    else if (debtRatio < debtComfort * 0.7) { bullScore += 3; pushFactor('Debt / EBITDA', 3, 0, `${fmt(debtRatio)}x vs conforto ${fmt(debtComfort)}x`); }
    else if (debtRatio > debtComfort * 1.8) { bearScore += 12; pushFactor('Debt / EBITDA', 0, 12, `${fmt(debtRatio)}x vs conforto ${fmt(debtComfort)}x`); }
    else if (debtRatio > debtComfort * 1.2) { bearScore += 6; pushFactor('Debt / EBITDA', 0, 6, `${fmt(debtRatio)}x vs conforto ${fmt(debtComfort)}x`); }
  }

  // Operating margin — scored relative to sector typical
  const opM = f.operatingMargins ?? null;
  const opMarginTypical = bench?.opMarginTypical ?? 0.12;
  if (opM !== null) {
    if (opM > opMarginTypical * 1.6) { bullScore += 8; pushFactor('Operating margin', 8, 0, `${fmtPct(opM)} vs típico ${fmtPct(opMarginTypical)}`); }
    else if (opM > opMarginTypical) { bullScore += 4; pushFactor('Operating margin', 4, 0, `${fmtPct(opM)} vs típico ${fmtPct(opMarginTypical)}`); }
    else if (opM < 0) { bearScore += 12; pushFactor('Operating margin', 0, 12, `${fmtPct(opM)} vs típico ${fmtPct(opMarginTypical)}`); }
    else if (opM < opMarginTypical * 0.4) { bearScore += 5; pushFactor('Operating margin', 0, 5, `${fmtPct(opM)} vs típico ${fmtPct(opMarginTypical)}`); }
  }

  // 52W position (price momentum signal)
  if (f.fiftyTwoWeekHigh != null && f.fiftyTwoWeekHigh > 0) {
    const fromHigh = (currentPrice / f.fiftyTwoWeekHigh - 1);
    if (fromHigh > -0.08) { bullScore += 5; pushFactor('52W momentum', 5, 0, `${(fromHigh * 100).toFixed(1)}% from 52W high`); }
    else if (fromHigh < -0.35) { bearScore += 6; pushFactor('52W momentum', 0, 6, `${(fromHigh * 100).toFixed(1)}% from 52W high`); }
  }

  // ROE
  if (f.returnOnEquity != null) {
    if (f.returnOnEquity > 0.25) { bullScore += 5; pushFactor('ROE', 5, 0, fmtPct(f.returnOnEquity)); }
    else if (f.returnOnEquity < 0) { bearScore += 5; pushFactor('ROE', 0, 5, fmtPct(f.returnOnEquity)); }
  }

  // Normalize to fixed probabilities
  const total = bullScore + bearScore + baseScore;
  let bullProb = Math.round((bullScore / total) * 100);
  let bearProb = Math.round((bearScore / total) * 100);
  let baseProb = 100 - bullProb - bearProb;

  // Clamp: each scenario must be at least 10% and at most 65%
  bullProb = Math.max(10, Math.min(65, bullProb));
  bearProb = Math.max(10, Math.min(65, bearProb));
  baseProb = 100 - bullProb - bearProb;
  if (baseProb < 10) {
    const excess = 10 - baseProb;
    baseProb = 10;
    if (bullProb > bearProb) bullProb -= excess; else bearProb -= excess;
  }

  const bullProbFinal = bullProb;
  const baseProbFinal = baseProb;
  const bearProbFinal = bearProb;

  // ── Deterministic price targets via multiple-based math ──────────────────
  // Operating leverage proxy: DOL = gross margin / operating margin
  // High gross margin + lower operating margin = high fixed cost base = high DOL
  const grossM = f.grossMargins ?? 0;
  const opMargin = f.operatingMargins ?? 0;
  const dolRaw = grossM > 0 && opMargin > 0.01 ? grossM / opMargin : 2.0;
  const dol = Math.max(1.0, Math.min(5.0, dolRaw)); // clamp 1–5×

  const revG = f.revenueGrowth ?? 0;

  const calcPriceTargets = (): { bull: number | null; base: number | null; bear: number | null } => {
    // Method A: Forward P/E × scenario EPS (preferred)
    if (f.forwardPE != null && f.forwardEps != null && f.forwardEps > 0 && f.forwardPE > 3 && f.forwardPE < 200) {
      const fpe = f.forwardPE;
      const feps = f.forwardEps;

      // Bull: re-rating (+20%) + operating leverage lifts EPS by DOL × revenue upside
      const bullEPSUplift = 1 + Math.max(0, revG) * (dol - 1) * 0.5;
      const bullPE = fpe * 1.20;
      const bullPT = Math.round(bullPE * feps * bullEPSUplift * 100) / 100;

      // Base: forward P/E × consensus forward EPS (analyst estimate already)
      const basePT = Math.round(fpe * feps * 100) / 100;

      // Bear: de-rating driven by valuation & debt risk + EPS miss from margin compression
      const deratingFactor = f.trailingPE != null && f.trailingPE > 35 ? 0.70 : 0.80;
      const debtPenalty = f.totalDebt != null && f.ebitda != null && f.ebitda > 0 && (f.totalDebt / f.ebitda) > 3 ? 0.85 : 0.92;
      const bearPT = Math.round(fpe * deratingFactor * feps * debtPenalty * 100) / 100;

      // Sanity filter: bull must be above current, bear must be below
      return {
        bull: bullPT > currentPrice * 1.01 ? bullPT : Math.round(currentPrice * 1.15 * 100) / 100,
        base: basePT,
        bear: bearPT < currentPrice * 0.99 ? bearPT : Math.round(currentPrice * 0.82 * 100) / 100,
      };
    }

    // Method B: Trailing P/E × scenario EPS when forward not available
    if (f.trailingPE != null && f.trailingEps != null && f.trailingEps > 0 && f.trailingPE > 3 && f.trailingPE < 200) {
      const tpe = f.trailingPE;
      const teps = f.trailingEps;
      const bullPT = Math.round(tpe * 1.15 * teps * (1 + Math.max(0, revG) * dol * 0.4) * 100) / 100;
      const basePT = Math.round(tpe * teps * (1 + revG * 0.6) * 100) / 100;
      const bearPT = Math.round(tpe * 0.80 * teps * (1 - Math.max(0, -revG) * 0.5 - 0.08) * 100) / 100;
      return {
        bull: bullPT > currentPrice * 1.01 ? bullPT : Math.round(currentPrice * 1.12 * 100) / 100,
        base: basePT,
        bear: bearPT < currentPrice * 0.99 ? bearPT : Math.round(currentPrice * 0.83 * 100) / 100,
      };
    }

    // Method C: Revenue-momentum fallback
    return {
      bull: Math.round(currentPrice * (1 + Math.max(0.08, revG * 1.5 * dol * 0.4)) * 100) / 100,
      base: Math.round(currentPrice * (1 + revG * 0.6) * 100) / 100,
      bear: Math.round(currentPrice * (1 - Math.max(0.10, Math.abs(Math.min(0, revG)) * 2 + 0.08)) * 100) / 100,
    };
  };

  const priceTgts = calcPriceTargets();

  // ── Build prompt (LLM writes narrative only, all numbers pre-calculated) ───
  const ptBullStr = priceTgts.bull != null ? `${priceTgts.bull.toFixed(2)} ${currency}` : 'N/A';
  const ptBaseStr = priceTgts.base != null ? `${priceTgts.base.toFixed(2)} ${currency}` : 'N/A';
  const ptBearStr = priceTgts.bear != null ? `${priceTgts.bear.toFixed(2)} ${currency}` : 'N/A';
  const dolStr = dol.toFixed(1);

  // Sector benchmark context for the LLM narrative
  const benchContext = bench ? `
SECTOR BENCHMARKS (${bench.label}${f.industry ? ' / ' + f.industry : ''}) — use to contextualize metrics:
• Typical P/E range: ${bench.peLow}–${bench.peHigh}x (median ${bench.peMedian}x) → ${pe != null && pe > 0 ? (pe < bench.peLow ? '⬇ cheap vs sector' : pe > bench.peHigh ? '⬆ expensive vs sector' : '↔ in-line with sector') : 'N/A'}
• Typical gross margin: ${(bench.grossMarginTypical * 100).toFixed(0)}% → company: ${f.grossMargins != null ? (f.grossMargins * 100).toFixed(1) + '%' : 'N/A'}
• Typical op margin: ${(bench.opMarginTypical * 100).toFixed(0)}% → company: ${f.operatingMargins != null ? (f.operatingMargins * 100).toFixed(1) + '%' : 'N/A'}
• Typical revenue growth: ${(bench.revenueGrowthTypical * 100).toFixed(0)}%/yr → company: ${f.revenueGrowth != null ? (f.revenueGrowth * 100).toFixed(1) + '%' : 'N/A'}
• Typical EV/EBITDA: ${bench.evEbitdaMedian}x → company: ${fmt(f.evToEbitda)}x
• Comfortable Debt/EBITDA for sector: <${bench.debtEbitdaComfort}x` : '';

  const prompt = `You are an experienced equity research analyst. Write STOCK-SPECIFIC narrative for a bull/base/bear scenario analysis of ${name} (${symbol}).

Current price: ${currentPrice.toFixed(2)} ${currency} | Sector: ${f.sector ?? 'N/A'} | Industry: ${f.industry ?? 'N/A'}

METRICS:
• VALUATION: P/E trailing ${fmt(f.trailingPE)}x | P/E forward ${fmt(f.forwardPE)}x | P/B ${fmt(f.priceToBook)}x | EV/EBITDA ${fmt(f.evToEbitda)}x | P/S ${fmt(f.priceToSales)}x
• PROFITABILITY: Gross margin ${fmtPct(f.grossMargins)} | Op margin ${fmtPct(f.operatingMargins)} | Net margin ${fmtPct(f.profitMargins)} | ROE ${fmtPct(f.returnOnEquity)} | ROA ${fmtPct(f.returnOnAssets)}
• GROWTH: Revenue YoY ${fmtPct(f.revenueGrowth)} | Earnings YoY ${fmtPct(f.earningsGrowth)} | EPS fwd ${fmt(f.forwardEps)} vs trailing ${fmt(f.trailingEps)}
• BALANCE: Cash ${fmtB(f.totalCash)} | Debt ${fmtB(f.totalDebt)} | D/E ${fmt(f.debtToEquity)}x | Current ratio ${fmt(f.currentRatio)}x
• MARKET: Beta ${fmt(f.beta)} | 52W ${fmt(f.fiftyTwoWeekLow)}–${fmt(f.fiftyTwoWeekHigh)} | Div yield ${fmtPct(f.dividendYield)}
${benchContext}
PRE-CALCULATED VALUES — USE EXACTLY AS-IS IN JSON, DO NOT MODIFY:
• Probabilities: bull=${bullProbFinal}% | base=${baseProbFinal}% | bear=${bearProbFinal}%
• Price targets (P/E×EPS method, DOL=${dolStr}x):
  - Bull: ${ptBullStr} | Base: ${ptBaseStr} | Bear: ${ptBearStr}

Your ONLY job: write "driver" and "evidence" for 3 items per scenario, grounded in the metrics and sector benchmarks above.
When a metric is above/below sector benchmark, mention it explicitly in the evidence (e.g. "margem operacional 32% vs 20% típico do setor").
All text in Portuguese (Portugal). Evidence must quote exact numbers.

Respond ONLY with valid JSON (no markdown, no text outside JSON):
{
  "bull": {
    "probability": ${bullProbFinal},
    "priceTarget": ${priceTgts.bull ?? 'null'},
    "items": [
      {"driver": "<upside driver specific to ${symbol}>", "evidence": ["<exact metric>", "<exact metric>"], "confidence": <60-90>},
      {"driver": "<second bull point>", "evidence": ["<exact metric>"], "confidence": <integer>},
      {"driver": "<third bull point>", "evidence": ["<exact metric>"], "confidence": <integer>}
    ]
  },
  "base": {
    "probability": ${baseProbFinal},
    "priceTarget": ${priceTgts.base ?? 'null'},
    "items": [
      {"driver": "<base expectation>", "evidence": ["<metric>"], "confidence": <50-75>},
      {"driver": "<normalized path>", "evidence": ["<metric>"], "confidence": <integer>},
      {"driver": "<key assumption>", "evidence": ["<metric>"], "confidence": <integer>}
    ]
  },
  "bear": {
    "probability": ${bearProbFinal},
    "priceTarget": <bear price target or null>,
    "items": [
      {"driver": "<specific risk from ${symbol}'s data>", "evidence": ["<metric>"], "confidence": <integer>},
      {"driver": "<thesis failure condition>", "evidence": ["<metric>"], "confidence": <integer>},
      {"driver": "<structural or margin risk>", "evidence": ["<metric>"], "confidence": <integer>}
    ]
  }
}

All text in Portuguese (Portugal). Evidence must quote actual numbers from the metrics provided.`;

  let response;
  try {
    response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1400,
        temperature: 0.5,
      },
      {
        timeout: 25000,
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
  } catch (err: any) {
    const status = err?.response?.status;
    const msg: string = err?.response?.data?.error?.message ?? err?.message ?? 'Unknown error';
    if (status === 429) throw new Error('Groq quota exceeded. Try again shortly.');
    if (status === 401) throw new Error('Invalid Groq key. Check Settings.');
    throw new Error(`Groq error: ${msg}`);
  }

  let raw: string = response.data?.choices?.[0]?.message?.content ?? '';
  if (!raw) throw new Error('Empty response from Groq API');

  // Strip markdown code fences if present
  raw = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Extract JSON object
  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) throw new Error('Invalid JSON response from AI');
  raw = raw.slice(jsonStart, jsonEnd + 1);

  let parsed: ScenarioResult;
  try {
    parsed = JSON.parse(raw) as ScenarioResult;
  } catch {
    throw new Error('Could not parse scenario data from AI response');
  }

  // Validate minimal structure
  if (!parsed.bull?.items || !parsed.base?.items || !parsed.bear?.items) {
    throw new Error('Incomplete scenario data received');
  }

  // Always override probabilities AND price targets with deterministically calculated values
  parsed.bull.probability = bullProbFinal;
  parsed.base.probability = baseProbFinal;
  parsed.bear.probability = bearProbFinal;
  parsed.bull.priceTarget = priceTgts.bull;
  parsed.base.priceTarget = priceTgts.base;
  parsed.bear.priceTarget = priceTgts.bear;

  // Weighted expected value
  const ev =
    priceTgts.bull != null && priceTgts.base != null && priceTgts.bear != null
      ? Math.round((
          (bullProbFinal / 100) * priceTgts.bull +
          (baseProbFinal / 100) * priceTgts.base +
          (bearProbFinal / 100) * priceTgts.bear
        ) * 100) / 100
      : null;

  parsed.expectedValue = ev;
  parsed.operatingLeverage = Math.round(dol * 10) / 10;
  parsed.probabilityMath = {
    bullScore,
    baseScore,
    bearScore,
    totalScore: bullScore + baseScore + bearScore,
    bullProbability: bullProbFinal,
    baseProbability: baseProbFinal,
    bearProbability: bearProbFinal,
    factors: probabilityFactors,
  };

  return parsed;
}

// ─── Groq AI Analysis ────────────────────────────────────────────────────────

export async function analyzeWithAI(
  apiKey: string,
  symbol: string,
  name: string,
  f: Fundamentals,
  currentPrice: number,
  currency: string,
  technicals?: AVTechnicals,
): Promise<string> {
  const fmt = (v: number | null | undefined, suffix = '') =>
    v == null ? 'N/A' : `${v.toFixed(2)}${suffix}`;
  const fmtB = (v: number | null | undefined) => {
    if (v == null) return 'N/A';
    if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    return v.toFixed(0);
  };
  const fmtPct = (v: number | null | undefined) => v == null ? 'N/A' : `${(v * 100).toFixed(1)}%`;

  const rsiInterpret = (rsi: number | null) => {
    if (rsi == null) return 'N/A';
    if (rsi >= 70) return `${rsi.toFixed(1)} (sobrecomprado)`;
    if (rsi <= 30) return `${rsi.toFixed(1)} (sobrevendido)`;
    return `${rsi.toFixed(1)} (neutro)`;
  };
  const macdInterpret = (hist: number | null) => {
    if (hist == null) return 'N/A';
    if (hist > 0) return `${hist.toFixed(3)} (momentum bullish)`;
    return `${hist.toFixed(3)} (momentum bearish)`;
  };
  const smaSignal = (price: number, sma: number | null, label: string) => {
    if (!sma) return '';
    return price > sma
      ? `\n• Price above ${label} (${sma.toFixed(2)}) — bullish trend`
      : `\n• Price below ${label} (${sma.toFixed(2)}) — bearish trend`;
  };

  const techSection = technicals ? `
ANÁLISE TÉCNICA (Alpha Vantage — semanal)
• RSI (14): ${rsiInterpret(technicals.rsi)}
• MACD Histograma: ${macdInterpret(technicals.macdHist)}
• MACD: ${technicals.macd?.toFixed(3) ?? 'N/A'} | Signal: ${technicals.macdSignal?.toFixed(3) ?? 'N/A'}${smaSignal(currentPrice, technicals.sma50, 'SMA50')}${smaSignal(currentPrice, technicals.sma200, 'SMA200')}

SENTIMENTO DE NOTÍCIAS RECENTES
${technicals.news.length > 0
  ? technicals.news.map(n => `• [${n.sentiment}] ${n.title}`).join('\n')
  : '• No recent news available'}` : '';

  const prompt = `És um analista financeiro experiente. Analisa a seguinte ação em português de Portugal.

Empresa: ${name} (${symbol})
Preço atual: ${currentPrice.toFixed(2)} ${currency}
Setor: ${f.sector ?? 'N/A'} | Indústria: ${f.industry ?? 'N/A'}

VALUATION
• Market Cap: ${fmtB(f.marketCap)}
• P/E trailing: ${fmt(f.trailingPE)}x | P/E forward: ${fmt(f.forwardPE)}x
• P/B: ${fmt(f.priceToBook)}x | P/S: ${fmt(f.priceToSales)}x
• EV/EBITDA: ${fmt(f.evToEbitda)}x

RENTABILIDADE
• Margem bruta: ${fmtPct(f.grossMargins)} | Margem operacional: ${fmtPct(f.operatingMargins)} | Margem líquida: ${fmtPct(f.profitMargins)}
• ROE: ${fmtPct(f.returnOnEquity)} | ROA: ${fmtPct(f.returnOnAssets)}
• EPS trailing: ${fmt(f.trailingEps)} | EPS forward: ${fmt(f.forwardEps)}

CRESCIMENTO
• Receita YoY: ${fmtPct(f.revenueGrowth)} | Lucro YoY: ${fmtPct(f.earningsGrowth)}
• Receita total: ${fmtB(f.totalRevenue)} | EBITDA: ${fmtB(f.ebitda)}

BALANÇO
• Caixa: ${fmtB(f.totalCash)} | Dívida total: ${fmtB(f.totalDebt)}
• Dívida/Capital próprio: ${fmt(f.debtToEquity)}x | Current ratio: ${fmt(f.currentRatio)}x

MERCADO
• Beta: ${fmt(f.beta)} | 52W High: ${fmt(f.fiftyTwoWeekHigh)} | 52W Low: ${fmt(f.fiftyTwoWeekLow)}
• Dividend yield: ${fmtPct(f.dividendYield)} | Payout ratio: ${fmtPct(f.payoutRatio)}
${techSection}
Com base nestes dados, dá uma análise concisa (máximo 300 palavras) que cubra:
1. Avaliação geral (barata, justa ou cara face ao setor)
2. Pontos fortes dos fundamentos
3. ${technicals ? 'Leitura técnica (tendência, momentum, RSI)' : 'Pontos de risco ou fracos'}
4. ${technicals && technicals.news.length > 0 ? 'Impacto das notícias recentes' : 'Pontos de risco ou fracos'}
5. Veredicto final (Comprar / Manter / Evitar) com justificação breve

Sê direto e objetivo. Usa linguagem simples.`;

  let response;
  try {
    response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.4,
      },
      {
        timeout: 20000,
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
  } catch (err: any) {
    const status = err?.response?.status;
    const msg: string = err?.response?.data?.error?.message ?? err?.message ?? 'Unknown error';
    if (status === 429) throw new Error('Groq quota exceeded. Try again shortly.');
    if (status === 401) throw new Error('Invalid Groq key. Check Settings.');
    throw new Error(`Groq error: ${msg}`);
  }

  const text: string = response.data?.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('Empty response from Groq API');
  return text.trim();
}

// ─── Alpha Vantage data fetch for chat context ─────────────────────────────────
export async function fetchAVForChat(symbol: string, dataType: 'rsi' | 'macd' | 'price' | 'news' | 'sma' | 'bbands' | 'overview' | 'earnings'): Promise<Record<string, unknown>> {
  const base = 'https://www.alphavantage.co/query';
  const params: Record<string, string> = { symbol, apikey: AV_KEY };
  switch (dataType) {
    case 'rsi':      params.function = 'RSI';              params.interval = 'daily'; params.time_period = '14'; params.series_type = 'close'; break;
    case 'macd':     params.function = 'MACD';             params.interval = 'daily'; params.series_type = 'close'; break;
    case 'sma':      params.function = 'SMA';              params.interval = 'daily'; params.time_period = '50'; params.series_type = 'close'; break;
    case 'bbands':   params.function = 'BBANDS';           params.interval = 'daily'; params.time_period = '20'; params.series_type = 'close'; break;
    case 'price':    params.function = 'TIME_SERIES_DAILY'; params.outputsize = 'compact'; break;
    case 'news':     params.function = 'NEWS_SENTIMENT';   params.tickers = symbol; params.limit = '10'; break;
    case 'overview': params.function = 'COMPANY_OVERVIEW'; break;
    case 'earnings': params.function = 'EARNINGS'; break;
  }
  const { data } = await axios.get(base, { params });
  return data;
}

// ─── Groq News AI Analysis ────────────────────────────────────────────────────

export async function analyzeNewsWithAI(
  apiKey: string,
  symbol: string,
  name: string,
  currentPrice: number,
  currency: string,
  newsItems: NewsItem[],
): Promise<string> {
  const newsList = newsItems
    .slice(0, 15)
    .map((n, i) => {
      const date = new Date(n.publishTime * 1000).toLocaleDateString('en-US', {
        day: '2-digit', month: 'short', year: 'numeric',
      });
      return `${i + 1}. [${date}] "${n.title}" (${n.publisher})`;
    })
    .join('\n');

  const prompt = `You are an expert financial analyst. Below are the most recent news headlines for ${name} (${symbol}), currently trading at ${currentPrice.toFixed(2)} ${currency}.

NEWS HEADLINES (newest first):
${newsList}

Analyze these news items and explain in clear, concise English (max 300 words):
1. Which news likely had the most impact on the stock price and why
2. Overall sentiment of the news (bullish / bearish / neutral) and what it signals
3. Any key risks or catalysts investors should watch based on these headlines

Be direct and objective. Focus on price-relevant information.`;

  let response;
  try {
    response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.4,
      },
      {
        timeout: 20000,
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
  } catch (err: any) {
    const status = err?.response?.status;
    const msg: string = err?.response?.data?.error?.message ?? err?.message ?? 'Unknown error';
    if (status === 429) throw new Error('Groq quota exceeded. Try again in a moment.');
    if (status === 401) throw new Error('Invalid Groq key. Check your Settings.');
    throw new Error(`Groq error: ${msg}`);
  }

  const text: string = response.data?.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('Empty response from Groq API');
  return text.trim();
}

// ─── Tavily Web Search ────────────────────────────────────────────────────────

export async function searchTavily(query: string, tavilyKey: string): Promise<string> {
  const { data } = await axios.post(
    'https://api.tavily.com/search',
    {
      api_key: tavilyKey,
      query,
      search_depth: 'advanced',
      topic: 'news',
      max_results: 5,
      include_answer: true,
    },
    { timeout: 12000 },
  );
  const snippets = ((data?.results ?? []) as any[]).map(
    (r) => `• ${r.title}: ${String(r.content ?? '').slice(0, 350)}`,
  ).join('\n');
  return data?.answer
    ? `Resposta direta: ${data.answer}\n\nFontes:\n${snippets}`
    : snippets;
}

// ─── Groq Financials AI Analysis ─────────────────────────────────────────────

export async function analyzeFinancialsWithAI(
  apiKey: string,
  symbol: string,
  name: string,
  freq: 'quarterly' | 'annual',
  periods: FinancialPeriod[],
  earningsHistory: EarningsEvent[],
  consensus: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; consensus: string } | null,
  fundamentals: { forwardPE?: number | null; forwardEps?: number | null; revenueGrowth?: number | null; earningsGrowth?: number | null } | null,
): Promise<string> {
  const fmtB = (v: number | null | undefined): string => {
    if (v == null) return 'N/A';
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
    if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(1)}B`;
    if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(0)}M`;
    return `${sign}$${abs.toLocaleString('en-US')}`;
  };
  const fmtPct = (v: number | null | undefined) => v == null ? 'N/A' : `${(v * 100).toFixed(1)}%`;
  const fmt2 = (v: number | null | undefined) => v == null ? 'N/A' : v.toFixed(2);

  // Build income table (most recent first, up to 6 periods)
  const slice = periods.slice(0, 6);
  const incomeTable = slice.map((p) => {
    const gm  = p.revenue && p.grossProfit  != null ? fmtPct(p.grossProfit / p.revenue)  : 'N/A';
    const om  = p.revenue && p.operatingIncome != null ? fmtPct(p.operatingIncome / p.revenue) : 'N/A';
    const nm  = p.revenue && p.netIncome != null ? fmtPct(p.netIncome / p.revenue) : 'N/A';
    const fcf = p.operatingCF != null && p.capex != null ? fmtB(p.operatingCF - p.capex) : 'N/A';
    return `  ${p.label}: Rev ${fmtB(p.revenue)} | Gross ${gm} | Op ${om} | Net ${nm} | EPS ${fmt2(p.epsDiluted)} | FCF ${fcf}`;
  }).join('\n');

  // EPS beats/misses
  const epsRows = earningsHistory.slice(0, 6).map((e) => {
    if (e.epsActual == null) return `  ${e.date}: EPS actual N/A`;
    const beat = e.epsEstimated != null
      ? (e.epsActual >= e.epsEstimated ? `beat (est ${fmt2(e.epsEstimated)})` : `missed (est ${fmt2(e.epsEstimated)})`)
      : '';
    return `  ${e.date}: EPS ${fmt2(e.epsActual)} ${beat}`;
  }).join('\n');

  // Analyst consensus
  const analystLine = consensus
    ? `Consensus: ${consensus.consensus} | Strong Buy ${consensus.strongBuy}, Buy ${consensus.buy}, Hold ${consensus.hold}, Sell ${consensus.sell}, Strong Sell ${consensus.strongSell}`
    : 'Consensus: N/A';

  // Forward estimates
  const forwardLine = fundamentals
    ? `Forward P/E: ${fmt2(fundamentals.forwardPE)}x | Forward EPS: ${fmt2(fundamentals.forwardEps)} | Revenue growth (est): ${fmtPct(fundamentals.revenueGrowth)} | Earnings growth (est): ${fmtPct(fundamentals.earningsGrowth)}`
    : 'Forward estimates: N/A';

  const prompt = `You are an expert financial analyst. Analyze the ${freq} financial results for ${name} (${symbol}) and provide a concise assessment in English (max 350 words).

FINANCIAL RESULTS (${freq.toUpperCase()}, most recent first):
${incomeTable || 'No data available'}

EPS vs ESTIMATES (recent quarters):
${epsRows || 'No earnings history available'}

ANALYST CONSENSUS:
${analystLine}

FORWARD ESTIMATES & GROWTH:
${forwardLine}

Provide a structured analysis covering:
1. Revenue & profit trend — is the business growing, stable, or deteriorating? Are margins expanding or compressing?
2. Earnings quality — does the company consistently beat or miss estimates? Any red flags?
3. Forward outlook — what do analysts and forward estimates imply? Is growth priced in?
4. Key risks or strengths from the financials
5. Overall verdict: Accelerating / Stable / Decelerating — with a one-line justification

Be direct, data-driven, and specific. Reference actual numbers where relevant.`;

  let response;
  try {
    response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 700,
        temperature: 0.3,
      },
      {
        timeout: 25000,
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
  } catch (err: any) {
    const status = err?.response?.status;
    const msg: string = err?.response?.data?.error?.message ?? err?.message ?? 'Unknown error';
    if (status === 429) throw new Error('Groq quota exceeded. Try again in a moment.');
    if (status === 401) throw new Error('Invalid Groq key. Check your Settings.');
    throw new Error(`Groq error: ${msg}`);
  }

  const text: string = response.data?.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('Empty response from Groq API');
  return text.trim();
}

// ─── Peer Comparison ─────────────────────────────────────────────────────────

export interface PeerMetric {
  key: string;
  label: string;
  stock: number | null;
  peerMedian: number | null;
  format: 'pct' | 'x' | 'num';
}

export interface PeerComparison {
  peers: string[];
  metrics: PeerMetric[];
}

const _median = (values: number[]): number | null => {
  const sorted = values.filter((v) => isFinite(v) && v !== 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const getPeerComparison = async (symbol: string): Promise<PeerComparison | null> => {
  if (!FH_KEY) return null;
  try {
    const peersResp = await fh.get('/stock/peers', { params: { symbol, token: FH_KEY } });
    const allPeers: string[] = (Array.isArray(peersResp.data) ? peersResp.data : [])
      .filter((p: string) => p !== symbol);
    const peers = allPeers.slice(0, 6);
    if (peers.length === 0) return null;

    const fetchMetric = async (sym: string) => {
      try {
        const r = await fh.get('/stock/metric', { params: { symbol: sym, metric: 'all', token: FH_KEY } });
        return (r.data?.metric ?? {}) as Record<string, number>;
      } catch { return {} as Record<string, number>; }
    };

    const [stockM, ...peerMs] = await Promise.all([fetchMetric(symbol), ...peers.map(fetchMetric)]);

    const METRIC_DEFS: { key: string; label: string; format: PeerMetric['format'] }[] = [
      { key: 'peTTM',               label: 'P/E (TTM)',          format: 'x'   },
      { key: 'forwardPE',           label: 'P/E (forward)',      format: 'x'   },
      { key: 'pbAnnual',            label: 'P/B',                format: 'x'   },
      { key: 'psTTM',               label: 'P/S',                format: 'x'   },
      { key: 'evEbitdaTTM',         label: 'EV/EBITDA',          format: 'x'   },
      { key: 'grossMarginTTM',      label: 'Gross Margin',       format: 'pct' },
      { key: 'operatingMarginTTM',  label: 'Operating Margin',   format: 'pct' },
      { key: 'netProfitMarginTTM',  label: 'Net Margin',         format: 'pct' },
      { key: 'roeTTM',              label: 'ROE',                format: 'pct' },
      { key: 'roaTTM',              label: 'ROA',                format: 'pct' },
      { key: 'revenueGrowth5Y',     label: 'Revenue Growth 5Y',  format: 'pct' },
      { key: 'epsGrowth5Y',         label: 'EPS Growth 5Y',      format: 'pct' },
    ];

    const metrics: PeerMetric[] = METRIC_DEFS
      .map(({ key, label, format }) => {
        const stockVal = typeof stockM[key] === 'number' && isFinite(stockM[key]) ? stockM[key] : null;
        const peerVals = peerMs
          .map((m) => m[key])
          .filter((v): v is number => typeof v === 'number' && isFinite(v));
        const peerMed = _median(peerVals);
        return { key, label, stock: stockVal, peerMedian: peerMed, format };
      })
      .filter((m) => m.stock !== null || m.peerMedian !== null);

    return { peers: allPeers.slice(0, 10), metrics };
  } catch {
    return null;
  }
};

// ── Revenue Consensus Analyst Estimates ────────────────────────────────────────
export interface RevenueEstimateYear {
  year: string;               // "2024"
  isActual: boolean;
  // Revenue
  revenue: number | null;     // actual from income statement
  estAvg: number | null;
  estHigh: number | null;
  estLow: number | null;
  numAnalysts: number | null;
  // EPS
  epsAvg: number | null;
  epsHigh: number | null;
  epsLow: number | null;
  numEpsAnalysts: number | null;
  // Net Income (Earnings)
  netIncome: number | null;   // actual from income statement
  netIncomeAvg: number | null;
  netIncomeHigh: number | null;
  netIncomeLow: number | null;
  // EBITDA
  ebitda: number | null;      // actual from income statement
  ebitdaAvg: number | null;
  ebitdaHigh: number | null;
  ebitdaLow: number | null;
}

export const getRevenueEstimates = async (symbol: string): Promise<RevenueEstimateYear[]> => {
  const key = `${symbol}:rev_est_v2`;
  const mem = cacheGet<RevenueEstimateYear[]>(key);
  if (mem !== undefined && mem.length > 0) return mem;
  const persisted = await persistGet<RevenueEstimateYear[]>(key);
  if (persisted !== undefined && persisted.length > 0) { cacheSet(key, persisted, TTL.analyst); return persisted; }
  const result = await _getRevenueEstimates(symbol);
  if (result.length > 0) {
    cacheSet(key, result, TTL.analyst);
    persistSet(key, result, TTL.analyst);
  }
  return result;
};

async function _getRevenueEstimates(symbol: string): Promise<RevenueEstimateYear[]> {
  if (!FMP_KEY) return [];
  const [estRes, incomeRes] = await Promise.all([
    fmp.get('/stable/analyst-estimates', { params: { symbol, period: 'annual', limit: 10, apikey: FMP_KEY } }).catch(() => ({ data: [] })),
    fmp.get('/stable/income-statement',  { params: { symbol, period: 'annual', limit: 6,  apikey: FMP_KEY } }).catch(() => ({ data: [] })),
  ]);

  const estimates: Record<string, unknown>[] = Array.isArray(estRes.data)  ? estRes.data  : [];
  const incomeStmts: Record<string, unknown>[] = Array.isArray(incomeRes.data) ? incomeRes.data : [];

  // Build actual maps from income statement
  const actualRevMap = new Map<string, number>();
  const actualNiMap  = new Map<string, number>();
  const actualEbMap  = new Map<string, number>();
  for (const stmt of incomeStmts) {
    const year = String(stmt.date ?? '').slice(0, 4);
    const rev  = Number(stmt.revenue);
    const ni   = Number(stmt.netIncome);
    const eb   = Number(stmt.ebitda);
    if (year) {
      if (!isNaN(rev) && rev > 0) actualRevMap.set(year, rev);
      if (!isNaN(ni)  && ni  !== 0) actualNiMap.set(year, ni);
      if (!isNaN(eb)  && eb  !== 0) actualEbMap.set(year, eb);
    }
  }

  const currentYear = new Date().getFullYear();
  const rows: RevenueEstimateYear[] = [];
  const seen = new Set<string>();

  for (const est of estimates) {
    const year = String(est.date ?? '').slice(0, 4);
    if (!year || seen.has(year)) continue;
    seen.add(year);

    const estYear  = parseInt(year, 10);
    const actual   = actualRevMap.get(year) ?? null;
    const isActual = actual !== null || estYear < currentYear;

    rows.push({
      year,
      isActual,
      revenue:        actual,
      estAvg:         Number(est.revenueAvg)   || null,
      estHigh:        Number(est.revenueHigh)  || null,
      estLow:         Number(est.revenueLow)   || null,
      numAnalysts:    Number(est.numberAnalystEstimatedRevenue) || null,
      epsAvg:         Number(est.epsAvg)        || null,
      epsHigh:        Number(est.epsHigh)       || null,
      epsLow:         Number(est.epsLow)        || null,
      numEpsAnalysts: Number(est.numberAnalystsEstimatedEps)   || null,
      netIncome:      actualNiMap.get(year) ?? null,
      netIncomeAvg:   Number(est.netIncomeAvg)  || null,
      netIncomeHigh:  Number(est.netIncomeHigh) || null,
      netIncomeLow:   Number(est.netIncomeLow)  || null,
      ebitda:         actualEbMap.get(year) ?? null,
      ebitdaAvg:      Number(est.ebitdaAvg)     || null,
      ebitdaHigh:     Number(est.ebitdaHigh)    || null,
      ebitdaLow:      Number(est.ebitdaLow)     || null,
    });
  }

  // Fallback: actuals only
  if (rows.length === 0 && actualRevMap.size > 0) {
    return Array.from(actualRevMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([year, revenue]) => ({
        year, isActual: true, revenue,
        estAvg: null, estHigh: null, estLow: null, numAnalysts: null,
        epsAvg: null, epsHigh: null, epsLow: null, numEpsAnalysts: null,
        netIncome: actualNiMap.get(year) ?? null,
        netIncomeAvg: null, netIncomeHigh: null, netIncomeLow: null,
        ebitda: actualEbMap.get(year) ?? null,
        ebitdaAvg: null, ebitdaHigh: null, ebitdaLow: null,
      }));
  }

  rows.sort((a, b) => a.year.localeCompare(b.year));
  return rows;
}

// ── DCF Intrinsic Value ──────────────────────────────────────────────────────

export interface DCFResult {
  fairValue: number;           // estimated intrinsic value per share
  currentPrice: number;        // current market price
  discountPct: number;         // positive = undervalued, negative = overvalued
  wacc: number;                // discount rate used (%)
  growthRate: number;          // high-growth phase rate used (%)
  terminalGrowthRate: number;  // terminal growth rate (%)
  fcfBase: number;             // trailing FCF per share used as base
  source: 'analyst' | 'historical';
}

export const getDCF = async (symbol: string, currentPrice: number): Promise<DCFResult | null> => {
  // Bump cache key so stale FMP-DCF results are ignored
  const key = `${symbol}:dcf:v17`;
  const cached = cacheGet<DCFResult>(key);
  if (cached) return cached;
  const persisted = await persistGet<DCFResult>(key);
  if (persisted !== undefined) { cacheSet(key, persisted, TTL_24H); return persisted; }

  try {
    // Fetch key-metrics-ttm + cash-flow (3y) + income (2y) + analyst estimates + profile (for beta) + Finnhub metrics
    const [kmRes, cfRes, incRes, estRes, profileRes, fhMetricRes] = await Promise.all([
      fmp.get('/stable/key-metrics-ttm', { params: { symbol, apikey: FMP_KEY } }).catch(() => ({ data: [] })),
      fmp.get('/stable/cash-flow-statement', { params: { symbol, period: 'annual', limit: 3, apikey: FMP_KEY } }).catch(() => ({ data: [] })),
      fmp.get('/stable/income-statement',    { params: { symbol, period: 'annual', limit: 2, apikey: FMP_KEY } }).catch(() => ({ data: [] })),
      fmp.get('/stable/analyst-estimates',   { params: { symbol, period: 'annual', limit: 5, apikey: FMP_KEY } }).catch(() => ({ data: [] })),
      fmp.get('/stable/profile',             { params: { symbol, apikey: FMP_KEY } }).catch(() => ({ data: [] })),
      FH_KEY ? fh.get('/stock/metric', { params: { symbol, metric: 'all', token: FH_KEY } }).catch(() => ({ data: {} })) : Promise.resolve({ data: {} }),
    ]);

    const km = Array.isArray(kmRes.data) ? kmRes.data[0] : (kmRes.data ?? null);
    const cfStmts: Record<string, unknown>[] = Array.isArray(cfRes.data) ? cfRes.data : [];
    const incStmts: Record<string, unknown>[] = Array.isArray(incRes.data) ? incRes.data : [];
    const inc0 = incStmts[0] ?? null;
    const profile = Array.isArray(profileRes.data) ? profileRes.data[0] : (profileRes.data ?? null);
    const fhMetric: Record<string, unknown> = (fhMetricRes as { data: { metric?: Record<string, unknown> } }).data?.metric ?? {};

    // Sanity check: P/FCF must be < 200x to be considered valid
    const sane = (v: number) => v > 0 && (currentPrice / v) < 200;

    // ── FCF per share — 4-tier priority with sanity validation ────────────
    // 1. Finnhub: independent computation from SEC filings (most reliable)
    let fcfPerShare: number | null = null;
    const fhTTM  = Number(fhMetric.freeCashFlowPerShareTTM    ?? NaN);
    const fhAnnl = Number(fhMetric.freeCashFlowPerShareAnnual ?? NaN);
    const fhBest = (!isNaN(fhTTM) && fhTTM > 0) ? fhTTM : fhAnnl;
    if (!isNaN(fhBest) && sane(fhBest)) fcfPerShare = fhBest;

    // 2. Raw cash flow statement: (operatingCF - capex) / diluted shares
    //    Try each year until we get a positive, sane result
    if (fcfPerShare == null) {
      const shares = Number(
        inc0?.weightedAverageShsOutDil ??
        inc0?.weightedAverageShsOut ??
        km?.sharesOutstanding ?? 0
      );
      if (shares > 0) {
        for (const cf of cfStmts) {
          const opCF  = Number(cf.operatingCashFlow ?? cf.netCashProvidedByOperatingActivities ?? 0);
          const capex = Math.abs(Number(cf.capitalExpenditure ?? cf.investmentsInPropertyPlantAndEquipment ?? 0));
          const fcf   = opCF - capex;
          const ps    = fcf / shares;
          if (sane(ps)) { fcfPerShare = ps; break; }
        }
      }
    }

    // 3. FMP precomputed freeCashFlowPerShareTTM (sanity-checked — may be wrong for some stocks)
    if (fcfPerShare == null) {
      const v = Number(km?.freeCashFlowPerShareTTM ?? km?.freeCashFlowPerShare ?? NaN);
      if (!isNaN(v) && sane(v)) fcfPerShare = v;
    }

    if (fcfPerShare == null || fcfPerShare <= 0) return null;

    // ── Growth rate ───────────────────────────────────────────────────────
    // Priority: analyst EPS CAGR → YoY FCF growth → YoY EPS growth → 8% default
    let growthRate = 0.08;
    let source: DCFResult['source'] = 'historical';

    // 1. Analyst estimates CAGR — include current year (>= not >)
    const estArr: Record<string, unknown>[] = Array.isArray(estRes.data) ? estRes.data : [];
    const currentYear = new Date().getFullYear();
    const futureEst = estArr.filter(e => Number(e.date?.toString().slice(0, 4)) >= currentYear);
    // Collects year-by-year EPS from whichever source produces the growth rate
    let analystEpsEstimates: number[] = [];
    if (futureEst.length >= 2) {
      // Sort ascending by year
      futureEst.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const epsFirst = Number(futureEst[0]?.estimatedEpsAvg ?? 0);
      const epsLast  = Number(futureEst[futureEst.length - 1]?.estimatedEpsAvg ?? 0);
      const nYears   = futureEst.length - 1;
      if (epsFirst > 0 && epsLast > epsFirst && nYears >= 1) {
        const cagr = Math.pow(epsLast / epsFirst, 1 / nYears) - 1;
        if (cagr > 0.01 && cagr < 0.6) {
          growthRate = cagr;
          source = 'analyst';
          analystEpsEstimates = futureEst
            .map(e => Number(e.estimatedEpsAvg ?? 0))
            .filter(v => v > 0);
        }
      }
    }

    // 2. YoY FCF growth from cash flow statements (2 years)
    if (source === 'historical' && cfStmts.length >= 2) {
      const cf0 = cfStmts[0];
      const cf1 = cfStmts[1];
      const fcf0 = Number(cf0.operatingCashFlow ?? 0) - Math.abs(Number(cf0.capitalExpenditure ?? 0));
      const fcf1 = Number(cf1.operatingCashFlow ?? 0) - Math.abs(Number(cf1.capitalExpenditure ?? 0));
      if (fcf1 > 0 && fcf0 > fcf1) {
        const g = (fcf0 - fcf1) / fcf1;
        if (g > 0.01 && g < 0.6) growthRate = g;
      }
    }

    // 3. YoY EPS growth from income statements
    if (source === 'historical' && incStmts.length >= 2) {
      const eps0 = Number(incStmts[0]?.epsdiluted ?? incStmts[0]?.eps ?? 0);
      const eps1 = Number(incStmts[1]?.epsdiluted ?? incStmts[1]?.eps ?? 0);
      if (eps1 > 0 && eps0 > eps1) {
        const g = (eps0 - eps1) / eps1;
        if (g > 0.01 && g < 0.6) growthRate = g;
      }
    }

    // 4. Finnhub /stock/eps-estimates (annual forward EPS)
    if (source === 'historical' && FH_KEY) {
      try {
        const fhEstRes = await fh.get('/stock/eps-estimates', {
          params: { symbol, freq: 'annual', token: FH_KEY },
        });
        const fhEsts: Record<string, unknown>[] = Array.isArray(fhEstRes.data?.data) ? fhEstRes.data.data : [];
        const fhFuture = fhEsts
          .filter(e => Number(String(e.period ?? '').slice(0, 4)) >= currentYear)
          .sort((a, b) => String(a.period).localeCompare(String(b.period)));
        if (fhFuture.length >= 2) {
          const e0 = Number(fhFuture[0]?.epsAvg ?? 0);
          const eN = Number(fhFuture[fhFuture.length - 1]?.epsAvg ?? 0);
          const n  = fhFuture.length - 1;
          // Accept growing or flat estimates (don't require eN > e0)
          if (e0 > 0 && eN > 0 && n >= 1) {
            const cagr = eN > e0 ? Math.pow(eN / e0, 1 / n) - 1 : 0.05;
            if (cagr > 0.01 && cagr < 0.6) {
              growthRate = cagr;
              source = 'analyst';
              analystEpsEstimates = fhFuture
                .map(e => Number(e.epsAvg ?? 0))
                .filter(v => v > 0);
            }
          }
        }
      } catch { /* ignore */ }
    }

    // 5. Alpha Vantage OVERVIEW — derive growth from PEGRatio (PEG = P/E ÷ growth%)
    if (source === 'historical' && AV_KEY) {
      try {
        const avRes = await av.get('/query', {
          params: { function: 'OVERVIEW', symbol, apikey: AV_KEY },
        });
        const d = avRes.data ?? {};
        const peg = Number(d.PEGRatio ?? 0);
        const pe  = Number(d.ForwardPE ?? d.TrailingPE ?? 0);
        if (peg > 0 && pe > 0) {
          // growth% = (P/E) / PEG  — AV gives growth as a decimal already
          const impliedGrowth = (pe / peg) / 100;
          if (impliedGrowth > 0.01 && impliedGrowth < 0.6) {
            growthRate = impliedGrowth;
            source = 'analyst';
          }
        }
        // Fallback: AV AnalystTargetPrice not useful for growth directly
        // But EPS growth 3Y from EARNINGS function would need another call — skip
      } catch { /* ignore */ }
    }

    // ── WACC — CAPM-based using beta (dynamic per company) ───────────────
    // Formula: Rf + β × ERP  (same approach as Simply Wall St)
    // Rf  = 4.0%  (10-year US Treasury approximate)
    // ERP = 4.0%  (Damodaran implied ERP, consistent with SWS methodology)
    // Beta sources: FMP profile → FMP key-metrics → default 1.0
    // Blume adjustment pulls beta toward 1.0 (industry standard): 0.67×raw + 0.33×1.0
    const RF  = 0.040;
    const ERP = 0.040;
    const betaRaw = Number(profile?.beta ?? km?.beta ?? km?.betaTTM ?? NaN);
    const betaRawClean = (!isNaN(betaRaw) && betaRaw > 0.3 && betaRaw < 3.0) ? betaRaw : 1.0;
    const betaAdj = 0.67 * betaRawClean + 0.33; // Blume adjustment
    let wacc = RF + betaAdj * ERP;
    wacc = Math.max(0.06, Math.min(0.13, wacc)); // cap between 6-13%

    const terminalGrowthRate = 0.025;
    const fadeRate = (growthRate + terminalGrowthRate) / 2;

    // ── Two-stage DCF (Simply Wall St methodology) ────────────────────────
    // Stage 1: Use analyst EPS estimates directly as cash flows (not grown from FCF base)
    //          This matches SWS: "We use analyst estimates for EPS as a proxy for levered FCF"
    // Stage 2: Fade to terminal growth rate, then Gordon Growth Model
    let pv = 0;
    let lastCF: number;

    // Use the EPS estimates captured from whichever source set the growth rate
    const analystCFs = analystEpsEstimates;

    if (analystCFs.length >= 2) {
      // Use analyst EPS directly for the explicit forecast period
      for (let i = 0; i < analystCFs.length; i++) {
        pv += analystCFs[i] / Math.pow(1 + wacc, i + 1);
      }
      lastCF = analystCFs[analystCFs.length - 1];
      // Extend remaining years up to 10 with fade rate
      for (let y = analystCFs.length + 1; y <= 10; y++) {
        lastCF *= (1 + fadeRate);
        pv += lastCF / Math.pow(1 + wacc, y);
      }
    } else {
      // Fallback: grow the base cash flow by estimated growth rate.
      // SWS uses EPS as proxy for levered FCF → prefer EPS over raw FCF/share
      const epsBase = Number(inc0?.epsdiluted ?? inc0?.eps ?? 0);
      const cfBase = (epsBase > fcfPerShare && epsBase > 0) ? epsBase : fcfPerShare;
      let fcf = cfBase;
      for (let y = 1; y <= 5; y++) {
        fcf *= (1 + growthRate);
        pv += fcf / Math.pow(1 + wacc, y);
      }
      for (let y = 6; y <= 10; y++) {
        fcf *= (1 + fadeRate);
        pv += fcf / Math.pow(1 + wacc, y);
      }
      lastCF = fcf;
    }

    // Terminal value (Gordon Growth Model)
    const terminalFcf = lastCF * (1 + terminalGrowthRate);
    const terminalValue = terminalFcf / (wacc - terminalGrowthRate);
    pv += terminalValue / Math.pow(1 + wacc, 10);

    if (pv <= 0) return null;

    const fairValue = pv;
    // Use fair value as denominator (same as Simply Wall St): (fair - current) / fair
    const discountPct = fairValue > 0 ? ((fairValue - currentPrice) / fairValue) * 100 : 0;
    const result: DCFResult = {
      fairValue,
      currentPrice,
      discountPct,
      wacc: wacc * 100,
      growthRate: growthRate * 100,
      terminalGrowthRate: terminalGrowthRate * 100,
      fcfBase: fcfPerShare,
      source,
    };
    cacheSet(key, result, TTL_24H);
    persistSet(key, result, TTL_24H);
    return result;
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// WHAT CHANGED IN THE LAST 90 DAYS
// ─────────────────────────────────────────────────────────────────────────────

export interface DeltaSignal {
  category: 'earnings' | 'valuation' | 'growth' | 'sentiment' | 'insiders' | 'price' | 'risk';
  label: string;
  direction: 'positive' | 'negative' | 'neutral';
  detail: string;
}

export interface WhatChangedResult {
  tldr: string;
  thesisVerdict: 'strengthened' | 'weakened' | 'unchanged';
  thesisReason: string;
  positives: string[];
  negatives: string[];
  changedAssumptions: string[];
  changedNarrative: string[];
  changedValuation: string[];
  changedRisks: string[];
  signals: DeltaSignal[];
  generatedAt: number;
}

export async function generateWhatChanged(
  groqApiKey: string,
  symbol: string,
  name: string,
  f: Fundamentals,
  currentPrice: number,
  currency: string,
  earnings: EarningsEvent[],
  insiders: InsiderTransaction[],
  news: NewsItem[],
  priceTarget: PriceTargetConsensus | null,
): Promise<WhatChangedResult> {

  const now90 = Date.now() / 1000 - 90 * 86400;

  // ── Delta signals (JS, no AI needed) ──────────────────────────────────────

  const signals: DeltaSignal[] = [];

  // 1. Recent earnings beats/misses (last 90 days)
  // Use reportDate (actual announcement date) for the 90-day window; fall back to fiscal period-end date
  const recentEarnings = earnings
    .filter(e => {
      const displayDate = e.reportDate ?? e.date;
      return displayDate && new Date(displayDate + 'T12:00:00').getTime() / 1000 >= now90;
    })
    .slice(0, 4);

  for (const e of recentEarnings) {
    const displayDate = e.reportDate ?? e.date;
    if (e.surprisePct != null) {
      const beat = e.surprisePct >= 0;
      signals.push({
        category: 'earnings',
        label: `Earnings ${beat ? 'Beat' : 'Miss'} (${displayDate})`,
        direction: beat ? 'positive' : 'negative',
        detail: `EPS surprise: ${e.surprisePct > 0 ? '+' : ''}${e.surprisePct.toFixed(1)}% | Actual: ${e.epsActual?.toFixed(2) ?? '—'} vs Est: ${e.epsEstimated?.toFixed(2) ?? '—'}`,
      });
    }
    if (e.revenueActual != null && e.revenueEstimated != null && e.revenueEstimated > 0) {
      const revSurp = ((e.revenueActual - e.revenueEstimated) / e.revenueEstimated) * 100;
      signals.push({
        category: 'earnings',
        label: `Revenue ${revSurp >= 0 ? 'Beat' : 'Miss'} (${displayDate})`,
        direction: revSurp >= 0 ? 'positive' : 'negative',
        detail: `Revenue surprise: ${revSurp > 0 ? '+' : ''}${revSurp.toFixed(1)}%`,
      });
    }
  }

  // 2. Valuation change (forward P/E vs trailing P/E)
  if (f.forwardPE != null && f.trailingPE != null && f.trailingPE > 0) {
    const multExp = ((f.forwardPE - f.trailingPE) / f.trailingPE) * 100;
    if (Math.abs(multExp) > 5) {
      signals.push({
        category: 'valuation',
        label: multExp < 0 ? 'Multiple Compression' : 'Multiple Expansion',
        direction: multExp < 0 ? 'negative' : 'positive',
        detail: `Trailing PE ${f.trailingPE.toFixed(1)}x → Forward PE ${f.forwardPE.toFixed(1)}x (${multExp > 0 ? '+' : ''}${multExp.toFixed(1)}%)`,
      });
    }
  }

  // 3. Price target vs current price
  if (priceTarget) {
    const { targetLow, targetConsensus, targetHigh } = priceTarget;
    if (targetConsensus != null && currentPrice > 0) {
      const upside = ((targetConsensus - currentPrice) / currentPrice) * 100;
      signals.push({
        category: 'valuation',
        label: upside >= 0 ? 'Consensus Upside' : 'Consensus Downside',
        direction: upside >= 10 ? 'positive' : upside <= -10 ? 'negative' : 'neutral',
        detail: `Analyst avg target ${currency}${targetConsensus.toFixed(2)} (${upside > 0 ? '+' : ''}${upside.toFixed(1)}% from current) | Range: ${currency}${(targetLow ?? 0).toFixed(2)}–${currency}${(targetHigh ?? 0).toFixed(2)}`,
      });
    }
  }

  // 4. Growth signals
  if (f.earningsGrowth != null) {
    const eg = f.earningsGrowth * 100;
    signals.push({
      category: 'growth',
      label: eg >= 0 ? 'Earnings Growth' : 'Earnings Decline',
      direction: eg >= 15 ? 'positive' : eg >= 0 ? 'neutral' : 'negative',
      detail: `YoY earnings growth: ${eg > 0 ? '+' : ''}${eg.toFixed(1)}%`,
    });
  }
  if (f.revenueGrowth != null) {
    const rg = f.revenueGrowth * 100;
    signals.push({
      category: 'growth',
      label: rg >= 0 ? 'Revenue Growth' : 'Revenue Decline',
      direction: rg >= 10 ? 'positive' : rg >= 0 ? 'neutral' : 'negative',
      detail: `Revenue growth YoY: ${rg > 0 ? '+' : ''}${rg.toFixed(1)}%`,
    });
  }

  // 5. Margin signals
  if (f.profitMargins != null) {
    const pm = f.profitMargins * 100;
    signals.push({
      category: 'growth',
      label: 'Net Profit Margin',
      direction: pm >= 15 ? 'positive' : pm >= 5 ? 'neutral' : 'negative',
      detail: `Net margin: ${pm.toFixed(1)}%`,
    });
  }

  // 6. Insider activity (last 90 days)
  const recentInsiders = insiders.filter(tx => {
    const d = tx.date ? new Date(tx.date).getTime() / 1000 : 0;
    return d >= now90;
  });
  const insiderBuys  = recentInsiders.filter(t => t.type === 'buy');
  const insiderSells = recentInsiders.filter(t => t.type === 'sell');
  if (insiderBuys.length > 0) {
    signals.push({
      category: 'insiders',
      label: `Insider Buying (${insiderBuys.length} transaction${insiderBuys.length > 1 ? 's' : ''})`,
      direction: 'positive',
      detail: insiderBuys.slice(0, 2).map(t => `${t.name ?? 'Insider'} (${t.role ?? ''}): bought ${Math.abs(t.shares ?? 0).toLocaleString()} shares`).join(' · '),
    });
  }
  if (insiderSells.length > 0) {
    signals.push({
      category: 'insiders',
      label: `Insider Selling (${insiderSells.length} transaction${insiderSells.length > 1 ? 's' : ''})`,
      direction: insiderSells.length > insiderBuys.length * 2 ? 'negative' : insiderSells.length > insiderBuys.length ? 'negative' : 'neutral',
      detail: insiderSells.slice(0, 2).map(t => `${t.name ?? 'Insider'} (${t.role ?? ''}): sold ${Math.abs(t.shares ?? 0).toLocaleString()} shares`).join(' · '),
    });
  }

  // 7. 52-week position
  if (f.fiftyTwoWeekHigh != null && f.fiftyTwoWeekLow != null && currentPrice > 0) {
    const pctFromHigh = ((currentPrice - f.fiftyTwoWeekHigh) / f.fiftyTwoWeekHigh) * 100;
    const pctFromLow  = ((currentPrice - f.fiftyTwoWeekLow)  / f.fiftyTwoWeekLow)  * 100;
    signals.push({
      category: 'price',
      label: '52-Week Position',
      direction: pctFromHigh >= -10 ? 'positive' : pctFromLow <= 20 ? 'negative' : 'neutral',
      detail: `${pctFromHigh.toFixed(1)}% from 52w high (${currency}${f.fiftyTwoWeekHigh.toFixed(2)}) · ${pctFromLow > 0 ? '+' : ''}${pctFromLow.toFixed(1)}% from 52w low (${currency}${f.fiftyTwoWeekLow.toFixed(2)})`,
    });
  }

  // 8. Debt risk
  if (f.debtToEquity != null && f.debtToEquity > 200) {
    signals.push({
      category: 'risk',
      label: 'High Leverage',
      direction: 'negative',
      detail: `Debt/Equity: ${f.debtToEquity.toFixed(0)}% — elevated financial risk`,
    });
  }
  if (f.currentRatio != null && f.currentRatio < 1) {
    signals.push({
      category: 'risk',
      label: 'Liquidity Risk',
      direction: 'negative',
      detail: `Current ratio: ${f.currentRatio.toFixed(2)} — current liabilities exceed current assets`,
    });
  }

  // ── Groom news for Groq (last 90 days, max 15 headlines) ─────────────────
  const cutoff90 = Date.now() - 90 * 86400 * 1000;
  const recentNews = news
    .filter(n => n.publishTime && n.publishTime * 1000 >= cutoff90)
    .slice(0, 15)
    .map(n => `[${new Date(n.publishTime * 1000).toISOString().slice(0, 10)}] ${n.title}`);

  // ── Build Groq prompt ─────────────────────────────────────────────────────
  const signalsSummary = signals.map(s =>
    `[${s.category.toUpperCase()}] ${s.direction === 'positive' ? '▲' : s.direction === 'negative' ? '▼' : '→'} ${s.label}: ${s.detail}`
  ).join('\n');

  const prompt = `You are a senior equity analyst. Analyze what has changed for ${name} (${symbol}) in the last 90 days.

QUANTITATIVE SIGNALS:
${signalsSummary || 'No quantitative signals available.'}

RECENT NEWS HEADLINES (last 90 days):
${recentNews.length > 0 ? recentNews.join('\n') : 'No recent news available.'}

KEY FUNDAMENTALS:
- Sector: ${f.sector ?? 'N/A'} | Industry: ${f.industry ?? 'N/A'}
- Revenue Growth: ${f.revenueGrowth != null ? (f.revenueGrowth * 100).toFixed(1) + '%' : 'N/A'}
- Earnings Growth: ${f.earningsGrowth != null ? (f.earningsGrowth * 100).toFixed(1) + '%' : 'N/A'}
- Gross Margin: ${f.grossMargins != null ? (f.grossMargins * 100).toFixed(1) + '%' : 'N/A'}
- Operating Margin: ${f.operatingMargins != null ? (f.operatingMargins * 100).toFixed(1) + '%' : 'N/A'}
- Forward PE: ${f.forwardPE?.toFixed(1) ?? 'N/A'} | Trailing PE: ${f.trailingPE?.toFixed(1) ?? 'N/A'}
- Price: ${currency}${currentPrice.toFixed(2)}

Based on ALL of the above, respond ONLY with this JSON (no markdown, no explanation):
{
  "tldr": "2-3 sentence summary of the most important changes in the last 90 days",
  "thesisVerdict": "strengthened|weakened|unchanged",
  "thesisReason": "1 sentence explaining why the investment thesis strengthened, weakened, or is unchanged",
  "positives": ["bullet 1", "bullet 2", "bullet 3"],
  "negatives": ["bullet 1", "bullet 2"],
  "changedAssumptions": ["e.g. Revenue growth estimate revised up from X% to Y%"],
  "changedNarrative": ["e.g. Market now pricing in AI monetization upside"],
  "changedValuation": ["e.g. Forward P/E expanded from 20x to 28x on margin improvement"],
  "changedRisks": ["e.g. Macro headwinds from rising rates now more acute"]
}`;

  let parsed: Omit<WhatChangedResult, 'signals' | 'generatedAt'> = {
    tldr: 'Analysis unavailable — check your Groq API key.',
    thesisVerdict: 'unchanged',
    thesisReason: '',
    positives: [],
    negatives: [],
    changedAssumptions: [],
    changedNarrative: [],
    changedValuation: [],
    changedRisks: [],
  };

  if (groqApiKey) {
    try {
      const groqRes = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 1000,
        },
        { headers: { Authorization: `Bearer ${groqApiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 }
      );
      const raw = groqRes.data?.choices?.[0]?.message?.content ?? '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const p = JSON.parse(jsonMatch[0]);
        if (p.tldr) parsed = { ...parsed, ...p };
      }
    } catch { /* fallback to JS signals only */ }
  }

  return {
    ...parsed,
    signals,
    generatedAt: Date.now(),
  };
}