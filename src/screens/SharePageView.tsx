/**
 * SharePageView — reads `?d=` from the URL, decodes portfolio data,
 * and renders a read-only SharedPortfolioScreen.
 * This component is loaded dynamically (no SSR) from pages/share.tsx.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Linking,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { decodePortfolioShare } from '../utils/sharePortfolio';
import { Holding, Transaction } from '../context/PortfolioContext';
import SharedPortfolioScreen from './SharedPortfolioScreen';

export default function SharePageView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [hideValues, setHideValues] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('d');
    if (!encoded) {
      setError('No portfolio data found in this link.');
      setLoading(false);
      return;
    }
    const decoded = decodePortfolioShare(encoded);
    if (!decoded) {
      setError('Could not decode portfolio data. The link may be corrupted.');
      setLoading(false);
      return;
    }
    setName(decoded.name);
    setHoldings(decoded.holdings);
    setTransactions(decoded.transactions);
    setHideValues(decoded.hideValues ?? false);
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#6366f1" />
            <Text style={styles.loadingText}>Loading portfolio…</Text>
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  if (error) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={48} color="#ef4444" />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.homeBtn} onPress={() => { window.location.href = '/'; }}>
              <Text style={styles.homeBtnText}>Go to portfolio</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SharedPortfolioScreen name={name} holdings={holdings} transactions={transactions} hideValues={hideValues} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1, backgroundColor: '#111417',
    alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32,
  },
  loadingText: { color: '#8f99aa', fontSize: 14, marginTop: 8 },
  errorText: {
    color: '#f5f7fa', fontSize: 15, textAlign: 'center',
    marginTop: 8, lineHeight: 22,
  },
  homeBtn: {
    backgroundColor: '#6366f1', paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 10, marginTop: 8,
  },
  homeBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
