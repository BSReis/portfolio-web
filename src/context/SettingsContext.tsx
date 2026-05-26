import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getExchangeRate, setApiKeys } from '../services/api';

export type Currency = 'USD' | 'EUR';

interface SettingsContextValue {
  currency: Currency;
  exchangeRate: number;
  ratesInEur: Record<string, number>;
  setCurrency: (c: Currency) => void;
  getRateFor: (nativeCurrency: string) => number;
  fmpKey: string;
  fhKey: string;
  groqKey: string;
  tavilyKey: string;
  avKey: string;
  setFmpKey: (key: string) => void;
  setFhKey: (key: string) => void;
  setGroqKey: (key: string) => void;
  setTavilyKey: (key: string) => void;
  setAvKey: (key: string) => void;
  hideValues: boolean;
  setHideValues: (v: boolean) => void;
  dividendTaxEnabled: boolean;
  setDividendTaxEnabled: (v: boolean) => void;
  dividendTaxRate: number;
  setDividendTaxRate: (v: number) => void;
  applyDividendTax: (amount: number) => number;
  colorScheme: 'dark' | 'light';
  setColorScheme: (scheme: 'dark' | 'light') => void;
}

const STORAGE_KEY = '@portfolio_currency';
const FMP_KEY_STORAGE = '@portfolio_fmp_key';
const FH_KEY_STORAGE = '@portfolio_fh_key';
const GROQ_KEY_STORAGE = '@portfolio_groq_key';
const TAVILY_KEY_STORAGE = '@portfolio_tavily_key';
const AV_KEY_STORAGE = '@portfolio_av_key';
const DIVIDEND_TAX_ENABLED_STORAGE = '@portfolio_dividend_tax_enabled';
const DIVIDEND_TAX_RATE_STORAGE = '@portfolio_dividend_tax_rate';
const COLOR_SCHEME_STORAGE = '@portfolio_color_scheme';
const DEFAULT_DIVIDEND_TAX_RATE = 15;

