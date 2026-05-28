import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

// ── Server-side caches (persist across requests in the same Node.js process) ──
interface Entry<T> { data: T; expiresAt: number; }
const _tickerCache: Entry<Record<string, number>> | null = null;
let _tickerCacheEntry: Entry<Record<string, number>> | null = null;
const _epsCache = new Map<string, Entry<Array<{ end: string; val: number }>>>();

const SEC_HEADERS = {
  'User-Agent': 'portfolio-app admin@portfolio.app',
  Accept: 'application/json',
};

async function getTickerMap(): Promise<Record<string, number>> {
  if (_tickerCacheEntry && Date.now() < _tickerCacheEntry.expiresAt) {
    return _tickerCacheEntry.data;
  }
  const { data } = await axios.get('https://www.sec.gov/files/company_tickers.json', {
    headers: SEC_HEADERS, timeout: 15000,
  });
  // data is { "0": { cik_str, ticker, title }, "1": {...}, ... }
  const map: Record<string, number> = {};
  for (const v of Object.values(data) as Array<{ cik_str: number; ticker: string }>) {
    map[v.ticker.toUpperCase()] = v.cik_str;
  }
  _tickerCacheEntry = { data: map, expiresAt: Date.now() + 24 * 3600 * 1000 };
  return map;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const symbol = (req.query.symbol as string | undefined)?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  // Check cache
  const cached = _epsCache.get(symbol);
  if (cached && Date.now() < cached.expiresAt) {
    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=86400');
    return res.status(200).json(cached.data);
  }

  try {
    const tickerMap = await getTickerMap();
    const cik = tickerMap[symbol];
    if (!cik) return res.status(404).json({ error: `CIK not found for ${symbol}` });

    const paddedCIK = String(cik).padStart(10, '0');
    const { data: facts } = await axios.get(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCIK}.json`,
      { headers: SEC_HEADERS, timeout: 20000 }
    );

    const units: Array<{ end: string; val: number; form: string; fp: string; filed: string }> =
      facts?.facts?.['us-gaap']?.EarningsPerShareDiluted?.units?.['USD/shares'] ?? [];

    // Keep only 10-K FY entries, deduplicate by end date (keep most recently filed)
    const seen = new Map<string, { end: string; val: number; filed: string }>();
    for (const e of units) {
      if (e.form !== '10-K' || e.fp !== 'FY') continue;
      const existing = seen.get(e.end);
      if (!existing || e.filed > existing.filed) {
        seen.set(e.end, { end: e.end, val: e.val, filed: e.filed });
      }
    }

    const result = Array.from(seen.values())
      .sort((a, b) => a.end.localeCompare(b.end))
      .map(e => ({ end: e.end, val: e.val }));

    _epsCache.set(symbol, { data: result, expiresAt: Date.now() + 7 * 24 * 3600 * 1000 });
    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=86400');
    res.status(200).json(result);
  } catch (err: any) {
    const status = err.response?.status ?? 502;
    res.status(status).json({ error: err.message ?? 'SEC EDGAR proxy error' });
  }
}
