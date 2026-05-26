import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

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

  try {
    const { data, status } = await axios.get(url, { timeout: 15000 });
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json(data);
  } catch (err: any) {
    const status = err.response?.status ?? 502;
    res.status(status).json(err.response?.data ?? { error: 'Alpha Vantage proxy error' });
  }
}