// Common stock market currencies to pre-fetch rates for
const FETCH_CURRENCIES = ['USD', 'GBP', 'DKK', 'SEK', 'NOK', 'CHF', 'JPY', 'CAD', 'AUD', 'HKD'];

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [currency, setCurrencyState] = useState<Currency>('EUR');
  const [exchangeRate, setExchangeRate] = useState<number>(0.92);
  const [ratesInEur, setRatesInEur] = useState<Record<string, number>>({ USD: 0.92, EUR: 1 });
  const [fmpKey, setFmpKeyState] = useState('');
  const [fhKey, setFhKeyState] = useState('');
  const [groqKey, setGroqKeyState] = useState('');
  const [tavilyKey, setTavilyKeyState] = useState('');
  const [avKey, setAvKeyState] = useState('');
  const [hideValues, setHideValues] = useState(true);
  const [dividendTaxEnabled, setDividendTaxEnabledState] = useState(false);
  const [dividendTaxRate, setDividendTaxRateState] = useState(DEFAULT_DIVIDEND_TAX_RATE);
  const [colorScheme, setColorSchemeState] = useState<'dark' | 'light'>('dark');

  // Carregar preferência guardada + buscar taxas de câmbio
  useEffect(() => {
    AsyncStorage.multiGet([
      STORAGE_KEY,
      FMP_KEY_STORAGE,
      FH_KEY_STORAGE,
      GROQ_KEY_STORAGE,
      TAVILY_KEY_STORAGE,
      AV_KEY_STORAGE,
      DIVIDEND_TAX_ENABLED_STORAGE,
      DIVIDEND_TAX_RATE_STORAGE,
      COLOR_SCHEME_STORAGE,
    ]).then((pairs) => {
      const currency = pairs[0][1];
      const fmp = pairs[1][1] ?? '';
      const fh = pairs[2][1] ?? '';
      const groq = pairs[3][1] ?? '';
      const tavily = pairs[4][1] ?? '';
      const av = pairs[5][1] ?? '';
      const dividendTaxEnabled = pairs[6][1] === 'true';
      const storedDividendTaxRate = Number(pairs[7][1]);
      const storedScheme = pairs[8][1];
      if (currency === 'USD' || currency === 'EUR') setCurrencyState(currency);
      setFmpKeyState(fmp);
      setFhKeyState(fh);
      setGroqKeyState(groq);
      setTavilyKeyState(tavily);
      setAvKeyState(av);
      setDividendTaxEnabledState(dividendTaxEnabled);
      if (Number.isFinite(storedDividendTaxRate)) {
        setDividendTaxRateState(Math.min(100, Math.max(0, storedDividendTaxRate)));
      }
      if (storedScheme === 'light' || storedScheme === 'dark') setColorSchemeState(storedScheme);
      setApiKeys(fmp, fh, av);
    });
    // Buscar taxas para todas as moedas comuns em relação ao EUR
    Promise.all(
      FETCH_CURRENCIES.map((c) =>
        getExchangeRate(c, 'EUR')
          .then((rate) => ({ c, rate }))
          .catch(() => null)
      )
    ).then((results) => {
      const map: Record<string, number> = { EUR: 1 };
      results.forEach((r) => { if (r) map[r.c] = r.rate; });
      setRatesInEur(map);
      if (map.USD) setExchangeRate(map.USD);
    });
  }, []);

  const setCurrency = (c: Currency) => {
    setCurrencyState(c);
    AsyncStorage.setItem(STORAGE_KEY, c);
  };

  const setFmpKey = (key: string) => {
    const trimmed = key.trim();
    setFmpKeyState(trimmed);
    AsyncStorage.setItem(FMP_KEY_STORAGE, trimmed);
    setApiKeys(trimmed, fhKey, avKey);
  };

  const setFhKey = (key: string) => {
    const trimmed = key.trim();
    setFhKeyState(trimmed);
    AsyncStorage.setItem(FH_KEY_STORAGE, trimmed);
    setApiKeys(fmpKey, trimmed, avKey);
  };

  const setAvKey = (key: string) => {
    const trimmed = key.trim();
    setAvKeyState(trimmed);
    AsyncStorage.setItem(AV_KEY_STORAGE, trimmed);
    setApiKeys(fmpKey, fhKey, trimmed);
  };

  const setGroqKey = (key: string) => {
    const trimmed = key.trim();
    setGroqKeyState(trimmed);
    AsyncStorage.setItem(GROQ_KEY_STORAGE, trimmed);
  };

  const setTavilyKey = (key: string) => {
    const trimmed = key.trim();
    setTavilyKeyState(trimmed);
    AsyncStorage.setItem(TAVILY_KEY_STORAGE, trimmed);
  };

  const setDividendTaxEnabled = (value: boolean) => {
    setDividendTaxEnabledState(value);
    AsyncStorage.setItem(DIVIDEND_TAX_ENABLED_STORAGE, String(value));
  };

  const setDividendTaxRate = (value: number) => {
    const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
    setDividendTaxRateState(clamped);
    AsyncStorage.setItem(DIVIDEND_TAX_RATE_STORAGE, String(clamped));
  };

  const setColorScheme = (scheme: 'dark' | 'light') => {
    setColorSchemeState(scheme);
    AsyncStorage.setItem(COLOR_SCHEME_STORAGE, scheme);
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('light-mode', scheme === 'light');
    }
  };

  // Apply saved color scheme on initial load
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('light-mode', colorScheme === 'light');
    }
  }, [colorScheme]);

  /** Convert a price from nativeCurrency to the display currency */
  const getRateFor = useCallback((nativeCurrency: string): number => {
    const upper = (nativeCurrency ?? 'USD').toUpperCase();
    const toEur = ratesInEur[upper] ?? ratesInEur['USD'] ?? 0.92;
    if (currency === 'EUR') return toEur;
    // Display = USD: nativeCurrency→EUR / USD→EUR = nativeCurrency→USD
    const usdToEur = ratesInEur['USD'] ?? 0.92;
    return toEur / usdToEur;
  }, [ratesInEur, currency]);

  const applyDividendTax = useCallback((amount: number) => {
    if (!dividendTaxEnabled) return amount;
    return amount * (1 - dividendTaxRate / 100);
  }, [dividendTaxEnabled, dividendTaxRate]);

  return (
    <SettingsContext.Provider value={{ currency, exchangeRate, ratesInEur, setCurrency, getRateFor, fmpKey, fhKey, groqKey, tavilyKey, avKey, setFmpKey, setFhKey, setGroqKey, setTavilyKey, setAvKey, hideValues, setHideValues, dividendTaxEnabled, setDividendTaxEnabled, dividendTaxRate, setDividendTaxRate, applyDividendTax, colorScheme, setColorScheme }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = (): SettingsContextValue => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
};
