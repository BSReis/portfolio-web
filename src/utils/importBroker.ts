export type BrokerType = 'ibkr' | 'trade_republic' | 'trading212';

export interface BrokerTransaction {
  date: string;       // ISO YYYY-MM-DD
  symbol: string;     // ticker as-is from broker
  name: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  fee?: number;
  currency: string;
  isin?: string;
  assetClass?: string;
  externalId?: string;
}

/**
 * Parse an Interactive Brokers Activity Statement CSV.
 * Only processes "Transaction History,Data" rows with type Buy or Sell.
 */
export function parseIBKR(csvText: string): BrokerTransaction[] {
  const lines = csvText.split(/\r?\n/);
  const results: BrokerTransaction[] = [];

  for (const line of lines) {
    // Only process Transaction History data rows
    if (!line.startsWith('Transaction History,Data,')) continue;

    // IBKR CSVs use commas but some fields are quoted — split carefully
    const cols = splitCSVLine(line);
    // cols: [0]=Section, [1]=Type, [2]=Date, [3]=Account, [4]=Description,
    //        [5]=Transaction Type, [6]=Symbol, [7]=Quantity, [8]=Price,
    //        [9]=Price Currency, [10]=Gross Amount, [11]=Commission, [12]=Net Amount
    if (cols.length < 10) continue;

    const txType = cols[5]?.trim();
    if (txType !== 'Buy' && txType !== 'Sell') continue;

    const rawSymbol = cols[6]?.trim();
    const description = cols[4]?.trim();
    if (!rawSymbol || rawSymbol === '-') continue;

    const qty = parseFloat(cols[7]?.trim());
    const price = parseFloat(cols[8]?.trim());
    const currency = cols[9]?.trim() || 'USD';
    const commission = Math.abs(parseFloat(cols[11]?.trim() ?? '')) || 0;
    const dateRaw = cols[2]?.trim(); // YYYY-MM-DD

    if (!isFinite(qty) || !isFinite(price) || qty === 0) continue;

    const mapped = normalizeSymbol(rawSymbol);

    results.push({
      date: dateRaw,
      symbol: mapped,
      name: extractName(description),
      type: txType === 'Buy' ? 'buy' : 'sell',
      shares: Math.abs(qty),
      price: Math.abs(price),
      fee: commission,
      currency,
      externalId: `ibkr:${dateRaw}:${rawSymbol}:${txType}:${Math.abs(qty)}:${Math.abs(price)}`,
    });
  }

  // Sort chronologically
  return results.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Parse a Trade Republic transaction export CSV.
 * Only processes TRADING rows with BUY/SELL types.
 */
export function parseTradeRepublic(csvText: string): BrokerTransaction[] {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const header = splitCSVLine(lines[0]).map(normalizeCsvCell);
  const index = (name: string) => header.indexOf(name);

  const dateIdx = index('date');
  const categoryIdx = index('category');
  const typeIdx = index('type');
  const assetClassIdx = index('asset_class');
  const nameIdx = index('name');
  const symbolIdx = index('symbol');
  const sharesIdx = index('shares');
  const priceIdx = index('price');
  const currencyIdx = index('currency');
  const txIdIdx = index('transaction_id');

  if ([dateIdx, categoryIdx, typeIdx, nameIdx, symbolIdx, sharesIdx, priceIdx, currencyIdx].some((i) => i < 0)) {
    return [];
  }

  const results: BrokerTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]).map(normalizeCsvCell);
    const category = cols[categoryIdx]?.toUpperCase();
    const txType = cols[typeIdx]?.toUpperCase();

    if (category !== 'TRADING') continue;
    if (txType !== 'BUY' && txType !== 'SELL') continue;

    const rawSymbol = cols[symbolIdx]?.trim();
    const name = cols[nameIdx]?.trim();
    const date = cols[dateIdx]?.trim();
    const assetClass = cols[assetClassIdx]?.trim() || undefined;
    const currency = cols[currencyIdx]?.trim() || 'EUR';
    const shares = parseFloat(cols[sharesIdx] ?? '');
    const price = parseFloat(cols[priceIdx] ?? '');
    const externalId = txIdIdx >= 0 ? cols[txIdIdx]?.trim() : undefined;

    if (!rawSymbol || !name || !date) continue;
    if (!isFinite(shares) || !isFinite(price) || shares === 0 || price <= 0) continue;

    results.push({
      date,
      symbol: rawSymbol,
      name,
      type: txType === 'BUY' ? 'buy' : 'sell',
      shares: Math.abs(shares),
      price: Math.abs(price),
      currency,
      assetClass,
      externalId: externalId || `tr:${date}:${rawSymbol}:${txType}:${Math.abs(shares)}:${Math.abs(price)}`,
    });
  }

  return results.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Parse a Trading212 account statement CSV.
 * Only processes Market buy / Market sell rows.
 */
