import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

// Server-side in-memory cache: survives across requests within the same Node.js process instance
interface ServerCacheEntry { data: unknown; expiresAt: number; }
const _serverCache = new Map<string, ServerCacheEntry>();

// Endpoints that change infrequently — cache for 24h to stay within AV 25 req/day limit
const LONG_CACHE_FUNCTIONS = new Set([
  'EARNINGS', 'INCOME_STATEMENT', 'BALANCE_SHEET', 'CASH_FLOW',
  'OVERVIEW', 'TIME_SERIES_MONTHLY_ADJUSTED',
]);

// Proxy for Alpha Vantage API
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const segments = req.query.path as string[];
  const path = segments ? segments.join('/') : '';

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key === 'path') continue;
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, v));
    } else if (value != null) {
      params.append(key, value);
    }
  }

  const qs = params.toString();
  const url = `https://www.alphavantage.co/${path}${qs ? `?${qs}` : ''}`;
  const fn = (req.query.function as string | undefined) ?? '';
  const isLongCache = LONG_CACHE_FUNCTIONS.has(fn);
  const TTL_MS = isLongCache ? 24 * 60 * 60 * 1000 : 60 * 1000; // 24h vs 1min

  // Check server-side cache
  const cached = _serverCache.get(url);
  if (cached && Date.now() < cached.expiresAt) {
    res.setHeader('Cache-Control', isLongCache ? 's-maxage=86400, stale-while-revalidate=3600' : 'no-store');
    res.setHeader('X-Cache', 'HIT');
    res.status(200).json(cached.data);
    return;
  }

  try {
    const { data, status } = await axios.get(url, { timeout: 15000 });
    // Only cache successful responses that aren't rate-limit messages
    const isRateLimited = typeof data === 'object' && data !== null && 'Information' in data;
    if (!isRateLimited) {
      _serverCache.set(url, { data, expiresAt: Date.now() + TTL_MS });
    }
    res.setHeader('Cache-Control', isLongCache && !isRateLimited ? 's-maxage=86400, stale-while-revalidate=3600' : 'no-store');
    res.status(status).json(data);
  } catch (err: any) {
    const status = err.response?.status ?? 502;
    res.status(status).json(err.response?.data ?? { error: 'Alpha Vantage proxy error' });
  }
}
