import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

// Generic catch-all proxy for query1.finance.yahoo.com
// Forwards any path + query string from the browser to Yahoo Finance
// This sidesteps CORS which blocks direct browser requests.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const segments = req.query.path as string[];
  const path = segments ? segments.join('/') : '';

  // Build query string — exclude the internal "path" param used by Next.js routing
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
  const url = `https://query1.finance.yahoo.com/${path}${qs ? `?${qs}` : ''}`;

  try {
    const { data, status, headers } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'application/json',
      },
      timeout: 15000,
    });

    // Forward relevant headers
    const contentType = headers['content-type'];
    if (contentType) res.setHeader('Content-Type', String(contentType));
    res.setHeader('Cache-Control', 'no-store');

    res.status(status).json(data);
  } catch (err: any) {
    const status = err.response?.status ?? 502;
    res.status(status).json(err.response?.data ?? { error: 'Yahoo Finance proxy error' });
  }
}
