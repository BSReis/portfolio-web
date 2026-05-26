import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

// Proxy for trumpstruth.org RSS feed to bypass CORS in the browser
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { data, status } = await axios.get('https://trumpstruth.org/feed', {
      timeout: 10000,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      responseType: 'text',
    });

    res.status(status).setHeader('Content-Type', 'application/xml; charset=utf-8').send(data);
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status ?? 500;
    const message = (err as Error)?.message ?? 'Unknown error';
    res.status(status).json({ error: message });
  }
}
