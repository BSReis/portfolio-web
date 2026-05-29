import { Holding, Transaction } from '../context/PortfolioContext';

export interface ShareData {
  n: string;          // portfolio name
  hv?: boolean;       // hideValues
  h: Array<{         // holdings (compact keys)
    s: string;       // symbol
    nm: string;      // name
    sh: number;      // shares
    ap: number;      // avgPrice
    pd: string;      // purchaseDate
    c?: string;      // currency (optional)
  }>;
  t: Array<{         // transactions (compact keys)
    s: string;       // symbol
    tp: 'b' | 's';   // type: buy | sell
    sh: number;      // shares
    p: number;       // price
    d: string;       // date
    f?: number;      // fee (optional)
  }>;
}

export function encodePortfolioShare(
  name: string,
  holdings: Holding[],
  transactions: Transaction[],
  hideValues?: boolean,
): string {
  const data: ShareData = {
    n: name,
    ...(hideValues ? { hv: true } : {}),
    h: holdings.map((h) => ({
      s: h.symbol,
      nm: h.name,
      sh: h.shares,
      ap: h.avgPrice,
      pd: h.purchaseDate,
      ...(h.currency ? { c: h.currency } : {}),
    })),
    t: transactions.map((t) => ({
      s: t.symbol,
      tp: t.type === 'buy' ? 'b' : 's',
      sh: t.shares,
      p: t.price,
      d: t.date,
      ...(t.fee ? { f: t.fee } : {}),
    })),
  };
  const json = JSON.stringify(data);
  // btoa needs Latin1 chars; use encodeURIComponent → unescape to handle UTF-8
  return btoa(unescape(encodeURIComponent(json)));
}

export function decodePortfolioShare(encoded: string): {
  name: string;
  holdings: Holding[];
  transactions: Transaction[];
  hideValues: boolean;
} | null {
  try {
    const json = decodeURIComponent(escape(atob(encoded)));
    const data = JSON.parse(json) as ShareData;
    const holdings: Holding[] = data.h.map((h) => ({
      symbol: h.s,
      name: h.nm,
      shares: h.sh,
      avgPrice: h.ap,
      purchaseDate: h.pd,
      ...(h.c ? { currency: h.c } : {}),
    }));
    const transactions: Transaction[] = data.t.map((t, i) => ({
      id: `shared-${i}`,
      symbol: t.s,
      type: t.tp === 'b' ? 'buy' : 'sell',
      shares: t.sh,
      price: t.p,
      date: t.d,
      ...(t.f ? { fee: t.f } : {}),
    }));
    return { name: data.n, holdings, transactions, hideValues: data.hv ?? false };
  } catch {
    return null;
  }
}
