import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Pressable, KeyboardAvoidingView, Platform,
} from 'react-native';
import { usePortfolio } from '../context/PortfolioContext';
import { useSettings } from '../context/SettingsContext';

interface Props {
  symbol: string;
  name?: string;
  initialPrice?: string;
  nativeCurrencySymbol?: string;
  onClose: () => void;
}

export default function AddTransactionModal({ symbol, name, initialPrice = '', nativeCurrencySymbol, onClose }: Props) {
  const { addTransaction } = usePortfolio();
  const { currency } = useSettings();
  const displaySymbol = nativeCurrencySymbol ?? (currency === 'EUR' ? '€' : '$');

  const [txType, setTxType] = useState<'buy' | 'sell'>('buy');
  const [txShares, setTxShares] = useState('');
  const [txPrice, setTxPrice] = useState(initialPrice);

  useEffect(() => {
    if (initialPrice) setTxPrice(initialPrice);
  }, [initialPrice]);
  const [txFee, setTxFee] = useState('');
  const [txDateStr, setTxDateStr] = useState(() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  });

  const formatDateInput = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  };

  const confirm = () => {
    const shares = parseFloat(txShares.replace(',', '.'));
    const price = parseFloat(txPrice.replace(',', '.'));
    const fee = parseFloat(txFee.replace(',', '.')) || 0;
    const dp = txDateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!symbol || isNaN(shares) || shares <= 0 || isNaN(price) || price <= 0 || fee < 0 || !dp) return;
    addTransaction(symbol, txType, shares, price, `${dp[3]}-${dp[2]}-${dp[1]}`, name, fee);
    onClose();
  };

  const overlayStyle = Platform.OS === 'web'
    ? [styles.overlay, { position: 'fixed' as any }]
    : styles.overlay;
  const kavStyle = Platform.OS === 'web' ? styles.kavWrapperWeb : styles.kavWrapper;
  const sheetStyle = Platform.OS === 'web' ? styles.sheetWeb : styles.sheet;

  return (
    <Pressable style={overlayStyle} onPress={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={kavStyle}>
        <Pressable style={sheetStyle} onPress={() => {}}>
              {Platform.OS !== 'web' && <View style={styles.handle} />}
              <Text style={styles.title}>{symbol}</Text>

              <View style={styles.typeRow}>
                <TouchableOpacity
                  style={[styles.typeBtn, txType === 'buy' && styles.typeBtnBuy]}
                  onPress={() => setTxType('buy')}
                >
                  <Text style={[styles.typeTxt, txType === 'buy' && styles.typeTxtActive]}>Buy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeBtn, txType === 'sell' && styles.typeBtnSell]}
                  onPress={() => setTxType('sell')}
                >
                  <Text style={[styles.typeTxt, txType === 'sell' && styles.typeTxtActive]}>Sell</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Quantity</Text>
              <TextInput
                style={styles.input}
                placeholder="ex: 10"
                placeholderTextColor="#475569"
                keyboardType="decimal-pad"
                value={txShares}
                onChangeText={(t) => setTxShares(t.replace(',', '.'))}
              />

              <Text style={styles.label}>Price per share ({displaySymbol})</Text>
              <TextInput
                style={styles.input}
                placeholder="ex: 150.00"
                placeholderTextColor="#475569"
                keyboardType="decimal-pad"
                value={txPrice}
                onChangeText={(t) => setTxPrice(t.replace(',', '.'))}
              />

              <Text style={styles.label}>Transaction date</Text>
              <TextInput
                style={styles.input}
                placeholder="DD/MM/YYYY"
                placeholderTextColor="#475569"
                keyboardType="number-pad"
                value={txDateStr}
                onChangeText={(t) => setTxDateStr(formatDateInput(t))}
              />

              <Text style={styles.label}>Brokerage fee ({displaySymbol})</Text>
              <TextInput
                style={styles.input}
                placeholder="ex: 1.00"
                placeholderTextColor="#475569"
                keyboardType="decimal-pad"
                value={txFee}
                onChangeText={(t) => setTxFee(t.replace(',', '.'))}
              />

              <TouchableOpacity
                style={[styles.confirmBtn, txType === 'sell' && styles.confirmBtnSell]}
                onPress={confirm}
              >
                <Text style={styles.confirmTxt}>
                  Confirm {txType === 'buy' ? 'Buy' : 'Sell'}
                </Text>
              </TouchableOpacity>
        </Pressable>
      </KeyboardAvoidingView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.68)',
    justifyContent: 'flex-end',
    zIndex: 200,
    elevation: 120,
  },
  kavWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  kavWrapperWeb: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheet: {
    backgroundColor: '#1b2023', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingBottom: 36, paddingTop: 12,
    borderWidth: 1, borderColor: '#303841',
  },
  sheetWeb: {
    backgroundColor: '#1b2023', borderRadius: 16,
    paddingHorizontal: 28, paddingBottom: 28, paddingTop: 20,
    borderWidth: 1, borderColor: '#303841',
    width: 560, maxWidth: '92%' as any,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#606b7c', alignSelf: 'center', marginBottom: 8,
  },
  title: {
    color: '#aeb7c4', fontSize: 13, fontWeight: '600',
    textAlign: 'center', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1,
  },
  typeRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  typeBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    backgroundColor: '#171c1f', alignItems: 'center',
    borderWidth: 1, borderColor: '#303841',
  },
  typeBtnBuy:  { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  typeBtnSell: { backgroundColor: '#ef4444', borderColor: '#ef4444' },
  typeTxt: { color: '#8f99aa', fontWeight: '600', fontSize: 14 },
  typeTxtActive: { color: '#fff' },
  label: { color: '#b8c0cc', fontSize: 12, marginBottom: 6, marginTop: 4 },
  input: {
    backgroundColor: '#171c1f', borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: 12, color: '#f8fafc', fontSize: 16,
    borderWidth: 1, borderColor: '#303841', marginBottom: 12,
  },
  confirmBtn: {
    backgroundColor: '#22c55e', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginTop: 4,
  },
  confirmBtnSell: { backgroundColor: '#ef4444' },
  confirmTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
