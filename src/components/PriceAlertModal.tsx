import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  PriceAlert, savePriceAlert, getPriceAlerts, deletePriceAlert,
  requestNotificationPermission, PriceAlertTimeframe,
} from '../services/notifications';

interface Props {
  symbol: string;
  name: string;
  currentPrice: number;
  currencySymbol: string;
  onClose: () => void;
}

type Mode = 'price' | 'priceChange';

const TIMEFRAME_LABELS: Record<PriceAlertTimeframe, string> = {
  current: 'From current',
  '1h': 'Within 1 hour',
  '1d': 'Within 1 day',
  '7d': 'Within 7 days',
};

const TIMEFRAME_OPTIONS: PriceAlertTimeframe[] = ['current', '1h', '1d', '7d'];

function buildExpiry(createdAt: string, timeframe: PriceAlertTimeframe): string | null {
  if (timeframe === 'current') return null;
  const ms = timeframe === '1h'
    ? 60 * 60_000
    : timeframe === '1d'
      ? 24 * 60 * 60_000
      : 7 * 24 * 60 * 60_000;
  return new Date(new Date(createdAt).getTime() + ms).toISOString();
}

export default function PriceAlertModal({ symbol, name, currentPrice, currencySymbol, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('price');
  const [targetStr, setTargetStr] = useState('');
  const [timeframe, setTimeframe] = useState<PriceAlertTimeframe>('current');
  const [recurring, setRecurring] = useState(false);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);

  useEffect(() => {
    setMode('price');
    setTargetStr(currentPrice > 0 ? currentPrice.toFixed(2) : '');
    setTimeframe('current');
    setRecurring(false);
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    const all = await getPriceAlerts();
    setAlerts(all.filter(a => a.symbol === symbol));
  };

  const handleModeChange = (m: Mode) => {
    setMode(m);
    setTargetStr(m === 'price' ? (currentPrice > 0 ? currentPrice.toFixed(2) : '') : '5');
    if (m === 'price') setTimeframe('current');
  };

  const targetValue = parseFloat(targetStr.replace(',', '.')) || 0;
  const normalizedChange = Math.abs(targetValue);
  const targetPrice = mode === 'price' ? targetValue : currentPrice * (1 + normalizedChange / 100);
  const lowerTargetPrice = currentPrice * (1 - normalizedChange / 100);
  const direction: 'above' | 'below' = targetPrice >= currentPrice ? 'above' : 'below';
  const isUp = direction === 'above';

  const handleCreate = async () => {
    if (mode === 'price' && targetValue <= 0) {
      Alert.alert('Invalid price', 'Enter a valid price.');
      return;
    }
    if (mode === 'priceChange' && normalizedChange === 0) {
      Alert.alert('Invalid change', 'Enter a percentage different from 0%.');
      return;
    }
    const granted = await requestNotificationPermission();
    if (!granted) {
      Alert.alert('Permission denied', 'Enable notifications in Settings to receive alerts.');
      return;
    }
    const createdAt = new Date().toISOString();
    const newAlert: PriceAlert = {
      id: `${symbol}_${Date.now()}`,
      symbol,
      name,
      targetPrice,
      changePct: mode === 'priceChange' ? normalizedChange : null,
      mode,
      direction: mode === 'priceChange' ? 'any' : direction,
      recurring,
      basePrice: currentPrice,
      createdAt,
      timeframe,
      expiresAt: mode === 'priceChange' ? buildExpiry(createdAt, timeframe) : null,
    };
    await savePriceAlert(newAlert);
    await loadAlerts();
    setTargetStr(mode === 'price' ? (currentPrice > 0 ? currentPrice.toFixed(2) : '') : '5');
    setRecurring(false);
  };

  const handleDelete = async (id: string) => {
    await deletePriceAlert(id);
    await loadAlerts();
  };

  const fmtPrice = (p: number) =>
    `${currencySymbol}${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Pressable style={styles.overlay} onPress={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.kavWrapper}>
        <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />

            {/* Header */}
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>Price Alert · {symbol}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>
            <Text style={styles.currentPriceTxt}>{fmtPrice(currentPrice)}</Text>

            {/* Mode toggle */}
            <View style={styles.modeRow}>
              <TouchableOpacity
                style={[styles.modeBtn, mode === 'price' && styles.modeBtnActive]}
                onPress={() => handleModeChange('price')}
              >
                <Text style={[styles.modeTxt, mode === 'price' && styles.modeTxtActive]}>Price</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeBtn, mode === 'priceChange' && styles.modeBtnActive]}
                onPress={() => handleModeChange('priceChange')}
              >
                <Text style={[styles.modeTxt, mode === 'priceChange' && styles.modeTxtActive]}>Price Change</Text>
              </TouchableOpacity>
            </View>

            {/* Quick % shortcuts */}
            {mode === 'priceChange' && (
              <View style={styles.quickRow}>
                {[1, 3, 5, 10].map(pct => (
                  <TouchableOpacity
                    key={pct}
                    style={[styles.quickBtn, styles.quickBtnBlue]}
                    onPress={() => setTargetStr(pct.toFixed(1))}
                  >
                    <Text style={styles.quickTxt}>{pct}%</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {mode === 'priceChange' && (
              <View style={styles.timeframeWrap}>
                <Text style={styles.sectionLabel}>Time Frame</Text>
                <View style={styles.timeframeRow}>
                  {TIMEFRAME_OPTIONS.map(option => (
                    <TouchableOpacity
                      key={option}
                      style={[styles.timeframeBtn, timeframe === option && styles.timeframeBtnActive]}
                      onPress={() => setTimeframe(option)}
                    >
                      <Text style={[styles.timeframeTxt, timeframe === option && styles.timeframeTxtActive]}>
                        {option === 'current' ? 'Current' : option === '1h' ? '1 Hour' : option === '1d' ? '1 Day' : '7 Days'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Input */}
            <View style={styles.inputRow}>
              {mode === 'price' && <Text style={styles.inputPrefix}>{currencySymbol}</Text>}
              <TextInput
                style={styles.input}
                value={targetStr}
                onChangeText={setTargetStr}
                keyboardType="decimal-pad"
                placeholder={mode === 'price' ? '0.00' : '5.0'}
                placeholderTextColor="#475569"
                selectTextOnFocus
              />
              {mode === 'priceChange' && <Text style={styles.inputSuffix}>%</Text>}
            </View>

            {/* Direction indicator */}
            {targetValue !== 0 && (
              <View style={[styles.dirRow, { borderColor: mode === 'priceChange' ? '#6366f144' : isUp ? '#22c55e44' : '#ef444444' }]}> 
                <Ionicons
                  name={mode === 'priceChange' ? 'swap-vertical' : isUp ? 'arrow-up' : 'arrow-down'}
                  size={14}
                  color={mode === 'priceChange' ? '#818cf8' : isUp ? '#22c55e' : '#ef4444'}
                />
                <Text style={[styles.dirTxt, { color: mode === 'priceChange' ? '#c7d2fe' : isUp ? '#22c55e' : '#ef4444' }]}> 
                  {mode === 'priceChange'
                    ? `Any direction · ±${normalizedChange.toFixed(1)}% from ${fmtPrice(currentPrice)}`
                    : `${isUp ? 'Above' : 'Below'} ${fmtPrice(targetPrice)}`}
                </Text>
              </View>
            )}

            {mode === 'priceChange' && targetValue !== 0 && (
              <Text style={styles.changeHintTxt}>
                Triggers at {fmtPrice(targetPrice)} or {fmtPrice(lowerTargetPrice)}
                {timeframe !== 'current' ? ` · ${TIMEFRAME_LABELS[timeframe].toLowerCase()}` : ''}
              </Text>
            )}

            {/* Recurring toggle */}
            <TouchableOpacity style={styles.recurringRow} onPress={() => setRecurring(r => !r)} activeOpacity={0.7}>
              <View style={[styles.chip, recurring && styles.chipActive]}>
                <Ionicons name="repeat" size={14} color={recurring ? '#fff' : '#94a3b8'} />
                <Text style={[styles.chipTxt, recurring && styles.chipTxtActive]}>Recurring</Text>
              </View>
              <Text style={styles.recurringDesc}>
                {recurring ? 'Alert triggers every time it is reached' : 'Alert triggers once'}
              </Text>
            </TouchableOpacity>

            {/* Create button */}
            <TouchableOpacity style={styles.createBtn} onPress={handleCreate} activeOpacity={0.85}>
              <Text style={styles.createBtnTxt}>Create Alert</Text>
            </TouchableOpacity>

            {/* Active alerts */}
            {alerts.length > 0 && (
              <View style={styles.alertsSection}>
                <Text style={styles.alertsSectionTitle}>Active Alerts</Text>
                <ScrollView style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false}>
                  {alerts.map(a => {
                    const aUp = a.direction === 'above';
                    const timeframeMeta = a.timeframe && a.timeframe !== 'current'
                      ? `  ·  ${TIMEFRAME_LABELS[a.timeframe]}`
                      : '';
                    return (
                      <View key={a.id} style={styles.alertRow}>
                        <Ionicons
                          name={a.direction === 'any' ? 'swap-vertical-circle' : aUp ? 'arrow-up-circle' : 'arrow-down-circle'}
                          size={18}
                          color={a.direction === 'any' ? '#818cf8' : aUp ? '#22c55e' : '#ef4444'}
                        />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={styles.alertTarget}>
                            {(a.mode === 'change' || a.mode === 'priceChange') && a.changePct != null
                              ? a.mode === 'priceChange'
                                ? `±${a.changePct.toFixed(1)}%`
                                : `${a.changePct > 0 ? '+' : ''}${a.changePct.toFixed(1)}% → ${fmtPrice(a.targetPrice)}`
                              : fmtPrice(a.targetPrice)}
                          </Text>
                          <Text style={styles.alertMeta}>
                            {a.direction === 'any'
                              ? `Any direction · from ${fmtPrice(a.basePrice ?? currentPrice)}`
                              : a.direction === 'above' ? 'Above ↑' : 'Below ↓'}
                            {timeframeMeta}
                            {a.recurring ? '  ·  Recurring' : ''}
                          </Text>
                        </View>
                        <TouchableOpacity onPress={() => handleDelete(a.id)} hitSlop={8}>
                          <Ionicons name="trash-outline" size={18} color="#ef4444" />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            )}
        </Pressable>
      </KeyboardAvoidingView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    zIndex: 200,
  },
  kavWrapper: {
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1b2023',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#303841',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  headerTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
  },
  currentPriceTxt: {
    color: '#94a3b8',
    fontSize: 13,
    marginBottom: 16,
  },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: '#171c1f',
    borderRadius: 10,
    padding: 3,
    marginBottom: 14,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  modeBtnActive: {
    backgroundColor: '#6366f1',
  },
  modeTxt: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '600',
  },
  modeTxtActive: {
    color: '#fff',
  },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  quickBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  quickBtnBlue: {
    backgroundColor: '#6366f122',
    borderWidth: 1,
    borderColor: '#6366f144',
  },
  quickTxt: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '600',
  },
  sectionLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  timeframeWrap: {
    marginBottom: 14,
  },
  timeframeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  timeframeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#171c1f',
    borderWidth: 1,
    borderColor: '#2a3036',
  },
  timeframeBtnActive: {
    backgroundColor: '#6366f1',
    borderColor: '#6366f1',
  },
  timeframeTxt: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  timeframeTxtActive: {
    color: '#fff',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#171c1f',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a3036',
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  inputPrefix: {
    color: '#94a3b8',
    fontSize: 18,
    marginRight: 4,
  },
  input: {
    flex: 1,
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700',
    paddingVertical: 14,
  },
  inputSuffix: {
    color: '#94a3b8',
    fontSize: 18,
    marginLeft: 4,
  },
  dirRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 14,
    backgroundColor: '#171c1f',
  },
  dirTxt: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  changeHintTxt: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: -4,
    marginBottom: 14,
  },
  recurringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#171c1f',
    borderWidth: 1,
    borderColor: '#2a3036',
  },
  chipActive: {
    backgroundColor: '#6366f1',
    borderColor: '#6366f1',
  },
  chipTxt: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  chipTxtActive: {
    color: '#fff',
  },
  recurringDesc: {
    color: '#64748b',
    fontSize: 12,
    flexShrink: 1,
  },
  createBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 20,
  },
  createBtnTxt: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  alertsSection: {
    borderTopWidth: 1,
    borderColor: '#303841',
    paddingTop: 16,
  },
  alertsSectionTitle: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#303841',
  },
  alertTarget: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
  },
  alertMeta: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2,
  },
});
