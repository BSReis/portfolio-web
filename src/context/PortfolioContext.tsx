import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { searchStocks } from '../services/api';
import { getPriceAlerts, replacePriceAlerts, PriceAlert } from '../services/notifications';
import { parseIBKR, parseTradeRepublic, parseTrading212, BrokerTransaction, BrokerType } from '../utils/importBroker';
import { calcFifo } from '../utils/format';
import { useSettings } from './SettingsContext';

export interface Holding {
  symbol: string;
  name: string;
  shares: number;
  avgPrice: number;
  purchaseDate: string; // ISO date string, ex: '2024-03-15'
  currency?: string;    // native currency code (e.g. 'USD', 'EUR', 'DKK')
}

export interface Transaction {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  fee?: number;
  date: string; // ISO date string
}

export interface Portfolio {
  id: string;
  name: string;
}

export interface WatchlistItem {
  symbol: string;
  name: string;
}

interface PortfolioContextValue {
  holdings: Holding[];
  transactions: Transaction[];
  loading: boolean;
  portfolios: Portfolio[];
  activePortfolioId: string;
  activePortfolioName: string;
  addHolding: (holding: Holding) => void;
  removeHolding: (symbol: string) => void;
  addTransaction: (symbol: string, type: 'buy' | 'sell', shares: number, price: number, date: string, name?: string, fee?: number, currency?: string) => void;
  deleteTransaction: (id: string) => void;
  updateTransaction: (id: string, updates: { shares: number; price: number; date: string; fee?: number }) => void;
  exportPortfolio: (extra?: Record<string, string>) => Promise<void>;
  importPortfolio: () => Promise<{ ok: boolean; message: string; apiKeys?: { fmpKey?: string; fhKey?: string; groqKey?: string; tavilyKey?: string; avKey?: string } }>;
  importBrokerCSV: (broker: BrokerType) => Promise<{ ok: boolean; message: string }>;
  clearPortfolio: () => Promise<void>;
  createPortfolio: (name: string) => Promise<void>;
  renamePortfolio: (id: string, name: string) => Promise<void>;
  deletePortfolio: (id: string) => Promise<void>;
  switchPortfolio: (id: string) => Promise<void>;
  switchToCombined: () => Promise<void>;
  watchlist: WatchlistItem[];
  addToWatchlist: (item: WatchlistItem) => void;
  removeFromWatchlist: (symbol: string) => void;
}

const PORTFOLIOS_KEY = '@portfolios_list';
const ACTIVE_KEY = '@active_portfolio_id';
const holdingsKey = (id: string) => `@holdings_${id}`;
const txKey = (id: string) => `@transactions_${id}`;
const WATCHLIST_KEY = '@watchlist';

const PortfolioContext = createContext<PortfolioContextValue | undefined>(undefined);