export function parseTrading212(csvText: string): BrokerTransaction[] {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const header = splitCSVLine(lines[0]).map(normalizeCsvCell);
  const index = (name: string) => header.indexOf(name);

  const actionIdx = index('Action');
  const timeIdx = index('Time');
  const tickerIdx = index('Ticker');
  const nameIdx = index('Name');
  const sharesIdx = index('No. of shares');
  const priceIdx = index('Price / share');
  const currencyIdx = index('Currency (Price / share)');
  const idIdx = index('ID');

  if ([actionIdx, timeIdx, tickerIdx, nameIdx, sharesIdx, priceIdx, currencyIdx].some((i) => i < 0)) {
    return [];
  }

  const results: BrokerTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]).map(normalizeCsvCell);
    const action = cols[actionIdx]?.trim();
    if (action !== 'Market buy' && action !== 'Market sell') continue;

    const isin = cols[index('ISIN')]?.trim();
    const rawSymbol = cols[tickerIdx]?.trim();
    const name = cols[nameIdx]?.trim();
    const dateTime = cols[timeIdx]?.trim();
    const shares = parseFloat(cols[sharesIdx] ?? '');
    const price = parseFloat(cols[priceIdx] ?? '');
    const currency = cols[currencyIdx]?.trim() || 'EUR';
    const externalId = idIdx >= 0 ? cols[idIdx]?.trim() : undefined;

    if (!rawSymbol || !name || !dateTime) continue;
    if (!isFinite(shares) || !isFinite(price) || shares === 0 || price <= 0) continue;

    const date = dateTime.slice(0, 10);
    const normalizedPrice = normalizeBrokerPrice(price, currency);
    const normalizedCurrency = normalizeBrokerCurrency(currency);

    results.push({
      date,
      symbol: rawSymbol,
      name,
      type: action === 'Market buy' ? 'buy' : 'sell',
      shares: Math.abs(shares),
      price: Math.abs(normalizedPrice),
      currency: normalizedCurrency,
      isin: isin || undefined,
      externalId: externalId || `trading212:${date}:${rawSymbol}:${action}:${Math.abs(shares)}:${Math.abs(price)}`,
    });
  }

  return results.sort((a, b) => a.date.localeCompare(b.date));
}

/** Split a CSV line respecting quoted fields */
function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function normalizeCsvCell(value: string): string {
  return value.replace(/^"|"$/g, '').trim();
}

function normalizeBrokerCurrency(currency: string): string {
  const upper = currency.trim().toUpperCase();
  if (upper === 'GBX' || currency.trim() === 'GBp') return 'GBP';
  return upper;
}

function normalizeBrokerPrice(price: number, currency: string): number {
  const upper = currency.trim().toUpperCase();
  if (upper === 'GBX' || currency.trim() === 'GBp') return price / 100;
  return price;
}

/**
 * IBKR sometimes uses non-standard tickers (e.g. NVD for NVDA on EU exchanges,
 * NOVd for Novo Nordisk). Map known ones to standard tickers.
 */
const IBKR_SYMBOL_MAP: Record<string, string> = {
  // European-listed via XETRA (.DE) — EUR quoted
  IWDA: 'IWDA.AS',   // iShares Core MSCI World UCITS ETF USD (Acc)
  VWCE: 'VWCE.DE',   // Vanguard FTSE All-World UCITS ETF USD Accumulation
  SPYL: 'SPYL.DE',   // SPDR S&P 500 UCITS ETF
  AMD:  'AMD.DE',    // Advanced Micro Devices
  NOVd: 'NOV.DE',   // Novo Nordisk
  NOV:  'NOV.DE',
  // US-listed via EU exchange (EUR price from IBKR → map to US ticker)
  NVD:  'NVDA',      // NVIDIA (EU-listed, but NVDA USD works fine)
};

function normalizeSymbol(raw: string): string {
  return IBKR_SYMBOL_MAP[raw] ?? raw;
}

/** Extract a clean name from the IBKR description field */
function extractName(description: string): string {
  // Remove common suffixes IBKR appends
  return description
    .replace(/\s*\([A-Z0-9]+\)\s*$/, '')  // remove trailing ISIN
    .trim();
}
