/**
 * Format a number with European locale: dot as thousands separator, comma as decimal.
 * e.g. 100222.46 → "100.222,46"
 */
export function fmtNum(v: number, decimals = 2): string {
  const [int, dec] = Math.abs(v).toFixed(decimals).split('.');
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = v < 0 ? '-' : '';
  return decimals > 0 ? `${sign}${intFmt},${dec}` : `${sign}${intFmt}`;
}

export interface FifoLot {
  txId: string;
  totalShares: number;     // original shares in this buy
  remainingShares: number; // shares still held (0 = fully sold)
  soldShares: number;      // shares consumed by sells (FIFO)
}

export interface FifoResult {
  lots: FifoLot[];
  avgPriceRemaining: number; // FIFO cost basis of remaining position
  realizedGain: number;      // total realized gain from sells
}

/**
 * Replay transactions in chronological order using FIFO.
 * Sells consume the oldest buy lots first.
 */
export function calcFifo(
  txs: { id: string; type: 'buy' | 'sell'; shares: number; price: number; date: string }[]
): FifoResult {
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));

  // Build lot queue (buy lots in order)
  const lots: (FifoLot & { price: number })[] = [];
  let realizedGain = 0;

  for (const tx of sorted) {
    if (tx.type === 'buy') {
      lots.push({ txId: tx.id, totalShares: tx.shares, remainingShares: tx.shares, soldShares: 0, price: tx.price });
    } else {
      // FIFO: consume oldest lots first
      let toSell = tx.shares;
      for (const lot of lots) {
        if (toSell <= 0) break;
        if (lot.remainingShares <= 0) continue;
        const consumed = Math.min(lot.remainingShares, toSell);
        realizedGain += (tx.price - lot.price) * consumed;
        lot.soldShares += consumed;
        lot.remainingShares -= consumed;
        toSell -= consumed;
      }
    }
  }

  // avgPrice of remaining position = weighted average of remaining lots
  const totalRemaining = lots.reduce((s, l) => s + l.remainingShares, 0);
  const totalCostRemaining = lots.reduce((s, l) => s + l.remainingShares * l.price, 0);
  const avgPriceRemaining = totalRemaining > 0 ? totalCostRemaining / totalRemaining : 0;

  return {
    lots: lots.map(({ txId, totalShares, remainingShares, soldShares }) => ({
      txId, totalShares, remainingShares, soldShares,
    })),
    avgPriceRemaining,
    realizedGain,
  };
}
