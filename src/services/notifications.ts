// Web stub for notifications.ts
// expo-notifications, expo-background-task and expo-task-manager are not
// available in the browser — all functions are no-ops or minimal equivalents.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getStockQuote } from './api';

export interface PriceAlert {
  symbol: string;
  targetPrice: number;
  direction: 'above' | 'below';
  name?: string;
}

const PRICE_ALERTS_KEY = '@price_alerts';

export async function getPriceAlerts(): Promise<PriceAlert[]> {
  try {
    const raw = await AsyncStorage.getItem(PRICE_ALERTS_KEY);
    return raw ? (JSON.parse(raw) as PriceAlert[]) : [];
  } catch {
    return [];
  }
}

export async function replacePriceAlerts(alerts: PriceAlert[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PRICE_ALERTS_KEY, JSON.stringify(alerts));
  } catch { /* ignore */ }
}

export async function checkPriceAlerts(): Promise<void> {
  if (typeof window === 'undefined') return;
  const alerts = await getPriceAlerts();
  if (alerts.length === 0) return;
  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'denied';
  if (permission !== 'granted') return;
  await Promise.allSettled(
    alerts.map(async (alert) => {
      try {
        const quote = await getStockQuote(alert.symbol);
        if (!quote) return;
        const triggered =
          (alert.direction === 'above' && quote.c >= alert.targetPrice) ||
          (alert.direction === 'below' && quote.c <= alert.targetPrice);
        if (triggered) {
          new Notification(`${alert.symbol} price alert`, {
            body: `${alert.name ?? alert.symbol} is ${alert.direction} ${alert.targetPrice} (current: ${quote.c.toFixed(2)})`,
          });
        }
      } catch { /* ignore */ }
    })
  );
}

export async function registerTrumpNotifications(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    return result === 'granted';
  }
  return Notification.permission === 'granted';
}

export async function unregisterTrumpNotifications(): Promise<void> { /* no-op on web */ }
export async function registerPriceAlertTask(): Promise<void> { /* no-op on web */ }

export async function areTrumpNotificationsEnabled(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  return Notification.permission === 'granted';
}