export const PortfolioProvider = ({ children }: { children: ReactNode }) => {
  const { ratesInEur } = useSettings();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [activePortfolioId, setActivePortfolioId] = useState<string>('');
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const isCombinedPortfolio = activePortfolioId === '__combined__';

  // Inicializar — com migração automática do formato antigo
  useEffect(() => {
    (async () => {
      try {
      let list: Portfolio[];
      let activeId: string;
      const listJson = await AsyncStorage.getItem(PORTFOLIOS_KEY);
      const savedActiveId = await AsyncStorage.getItem(ACTIVE_KEY);
      if (listJson) {
        list = JSON.parse(listJson) as Portfolio[];
        activeId = savedActiveId && list.some((p) => p.id === savedActiveId)
          ? savedActiveId
          : list[0]?.id ?? 'portfolio_1';
      } else {
        // Migrar do formato antigo (single portfolio)
        const oldH = await AsyncStorage.getItem('@portfolio_holdings');
        const oldT = await AsyncStorage.getItem('@portfolio_transactions');
        const defaultId = 'portfolio_1';
        list = [{ id: defaultId, name: 'Portfolio' }];
        activeId = defaultId;
        await AsyncStorage.setItem(PORTFOLIOS_KEY, JSON.stringify(list));
        await AsyncStorage.setItem(ACTIVE_KEY, activeId);
        if (oldH) {
          await AsyncStorage.setItem(holdingsKey(defaultId), oldH);
          await AsyncStorage.removeItem('@portfolio_holdings');
        }
        if (oldT) {
          await AsyncStorage.setItem(txKey(defaultId), oldT);
          await AsyncStorage.removeItem('@portfolio_transactions');
        }
      }
      const [hJson, tJson, wJson] = await Promise.all([
        AsyncStorage.getItem(holdingsKey(activeId)),
        AsyncStorage.getItem(txKey(activeId)),
        AsyncStorage.getItem(WATCHLIST_KEY),
      ]);
      const loadedHoldings: Holding[] = hJson ? JSON.parse(hJson) as Holding[] : [];
      const loadedTxs: Transaction[] = tJson ? JSON.parse(tJson) as Transaction[] : [];
      const loadedWatchlist: WatchlistItem[] = wJson ? JSON.parse(wJson) as WatchlistItem[] : [];

      // Reconcile holding.shares and avgPrice from transactions using FIFO
      const reconciledHoldings = loadedHoldings.map(h => {
        const symTxs = loadedTxs
          .filter(t => t.symbol === h.symbol)
          .sort((a, b) => a.date.localeCompare(b.date));
        if (symTxs.length === 0) return h;
        const { avgPriceRemaining, lots } = calcFifo(symTxs);
        const totalShares = lots.reduce((s, l) => s + l.remainingShares, 0);
        if (totalShares <= 0) return null;
        const earliestDate = symTxs.filter(t => t.type === 'buy').reduce(
          (min, t) => (!min || t.date < min ? t.date : min), ''
        );
        return {
          ...h,
          shares: totalShares,
          avgPrice: avgPriceRemaining,
          purchaseDate: earliestDate || h.purchaseDate,
        };
      }).filter((h): h is Holding => h !== null);

      setPortfolios(list);
      setActivePortfolioId(activeId);
      setHoldings(reconciledHoldings);
      setTransactions(loadedTxs);
      setWatchlist(loadedWatchlist);
      } catch (e) {
        console.error('[PortfolioContext] init failed:', e);
        // Fallback: empty state so the app at least renders
        const defaultId = 'portfolio_1';
        setPortfolios([{ id: defaultId, name: 'Portfolio' }]);
        setActivePortfolioId(defaultId);
        setHoldings([]);
        setTransactions([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Guardar holdings sempre que mudam (não guardar no modo combinado — é só leitura)
  useEffect(() => {
    if (!loading && activePortfolioId && activePortfolioId !== '__combined__') {
      AsyncStorage.setItem(holdingsKey(activePortfolioId), JSON.stringify(holdings));
    }
  }, [holdings, loading, activePortfolioId]);

  // Guardar transações sempre que mudam
  useEffect(() => {
    if (!loading && activePortfolioId && activePortfolioId !== '__combined__') {
      AsyncStorage.setItem(txKey(activePortfolioId), JSON.stringify(transactions));
    }
  }, [transactions, loading, activePortfolioId]);

  const addHolding = (holding: Holding) => {
    if (isCombinedPortfolio) return;
    setHoldings((prev) => {
      const existing = prev.find((h) => h.symbol === holding.symbol);
      if (existing) {
        return prev.map((h) =>
          h.symbol === holding.symbol
            ? {
                ...h,
                shares: h.shares + holding.shares,
                avgPrice:
                  (h.avgPrice * h.shares + holding.avgPrice * holding.shares) /
                  (h.shares + holding.shares),
              }
            : h
        );
      }
      return [...prev, holding];
    });
    // Regista como transação de compra
    const tx: Transaction = {
      id: Date.now().toString(),
      symbol: holding.symbol,
      type: 'buy',
      shares: holding.shares,
      price: holding.avgPrice,
      fee: 0,
      date: holding.purchaseDate,
    };
    setTransactions((prev) => [tx, ...prev]);
  };

  const removeHolding = (symbol: string) => {
    if (isCombinedPortfolio) return;
    setHoldings((prev) => prev.filter((h) => h.symbol !== symbol));
    setTransactions((prev) => prev.filter((t) => t.symbol !== symbol));
  };

  const clearPortfolio = async () => {
    if (isCombinedPortfolio) return;
    setHoldings([]);
    setTransactions([]);
    await Promise.all([
      AsyncStorage.removeItem(holdingsKey(activePortfolioId)),
      AsyncStorage.removeItem(txKey(activePortfolioId)),
    ]);
  };

  const createPortfolio = async (name: string) => {
    const id = `portfolio_${Date.now()}`;
    const newPortfolio: Portfolio = { id, name };
    const updated = [...portfolios, newPortfolio];
    setPortfolios(updated);
    await AsyncStorage.setItem(PORTFOLIOS_KEY, JSON.stringify(updated));
    await switchPortfolio(id);
  };

  const renamePortfolio = async (id: string, name: string) => {
    const updated = portfolios.map((p) => (p.id === id ? { ...p, name } : p));
    setPortfolios(updated);
    await AsyncStorage.setItem(PORTFOLIOS_KEY, JSON.stringify(updated));
  };

  const deletePortfolio = async (id: string) => {
    if (portfolios.length <= 1) return;
    const updated = portfolios.filter((p) => p.id !== id);
    await AsyncStorage.multiRemove([holdingsKey(id), txKey(id)]);
    setPortfolios(updated);
    await AsyncStorage.setItem(PORTFOLIOS_KEY, JSON.stringify(updated));
    if (activePortfolioId === id) {
      await switchPortfolio(updated[0].id);
    }
  };

  const switchPortfolio = async (id: string) => {
    if (id === activePortfolioId) return;
    // Save current portfolio before switching (skip if in combined mode — read-only)
    if (activePortfolioId !== '__combined__') {
      await Promise.all([
        AsyncStorage.setItem(holdingsKey(activePortfolioId), JSON.stringify(holdings)),
        AsyncStorage.setItem(txKey(activePortfolioId), JSON.stringify(transactions)),
      ]);
    }
    const [hJson, tJson] = await Promise.all([
      AsyncStorage.getItem(holdingsKey(id)),
      AsyncStorage.getItem(txKey(id)),
    ]);
    setActivePortfolioId(id);
    await AsyncStorage.setItem(ACTIVE_KEY, id);
    setHoldings(hJson ? JSON.parse(hJson) as Holding[] : []);
    setTransactions(tJson ? JSON.parse(tJson) as Transaction[] : []);
  };

  const switchToCombined = async () => {
    // Save current portfolio before switching
    if (activePortfolioId !== '__combined__') {
      await Promise.all([
        AsyncStorage.setItem(holdingsKey(activePortfolioId), JSON.stringify(holdings)),
        AsyncStorage.setItem(txKey(activePortfolioId), JSON.stringify(transactions)),
      ]);
    }
    // Load and merge all portfolios' holdings
    const allHoldingsArrays = await Promise.all(
      portfolios.map(async (p) => {
        const json = await AsyncStorage.getItem(holdingsKey(p.id)).catch(() => null);
        return json ? JSON.parse(json) as Holding[] : [];
      })
    );
    const merged = new Map<string, Holding>();
    for (const hs of allHoldingsArrays) {
      for (const h of hs) {
        const existing = merged.get(h.symbol);
        if (existing) {
          const totalShares = existing.shares + h.shares;
          merged.set(h.symbol, {
            ...existing,
            shares: totalShares,
            avgPrice: (existing.avgPrice * existing.shares + h.avgPrice * h.shares) / totalShares,
            purchaseDate: h.purchaseDate < existing.purchaseDate ? h.purchaseDate : existing.purchaseDate,
          });
        } else {
          merged.set(h.symbol, { ...h });
        }
      }
    }
    // Load and merge all transactions
    const allTxArrays = await Promise.all(
      portfolios.map(async (p) => {
        const json = await AsyncStorage.getItem(txKey(p.id)).catch(() => null);
        return json ? JSON.parse(json) as Transaction[] : [];
      })
    );
    setActivePortfolioId('__combined__');
    // Do NOT persist '__combined__' to ACTIVE_KEY — next app open restores last real portfolio
    setHoldings(Array.from(merged.values()));
    setTransactions(allTxArrays.flat());
  };

  const addTransaction = (symbol: string, type: 'buy' | 'sell', shares: number, price: number, date: string, name?: string, fee = 0, currency?: string) => {
    if (isCombinedPortfolio) return;
    const tx: Transaction = { id: Date.now().toString(), symbol, type, shares, price, fee, date };
    // Compute FIFO using current transactions + the new one, sorted by date
    const symTxs = [...transactions.filter(t => t.symbol === symbol), tx]
      .sort((a, b) => a.date.localeCompare(b.date));
    const { avgPriceRemaining, lots } = calcFifo(symTxs);
    const totalShares = lots.reduce((s, l) => s + l.remainingShares, 0);
    const earliestDate = symTxs
      .filter(t => t.type === 'buy')
      .reduce((min, t) => (!min || t.date < min ? t.date : min), '');

    setHoldings((prev) => {
      // --- Update stock holding ---
      const exists = prev.some((h) => h.symbol === symbol);
      let updated: Holding[];
      if (totalShares <= 0) {
        updated = prev.filter((h) => h.symbol !== symbol);
      } else if (!exists) {
        updated = [...prev, { symbol, name: name ?? symbol, shares: totalShares, avgPrice: avgPriceRemaining, purchaseDate: earliestDate, currency }];
      } else {
        updated = prev.map((h) =>
          h.symbol !== symbol ? h :
          { ...h, shares: totalShares, avgPrice: avgPriceRemaining, purchaseDate: earliestDate || h.purchaseDate, currency: h.currency ?? currency }
        );
      }

      // --- Update CASH holding ---
      // Resolve currency from existing holding first, then from parameter
      const holdingCurrency = (prev.find((h) => h.symbol === symbol)?.currency ?? currency)?.toUpperCase();
      if (!holdingCurrency) return updated;

      const tradeValue = shares * price;
      // buy → cash decreases (+ fee); sell → cash increases (- fee)
      const cashDelta = type === 'buy' ? -(tradeValue + fee) : (tradeValue - fee);

      const exactCashSymbol = `CASH_${holdingCurrency}`;
      const exactCashHolding = updated.find((h) => h.symbol === exactCashSymbol);

      if (exactCashHolding) {
        // Same currency — no conversion needed
        const newCashAmount = Math.round((exactCashHolding.shares + cashDelta) * 100) / 100;
        if (newCashAmount < 0.001) {
          return updated.filter((h) => h.symbol !== exactCashSymbol);
        }
        return updated.map((h) =>
          h.symbol === exactCashSymbol ? { ...h, shares: newCashAmount } : h
        );
      }

      // No exact-currency CASH — try any CASH_* holding with FX conversion
      const anyCashHolding = updated.find((h) => h.symbol.startsWith('CASH_'));
      if (anyCashHolding) {
        const cashCurrency = anyCashHolding.symbol.replace('CASH_', '');
        // Convert cashDelta from holdingCurrency to cashCurrency using EUR as intermediary
        const rateFrom = ratesInEur[holdingCurrency] ?? ratesInEur['USD'] ?? 0.92;
        const rateTo = ratesInEur[cashCurrency] ?? 1;
        const cashDeltaConverted = cashDelta * (rateFrom / rateTo);
        const newCashAmount = Math.round((anyCashHolding.shares + cashDeltaConverted) * 100) / 100;
        if (newCashAmount < 0.001) {
          return updated.filter((h) => h.symbol !== anyCashHolding.symbol);
        }
        return updated.map((h) =>
          h.symbol === anyCashHolding.symbol ? { ...h, shares: newCashAmount } : h
        );
      }

      // Sell with no CASH holding at all — create one in the stock's native currency
      if (type === 'sell' && cashDelta > 0) {
        return [...updated, {
          symbol: exactCashSymbol,
          name: `Cash (${holdingCurrency})`,
          shares: Math.round(cashDelta * 100) / 100,
          avgPrice: 1,
          purchaseDate: date,
          currency: holdingCurrency,
        }];
      }

      return updated;
    });
    setTransactions((prev) => [tx, ...prev]);
  };

  // Recalculate a symbol's holding from its transaction list
  const recomputeHolding = (symbol: string, txList: Transaction[]) => {
    setHoldings((prev) => {
      const existing = prev.find((h) => h.symbol === symbol);
      const symTxs = txList
        .filter((t) => t.symbol === symbol)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (symTxs.length === 0) return prev.filter((h) => h.symbol !== symbol);
      const { avgPriceRemaining, lots } = calcFifo(symTxs);
      const totalShares = lots.reduce((s, l) => s + l.remainingShares, 0);
      if (totalShares <= 0) {
        return prev.filter((h) => h.symbol !== symbol);
      }
      const earliestDate = symTxs.filter(t => t.type === 'buy').reduce(
        (min, t) => (!min || t.date < min ? t.date : min), ''
      );
      if (!existing) return prev;
      return prev.map((h) =>
        h.symbol === symbol
          ? { ...h, shares: totalShares, avgPrice: avgPriceRemaining, purchaseDate: earliestDate || h.purchaseDate }
          : h
      );
    });
  };

  const deleteTransaction = (id: string) => {
    if (isCombinedPortfolio) return;
    setTransactions((prev) => {
      const tx = prev.find((t) => t.id === id);
      if (!tx) return prev;
      const next = prev.filter((t) => t.id !== id);
      recomputeHolding(tx.symbol, next);
      return next;
    });
  };

  const updateTransaction = (id: string, updates: { shares: number; price: number; date: string; fee?: number }) => {
    if (isCombinedPortfolio) return;
    setTransactions((prev) => {
      const tx = prev.find((t) => t.id === id);
      if (!tx) return prev;
      const next = prev.map((t) => t.id === id ? { ...t, ...updates } : t);
      recomputeHolding(tx.symbol, next);
      return next;
    });
  };

  const exportPortfolio = async (extra?: Record<string, string>): Promise<void> => {
    // Guardar estado atual antes de ler do AsyncStorage
    if (activePortfolioId !== '__combined__') {
      await Promise.all([
        AsyncStorage.setItem(holdingsKey(activePortfolioId), JSON.stringify(holdings)),
        AsyncStorage.setItem(txKey(activePortfolioId), JSON.stringify(transactions)),
      ]);
    }
    // Ler dados de todos os portfólios
    const data: Record<string, { holdings: Holding[]; transactions: Transaction[] }> = {};
    await Promise.all(
      portfolios.map(async (p) => {
        const hJson = await AsyncStorage.getItem(holdingsKey(p.id));
        const tJson = await AsyncStorage.getItem(txKey(p.id));
        data[p.id] = {
          holdings: hJson ? JSON.parse(hJson) as Holding[] : [],
          transactions: tJson ? JSON.parse(tJson) as Transaction[] : [],
        };
      })
    );
    const alerts = await getPriceAlerts();
    const payload = JSON.stringify({ version: 2, portfolios, data, watchlist, alerts, ...(extra ?? {}) }, null, 2);
    const date = new Date().toISOString().slice(0, 10);
    // Web: trigger a browser download via Blob URL
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portfolio_backup_${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const importPortfolio = async (): Promise<{ ok: boolean; message: string; apiKeys?: { fmpKey?: string; fhKey?: string; groqKey?: string; tavilyKey?: string; avKey?: string } }> => {
    // Web: open a browser file picker
    const raw = await new Promise<string | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json,*/*';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        resolve(await file.text());
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
    if (!raw) return { ok: false, message: 'Cancelled' };
    try {
      const parsed = JSON.parse(raw) as {
        version?: number;
        portfolios?: Portfolio[];
        data?: Record<string, { holdings: Holding[]; transactions: Transaction[] }>;
        watchlist?: WatchlistItem[];
        alerts?: PriceAlert[];
        holdings?: Holding[];
        transactions?: Transaction[];
        fmpKey?: string; fhKey?: string; groqKey?: string; tavilyKey?: string; avKey?: string;
      };
      const apiKeys = { fmpKey: parsed.fmpKey, fhKey: parsed.fhKey, groqKey: parsed.groqKey, tavilyKey: parsed.tavilyKey, avKey: parsed.avKey };

      if (parsed.version === 2 && Array.isArray(parsed.portfolios) && parsed.data) {
        // Formato novo: restaurar todos os portfólios
        const ps = parsed.portfolios;
        const importedWatchlist = Array.isArray(parsed.watchlist) ? parsed.watchlist : [];
        const importedAlerts = Array.isArray(parsed.alerts) ? parsed.alerts : [];
        await Promise.all(
          ps.map(async (p) => {
            const d = parsed.data![p.id] ?? { holdings: [], transactions: [] };
            await Promise.all([
              AsyncStorage.setItem(holdingsKey(p.id), JSON.stringify(d.holdings)),
              AsyncStorage.setItem(txKey(p.id), JSON.stringify(d.transactions)),
            ]);
          })
        );
        await AsyncStorage.setItem(PORTFOLIOS_KEY, JSON.stringify(ps));
        const firstId = ps[0].id;
        await AsyncStorage.setItem(ACTIVE_KEY, firstId);
        await AsyncStorage.setItem(WATCHLIST_KEY, JSON.stringify(importedWatchlist));
        await replacePriceAlerts(importedAlerts);
        setPortfolios(ps);
        setActivePortfolioId(firstId);
        setWatchlist(importedWatchlist);
        const firstData = parsed.data[firstId] ?? { holdings: [], transactions: [] };
        setHoldings(firstData.holdings);
        setTransactions(firstData.transactions);
        const totalHoldings = ps.reduce((sum, p) => sum + (parsed.data![p.id]?.holdings.length ?? 0), 0);
        return { ok: true, message: `${ps.length} portfolio(s) imported — ${totalHoldings} positions`, apiKeys };
      } else if (Array.isArray(parsed.holdings) && Array.isArray(parsed.transactions)) {
        // Formato antigo (v1): importar para o portfólio ativo
        const importedWatchlist = Array.isArray(parsed.watchlist) ? parsed.watchlist : [];
        await Promise.all([
          AsyncStorage.setItem(holdingsKey(activePortfolioId), JSON.stringify(parsed.holdings)),
          AsyncStorage.setItem(txKey(activePortfolioId), JSON.stringify(parsed.transactions)),
          AsyncStorage.setItem(WATCHLIST_KEY, JSON.stringify(importedWatchlist)),
        ]);
        setHoldings(parsed.holdings);
        setTransactions(parsed.transactions);
        setWatchlist(importedWatchlist);
        return { ok: true, message: `${parsed.holdings.length} positions imported`, apiKeys };
      } else {
        return { ok: false, message: 'Invalid file' };
      }
    } catch {
      return { ok: false, message: 'Error reading file' };
    }
  };

  const importBrokerCSV = async (broker: BrokerType): Promise<{ ok: boolean; message: string }> => {
    if (isCombinedPortfolio) {
      return { ok: false, message: 'Select a specific portfolio before importing broker transactions.' };
    }
    // Web: open a browser file picker for CSV
    const raw = await new Promise<string | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,text/csv,*/*';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        resolve(await file.text());
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
    if (!raw) return { ok: false, message: 'Cancelled' };
    try {
      const parsedTxs = parseBrokerTransactions(broker, raw);
      const brokerTxs = await resolveImportedBrokerTransactions(broker, parsedTxs);
      if (brokerTxs.length === 0) return { ok: false, message: 'No transactions found in the file.' };

      // Build imported holdings and normalized transactions.
      const newHoldings: Holding[] = [];
      const newTxs: Transaction[] = [];

      for (const tx of brokerTxs) {
        const existing = newHoldings.find(h => h.symbol === tx.symbol);
        if (tx.type === 'buy') {
          if (existing) {
            const totalShares = existing.shares + tx.shares;
            existing.avgPrice = (existing.avgPrice * existing.shares + tx.price * tx.shares) / totalShares;
            existing.shares = totalShares;
            if (tx.date < existing.purchaseDate) existing.purchaseDate = tx.date;
          } else {
            newHoldings.push({ symbol: tx.symbol, name: tx.name, shares: tx.shares, avgPrice: tx.price, purchaseDate: tx.date, currency: tx.currency });
          }
        } else {
          if (existing) existing.shares = Math.max(0, existing.shares - tx.shares);
        }
        newTxs.push({ id: tx.externalId ?? `${broker}_${tx.date}_${tx.symbol}_${tx.type}_${tx.shares}_${tx.price}`, symbol: tx.symbol, type: tx.type, shares: tx.shares, price: tx.price, fee: tx.fee ?? 0, date: tx.date });
      }

      const finalHoldings = newHoldings.filter(h => h.shares > 0);
      const existingTxIds = new Set(transactions.map((tx) => tx.id));
      const uniqueNewTxs = newTxs.filter((tx) => !existingTxIds.has(tx.id));
      const importedTxMap = new Map(newTxs.map((tx) => [tx.id, tx]));
      const replacedTxCount = transactions.reduce((count, tx) => count + (importedTxMap.has(tx.id) ? 1 : 0), 0);
      if (uniqueNewTxs.length === 0 && replacedTxCount === 0) {
        return { ok: false, message: 'This file was already imported.' };
      }

      const mergedTxs = [
        ...transactions.map((tx) => importedTxMap.get(tx.id) ?? tx),
        ...uniqueNewTxs,
      ];
      const holdingMeta = new Map<string, Pick<Holding, 'name' | 'currency'>>();
      for (const holding of holdings) {
        holdingMeta.set(holding.symbol, { name: holding.name, currency: holding.currency });
      }
      for (const tx of brokerTxs) {
        const current = holdingMeta.get(tx.symbol);
        holdingMeta.set(tx.symbol, {
          name: current?.name || tx.name || tx.symbol,
          currency: current?.currency || tx.currency,
        });
      }
      const mergedHoldings = rebuildHoldingsFromTransactions(mergedTxs, holdingMeta);

      setHoldings(mergedHoldings);
      setTransactions(mergedTxs);
      await Promise.all([
        AsyncStorage.setItem(holdingsKey(activePortfolioId), JSON.stringify(mergedHoldings)),
        AsyncStorage.setItem(txKey(activePortfolioId), JSON.stringify(mergedTxs)),
      ]);

      const importedCount = uniqueNewTxs.length;
      const updatedCount = replacedTxCount;
      const actionSummary = [
        importedCount > 0 ? `${importedCount} transactions imported` : null,
        updatedCount > 0 ? `${updatedCount} transactions updated` : null,
      ].filter(Boolean).join(' · ');

      return { ok: true, message: `${actionSummary} — ${finalHoldings.length} positions` };
    } catch (e) {
      return { ok: false, message: `Error reading file: ${e}` };
    }
  };

  const parseBrokerTransactions = (broker: BrokerType, raw: string): BrokerTransaction[] => {
    switch (broker) {
      case 'ibkr':
        return parseIBKR(raw);
      case 'trade_republic':
        return parseTradeRepublic(raw);
      case 'trading212':
        return parseTrading212(raw);
      default:
        return [];
    }
  };

  const resolveImportedBrokerTransactions = async (broker: BrokerType, txs: BrokerTransaction[]): Promise<BrokerTransaction[]> => {
    switch (broker) {
      case 'ibkr':
        return resolveIbkrSymbols(txs);
      case 'trade_republic':
        return resolveTradeRepublicSymbols(txs);
      case 'trading212':
        return resolveTrading212Symbols(txs);
      default:
        return txs;
    }
  };

  const rebuildHoldingsFromTransactions = (
    txList: Transaction[],
    holdingMeta: Map<string, Pick<Holding, 'name' | 'currency'>>,
  ): Holding[] => {
    const symbols = [...new Set(txList.map((tx) => tx.symbol))];
    const rebuilt: Array<Holding | null> = symbols.map((symbol) => {
      const symTxs = txList
        .filter((tx) => tx.symbol === symbol)
        .sort((a, b) => a.date.localeCompare(b.date));
      const { avgPriceRemaining, lots } = calcFifo(symTxs);
      const totalShares = lots.reduce((sum, lot) => sum + lot.remainingShares, 0);
      if (totalShares <= 0) return null;
      const earliestDate = symTxs
        .filter((tx) => tx.type === 'buy')
        .reduce((min, tx) => (!min || tx.date < min ? tx.date : min), '');
      const meta = holdingMeta.get(symbol);
      return {
        symbol,
        name: meta?.name || symbol,
        shares: totalShares,
        avgPrice: avgPriceRemaining,
        purchaseDate: earliestDate,
        currency: meta?.currency,
      };
    });
    return rebuilt.filter((holding): holding is Holding => holding !== null);
  };

  const resolveIbkrSymbols = async (txs: BrokerTransaction[]): Promise<BrokerTransaction[]> => {
    const cache = new Map<string, { symbol: string; currency: string }>();
    const normalizeIbkrName = (value: string): string => value
      .toUpperCase()
      .replace(/\b(EUR|USD|GBP|ACC|DIST|DISTRIBUTING|ACCUMULATION|UCITS|ETF|ETC|PLC|NV)\b/g, ' ')
      .replace(/[()\-/,\.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const scoreIbkrMatch = (tx: BrokerTransaction, match: Awaited<ReturnType<typeof searchStocks>>[number]): number => {
      const txSymbol = (tx.symbol ?? '').toUpperCase();
      const txCurrency = (tx.currency ?? '').toUpperCase();
      const matchSymbol = (match.symbol ?? '').toUpperCase();
      const matchCurrency = (match.currency ?? '').toUpperCase();
      const exchange = (match.exchange ?? '').toUpperCase();
      const description = normalizeIbkrName(match.description ?? '');
      const name = normalizeIbkrName(tx.name ?? '');

      let score = 0;
      if (matchSymbol === txSymbol) score += 8;
      if (matchSymbol.startsWith(`${txSymbol}.`)) score += 7;
      if (txCurrency && matchCurrency === txCurrency) score += 6;
      if (name && description.includes(name)) score += 4;
      if (name) {
        const tokens = name.split(/\s+/).filter(Boolean);
        score += tokens.reduce((sum, token) => sum + (description.includes(token) ? 1 : 0), 0);
      }

      if (txCurrency === 'EUR') {
        if (/\.(DE|F|DU|HM|HA|BE|MU|VI|PA|AS|BR|MI)$/.test(matchSymbol)) score += 4;
        if (/(XETRA|FRANKFURT|TRADEGATE|PARIS|AMSTERDAM|BRUSSELS|MILAN|VIENNA|HAMBURG|HANOVER)/.test(exchange)) score += 3;
      } else if (txCurrency === 'GBP') {
        if (matchSymbol.endsWith('.L')) score += 4;
        if (/(LSE|LONDON)/.test(exchange)) score += 3;
      } else if (txCurrency === 'USD') {
        if (!matchSymbol.includes('.')) score += 3;
        if (/(NASDAQ|NYSE|NYSE ARCA|AMEX)/.test(exchange)) score += 2;
      }

      return score;
    };

    const resolved = await Promise.all(txs.map(async (tx) => {
      const cacheKey = `${tx.symbol}|${tx.name}|${tx.currency}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        return { ...tx, symbol: cached.symbol, currency: tx.currency || cached.currency || 'EUR' };
      }

      const normalizedName = normalizeIbkrName(tx.name ?? '');
      const [tickerMatches, nameMatches] = await Promise.all([
        searchStocks(tx.symbol).catch(() => []),
        normalizedName ? searchStocks(normalizedName).catch(() => []) : Promise.resolve([]),
      ]);

      const matches = [...tickerMatches, ...nameMatches].filter(
        (match, index, array) => !!match?.symbol && array.findIndex((candidate) => candidate.symbol === match.symbol) === index,
      );

      const best = matches.sort((a, b) => scoreIbkrMatch(tx, b) - scoreIbkrMatch(tx, a))[0];
      if (!best?.symbol) return tx;

      const value = { symbol: best.symbol, currency: best.currency || tx.currency || 'EUR' };
      cache.set(cacheKey, value);
      return { ...tx, symbol: value.symbol, currency: tx.currency || value.currency };
    }));

    return resolved;
  };

  const resolveTrading212Symbols = async (txs: BrokerTransaction[]): Promise<BrokerTransaction[]> => {
    const cache = new Map<string, { symbol: string; currency: string }>();
    const normalizeTrading212Name = (value: string): string => value
      .toUpperCase()
      .replace(/\b(USD|EUR|GBP|ACC|ACCUMULATION|DIST|DISTRIBUTING|UCITS|ETF|PLC|NV)\b/g, ' ')
      .replace(/[()\-/,\.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const scoreTrading212Match = (
      tx: BrokerTransaction,
      match: Awaited<ReturnType<typeof searchStocks>>[number],
      sources: Set<string>,
    ): number => {
      const txSymbol = (tx.symbol ?? '').toUpperCase();
      const txCurrency = (tx.currency ?? '').toUpperCase();
      const matchSymbol = (match.symbol ?? '').toUpperCase();
      const matchCurrency = (match.currency ?? '').toUpperCase();
      const exchange = (match.exchange ?? '').toUpperCase();
      const description = normalizeTrading212Name(match.description ?? '');
      const name = normalizeTrading212Name(tx.name ?? '');

      let score = 0;

      if (matchSymbol === txSymbol) score += 8;
      if (matchSymbol.startsWith(`${txSymbol}.`)) score += 7;
      if (txCurrency && matchCurrency === txCurrency) score += 6;
      if (sources.has('isin')) score += 5;
      if (sources.has('ticker')) score += 2;

      if (name && description.includes(name)) score += 4;
      if (name) {
        const tokens = name.split(/\s+/).filter(Boolean);
        score += tokens.reduce((sum, token) => sum + (description.includes(token) ? 1 : 0), 0);
      }

      if (txCurrency === 'EUR') {
        if (/\.(DE|F|DU|HM|HA|BE|MU|VI|PA|AS|BR|MI)$/.test(matchSymbol)) score += 4;
        if (/(XETRA|FRANKFURT|TRADEGATE|PARIS|AMSTERDAM|BRUSSELS|MILAN|VIENNA|HAMBURG|HANOVER)/.test(exchange)) score += 3;
      } else if (txCurrency === 'GBP') {
        if (matchSymbol.endsWith('.L')) score += 4;
        if (/(LSE|LONDON)/.test(exchange)) score += 3;
      } else if (txCurrency === 'USD') {
        if (!matchSymbol.includes('.')) score += 3;
        if (/(NASDAQ|NYSE|NYSE ARCA|AMEX)/.test(exchange)) score += 2;
      }

      return score;
    };

    const resolved = await Promise.all(txs.map(async (tx) => {
      const cacheKey = `${tx.symbol}|${tx.isin ?? ''}|${tx.name}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        return { ...tx, symbol: cached.symbol, currency: tx.currency || cached.currency || 'EUR' };
      }

      const normalizedName = normalizeTrading212Name(tx.name ?? '');
      const searchInputs = [
        { source: 'ticker', query: tx.symbol },
        ...(tx.isin ? [{ source: 'isin', query: tx.isin }] : []),
        ...(normalizedName ? [{ source: 'name', query: normalizedName }] : []),
      ];

      const searchResults = await Promise.all(
        searchInputs.map(async ({ source, query }) => ({
          source,
          matches: await searchStocks(query).catch(() => []),
        })),
      );

      const sourceBySymbol = new Map<string, Set<string>>();
      const matches = searchResults.flatMap(({ source, matches }) => matches.map((match) => {
        const symbol = match?.symbol;
        if (!symbol) return null;
        const sources = sourceBySymbol.get(symbol) ?? new Set<string>();
        sources.add(source);
        sourceBySymbol.set(symbol, sources);
        return match;
      })).filter((match, index, array): match is Awaited<ReturnType<typeof searchStocks>>[number] => (
        !!match && array.findIndex((candidate) => candidate?.symbol === match.symbol) === index
      ));

      const best = matches
        .sort((a, b) => scoreTrading212Match(tx, b, sourceBySymbol.get(b.symbol) ?? new Set()) - scoreTrading212Match(tx, a, sourceBySymbol.get(a.symbol) ?? new Set()))[0];

        if (!best?.symbol) return tx;

      const value = { symbol: best.symbol, currency: best.currency || tx.currency || 'EUR' };
      cache.set(cacheKey, value);

      return { ...tx, symbol: value.symbol, currency: tx.currency || value.currency };
    }));

    return resolved;
  };

  const resolveTradeRepublicSymbols = async (txs: BrokerTransaction[]): Promise<BrokerTransaction[]> => {
    const cache = new Map<string, { symbol: string; currency: string }>();
    const tradeRepublicIsinAliases: Record<string, { symbol: string; normalizedName?: string }> = {
      US02079K3059: { symbol: 'GOOGL', normalizedName: 'ALPHABET A' },
    };
    const normalizeTradeRepublicName = (value: string): string => value
      .toUpperCase()
      .replace(/\b(EUR|USD|GBP|ACC|DIST|HEDGED|UCITS|ETF|ETC)\b/g, ' ')
      .replace(/[()\-/,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const scoreTradeRepublicMatch = (tx: BrokerTransaction, match: Awaited<ReturnType<typeof searchStocks>>[number]): number => {
      const txCurrency = (tx.currency ?? '').toUpperCase();
      const matchCurrency = (match.currency ?? '').toUpperCase();
      const symbol = (match.symbol ?? '').toUpperCase();
      const exchange = (match.exchange ?? '').toUpperCase();
      const description = normalizeTradeRepublicName(match.description ?? '');
      const name = normalizeTradeRepublicName(tx.name ?? '');

      let score = 0;
      if (txCurrency && matchCurrency === txCurrency) score += 6;
      if (name && description.includes(name)) score += 4;
      if (name) {
        const tokens = name.split(/\s+/).filter(Boolean);
        score += tokens.reduce((sum, token) => sum + (description.includes(token) ? 1 : 0), 0);
      }

      if (txCurrency === 'EUR') {
        if (/\.(DE|F|DU|HM|BE|MU|VI|PA|AS|BR|MI)$/.test(symbol)) score += 4;
        if (/(XETRA|FRANKFURT|TRADEGATE|PARIS|AMSTERDAM|BRUSSELS|MILAN|VIENNA)/.test(exchange)) score += 3;
      } else if (txCurrency === 'GBP') {
        if (symbol.endsWith('.L')) score += 4;
        if (/(LSE|LONDON)/.test(exchange)) score += 3;
      } else if (txCurrency === 'USD') {
        if (!symbol.includes('.')) score += 3;
        if (/(NASDAQ|NYSE|NYSE ARCA|AMEX)/.test(exchange)) score += 2;
      }

      return score;
    };

    const resolved = await Promise.all(txs.map(async (tx) => {
      if (!looksLikeIsin(tx.symbol)) return tx;

      const cacheKey = `${tx.symbol}|${tx.name}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        return { ...tx, symbol: cached.symbol, currency: tx.currency || cached.currency || 'EUR' };
      }

      const normalizedName = normalizeTradeRepublicName(tx.name ?? '');
      const alias = tradeRepublicIsinAliases[tx.symbol.trim().toUpperCase()];
      if (alias && (!alias.normalizedName || normalizedName.includes(alias.normalizedName))) {
        const value = { symbol: alias.symbol, currency: tx.currency || 'EUR' };
        cache.set(cacheKey, value);
        return { ...tx, symbol: value.symbol, currency: tx.currency || value.currency };
      }

      const [isinMatches, nameMatches] = await Promise.all([
        searchStocks(tx.symbol).catch(() => []),
        tx.name ? searchStocks(normalizedName).catch(() => []) : Promise.resolve([]),
      ]);
      const matches = [...isinMatches, ...nameMatches].filter(
        (match, index, array) => !!match?.symbol && array.findIndex((candidate) => candidate.symbol === match.symbol) === index,
      );

      const best = matches.sort((a, b) => scoreTradeRepublicMatch(tx, b) - scoreTradeRepublicMatch(tx, a))[0];
      if (!best?.symbol) return tx;

      const value = { symbol: best.symbol, currency: best.currency || tx.currency || 'EUR' };
      cache.set(cacheKey, value);
      return { ...tx, symbol: value.symbol, currency: tx.currency || value.currency };
    }));

    return resolved;
  };

  const looksLikeIsin = (value: string) => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(value.trim());

  // Persist watchlist on change (guard !loading to avoid overwriting on initial mount)
  useEffect(() => {
    if (!loading) {
      AsyncStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
    }
  }, [watchlist, loading]);

  const addToWatchlist = (item: WatchlistItem) => {
    setWatchlist((prev) => {
      if (prev.some((w) => w.symbol === item.symbol)) return prev;
      return [...prev, item];
    });
  };

  const removeFromWatchlist = (symbol: string) => {
    setWatchlist((prev) => prev.filter((w) => w.symbol !== symbol));
  };

  const activePortfolioName = activePortfolioId === '__combined__'
    ? 'All Portfolios'
    : portfolios.find((p) => p.id === activePortfolioId)?.name ?? 'Portfolio';

  return (
    <PortfolioContext.Provider value={{ holdings, transactions, loading, portfolios, activePortfolioId, activePortfolioName, addHolding, removeHolding, addTransaction, deleteTransaction, updateTransaction, exportPortfolio, importPortfolio, importBrokerCSV, clearPortfolio, createPortfolio, renamePortfolio, deletePortfolio, switchPortfolio, switchToCombined, watchlist, addToWatchlist, removeFromWatchlist }}>
      {children}
    </PortfolioContext.Provider>
  );
};

export const usePortfolio = (): PortfolioContextValue => {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error('usePortfolio must be used within PortfolioProvider');
  return ctx;
};
