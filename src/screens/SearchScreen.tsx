import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, Pressable,
  StyleSheet, ActivityIndicator, Alert, ListRenderItemInfo,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { searchStocks, getStockQuote, StockSearchResult } from '../services/api';
import { usePortfolio } from '../context/PortfolioContext';
import { RootStackParamList } from '../../App';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export default function SearchScreen() {
  const navigation = useNavigation<NavProp>();
  const { addHolding, addTransaction, activePortfolioId } = usePortfolio();
  const isCombinedPortfolio = activePortfolioId === '__combined__';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedStock, setSelectedStock] = useState<StockSearchResult | null>(null);
  const [shares, setShares] = useState('');
  const [avgPrice, setAvgPrice] = useState('');
  const [brokerageFee, setBrokerageFee] = useState('');
  const [priceLoading, setPriceLoading] = useState(false);
  const [purchaseDateStr, setPurchaseDateStr] = useState(() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  });
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cash modal
  const [cashModalVisible, setCashModalVisible] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [cashCurrency, setCashCurrency] = useState<'EUR' | 'USD' | 'GBP'>('EUR');

  const confirmAddCash = () => {
    if (isCombinedPortfolio) {
      Alert.alert('Read-only', 'Select a specific portfolio before adding cash or positions.');
      return;
    }
    const amount = parseFloat(cashAmount.replace(',', '.'));
    if (!amount || amount <= 0) {
      Alert.alert('Error', 'Enter a valid amount.');
      return;
    }
    const today = new Date();
    addHolding({
      symbol: `CASH_${cashCurrency}`,
      name: `Cash (${cashCurrency})`,
      shares: amount,
      avgPrice: 1,
      purchaseDate: `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`,
      currency: cashCurrency,
    });
    setCashModalVisible(false);
    setCashAmount('');
    Alert.alert('Added!', `${amount.toFixed(2)} ${cashCurrency} added to portfolio.`);
  };

  const handleSearch = async (text: string) => {
    if (!text.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const data = await searchStocks(text);
      setResults(data.slice(0, 20));
    } catch {
      // ignora erros silenciosamente durante live search
    } finally {
      setLoading(false);
    }
  };

  const onChangeText = (text: string) => {
    setQuery(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => handleSearch(text), 400);
  };

  const openAddModal = (stock: StockSearchResult) => {
    if (isCombinedPortfolio) {
      Alert.alert('Read-only', 'Select a specific portfolio before adding positions.');
      return;
    }
    setSelectedStock(stock);
    setShares('');
    setAvgPrice('');
    setBrokerageFee('');
    const _d = new Date();
    setPurchaseDateStr(`${String(_d.getDate()).padStart(2,'0')}/${String(_d.getMonth()+1).padStart(2,'0')}/${_d.getFullYear()}`);
    setModalVisible(true);
    // Pré-preenche o preço com a cotação atual
    setPriceLoading(true);
    getStockQuote(stock.symbol)
      .then((q) => { if (q?.c) setAvgPrice(q.c.toFixed(2)); })
      .catch(() => {})
      .finally(() => setPriceLoading(false));
  };

  const formatDateInput = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  };

  const confirmAdd = () => {
    if (isCombinedPortfolio) {
      Alert.alert('Read-only', 'Select a specific portfolio before adding positions.');
      return;
    }
    const numShares = parseFloat(shares.replace(',', '.'));
    const numPrice = parseFloat(avgPrice.replace(',', '.'));
    const numFee = parseFloat(brokerageFee.replace(',', '.')) || 0;
    const dateParts = purchaseDateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!selectedStock || !numShares || !numPrice || numShares <= 0 || numPrice <= 0 || numFee < 0 || !dateParts) {
      Alert.alert('Error', 'Enter valid values and a date in DD/MM/YYYY format.');
      return;
    }
    addTransaction(
      selectedStock.symbol,
      'buy',
      numShares,
      numPrice,
      `${dateParts[3]}-${dateParts[2]}-${dateParts[1]}`,
      selectedStock.description,
      numFee,
      selectedStock.currency ?? 'USD',
    );
    setModalVisible(false);
    Alert.alert('Added!', `${selectedStock.symbol} added to the portfolio.`);
  };

  const renderResult = ({ item }: ListRenderItemInfo<StockSearchResult>) => (
    <TouchableOpacity
      style={styles.resultCard}
      onPress={() => navigation.navigate('StockDetail', { symbol: item.symbol, name: item.description, shares: 0, avgPrice: 0 })}
    >
      <View style={styles.symbolCol}>
        <Text style={styles.symbol}>{item.symbol}</Text>
        {item.exchange ? (
          <Text style={styles.badge}>{item.exchange} · {item.currency}</Text>
        ) : null}
      </View>
      <Text style={styles.description} numberOfLines={1}>{item.description}</Text>
      <TouchableOpacity style={styles.addBtn} onPress={() => openAddModal(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.add}>+ Add</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            placeholder="Ex: Apple, AAPL, Tesla..."
            placeholderTextColor="#64748b"
            value={query}
            onChangeText={onChangeText}
            onSubmitEditing={() => handleSearch(query)}
          />
          {loading && <ActivityIndicator color="#6366f1" style={styles.inputIcon} />}
          <Pressable
            style={styles.inputIcon}
            onPressIn={() => { setQuery(''); setResults([]); }}
            hitSlop={8}
          >
            <View style={styles.clearCircle}>
              <Text style={styles.clearIcon}>✕</Text>
            </View>
          </Pressable>
        </View>
      </View>
      {/* Cash button */}
      <TouchableOpacity
        style={styles.cashBtn}
        onPress={() => {
          if (isCombinedPortfolio) {
            Alert.alert('Read-only', 'Select a specific portfolio before adding cash or positions.');
            return;
          }
          setCashAmount('');
          setCashModalVisible(true);
        }}
      >
        <Text style={styles.cashBtnText}>💵 Add Cash / Money</Text>
      </TouchableOpacity>
      <FlatList
        data={results}
        keyExtractor={(item) => item.symbol}
        renderItem={renderResult}
      />

      {modalVisible && (
        <Pressable style={styles.modalOverlay} onPress={() => setModalVisible(false)}>
          <Pressable style={styles.modal} onPress={() => {}}>
            <Text style={styles.modalTitle}>Add {selectedStock?.symbol}</Text>

              <TextInput
                style={styles.modalInput}
                placeholder="Number of shares"
                placeholderTextColor="#64748b"
                keyboardType="numeric"
                value={shares}
                onChangeText={(t) => setShares(t.replace(',', '.'))}
              />
              <TextInput
                style={styles.modalInput}
                placeholder={`Average buy price (${selectedStock?.currency ?? '€'})`}
                placeholderTextColor="#64748b"
                keyboardType="numeric"
                value={avgPrice}
                onChangeText={(t) => setAvgPrice(t.replace(',', '.'))}
                editable={!priceLoading}
              />
              {priceLoading && <ActivityIndicator size="small" color="#6366f1" style={{ marginBottom: 8 }} />}

              <TextInput
                style={styles.modalInput}
                placeholder="Purchase date (DD/MM/YYYY)"
                placeholderTextColor="#64748b"
                keyboardType="number-pad"
                value={purchaseDateStr}
                onChangeText={(t) => setPurchaseDateStr(formatDateInput(t))}
              />

              <TextInput
                style={styles.modalInput}
                placeholder={`Brokerage fee (${selectedStock?.currency ?? '€'})`}
                placeholderTextColor="#64748b"
                keyboardType="numeric"
                value={brokerageFee}
                onChangeText={(t) => setBrokerageFee(t.replace(',', '.'))}
              />

              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmBtn} onPress={confirmAdd}>
                  <Text style={styles.confirmText}>Add</Text>
                </TouchableOpacity>
              </View>
          </Pressable>
        </Pressable>
      )}

      {/* Cash modal */}
      {cashModalVisible && (
        <Pressable style={styles.modalOverlay} onPress={() => setCashModalVisible(false)}>
          <Pressable style={styles.modal} onPress={() => {}}>
            <Text style={styles.modalTitle}>Add Cash / Money</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Amount"
              placeholderTextColor="#64748b"
              keyboardType="numeric"
              value={cashAmount}
              onChangeText={(t) => setCashAmount(t.replace(',', '.'))}
            />
            <Text style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>Currency</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              {(['EUR', 'USD', 'GBP'] as const).map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setCashCurrency(c)}
                  style={{ flex: 1, padding: 10, borderRadius: 8, alignItems: 'center',
                    backgroundColor: cashCurrency === c ? '#6366f1' : '#0f172a' }}
                >
                  <Text style={{ color: cashCurrency === c ? '#fff' : '#94a3b8', fontWeight: '600' }}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setCashModalVisible(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={confirmAddCash}>
                <Text style={styles.confirmText}>Add</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cashBtn: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: '#1e293b', borderRadius: 10,
    padding: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#334155',
  },
  cashBtnText: { color: '#f8fafc', fontSize: 15, fontWeight: '600' },
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  searchRow: { padding: 16 },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1e293b', borderRadius: 8,
  },
  input: {
    flex: 1, color: '#f8fafc',
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
  },
  inputIcon: { paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center' },
  clearCircle: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#334155',
    justifyContent: 'center', alignItems: 'center',
  },
  clearIcon: { color: '#94a3b8', fontSize: 15, fontWeight: '700', textAlign: 'center', includeFontPadding: false },
  button: { width: 36, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  resultCard: {
    backgroundColor: '#1e293b', marginHorizontal: 16, marginBottom: 8,
    padding: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center',
  },
  symbolCol: { width: 80, justifyContent: 'center' },
  symbol: { color: '#f8fafc', fontWeight: 'bold' },
  badge: { color: '#64748b', fontSize: 10, marginTop: 1 },
  description: { color: '#94a3b8', flex: 1, fontSize: 13 },
  addBtn: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#1e3a5f', borderRadius: 8, marginLeft: 8 },
  add: { color: '#6366f1', fontWeight: '600', fontSize: 13 },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 24,
    zIndex: 100,
  },
  modal: { backgroundColor: '#1e293b', borderRadius: 16, padding: 24 },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  modalInput: {
    backgroundColor: '#0f172a', color: '#f8fafc',
    borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 15,
  },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, padding: 12, backgroundColor: '#334155', borderRadius: 8, alignItems: 'center' },
  cancelText: { color: '#94a3b8', fontWeight: '600' },
  confirmBtn: { flex: 1, padding: 12, backgroundColor: '#6366f1', borderRadius: 8, alignItems: 'center' },
  confirmText: { color: '#fff', fontWeight: '600' },

});
