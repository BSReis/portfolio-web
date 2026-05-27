import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet, TextInput,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Modal, Pressable,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { usePortfolio, Portfolio, Holding } from '../context/PortfolioContext';
import { useSettings } from '../context/SettingsContext';
import { effectivePrice, getStockQuote } from '../services/api';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

interface PortfolioSummary {
  id: string;
  name: string;
  positionsCount: number;
  investedCost: number;
  currentValue: number;
}

const holdingsKey = (id: string) => `@holdings_${id}`;

const fmtMoney = (v: number): string => {
  const [int, dec] = Math.abs(v).toFixed(2).split('.');
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${v < 0 ? '-' : ''}${intFmt},${dec}`;
};

export default function PortfoliosManagerScreen() {
  const navigation = useNavigation<NavProp>();
  const { currency, getRateFor } = useSettings();
  const {
    portfolios, activePortfolioId, holdings: activeHoldings,
    createPortfolio, renamePortfolio, deletePortfolio, switchPortfolio, switchToCombined,
  } = usePortfolio();
  const currencySymbol = currency === 'EUR' ? '€' : '$';

  const [summaries, setSummaries] = useState<PortfolioSummary[]>([]);
  const [loadingSummaries, setLoadingSummaries] = useState(false);

  // Rename modal state
  const [renameModal, setRenameModal] = useState<{ id: string; name: string } | null>(null);
  const [renameText, setRenameText] = useState('');

  // Create modal state
  const [createModal, setCreateModal] = useState(false);
  const [createText, setCreateText] = useState('');

  // Load summary data (invested cost + positions count) for all portfolios
  useEffect(() => {
    setLoadingSummaries(true);
    (async () => {
      const portfolioHoldings = await Promise.all(
        portfolios.map(async (p) => {
          if (p.id === activePortfolioId) {
            return { id: p.id, name: p.name, holdings: activeHoldings };
          }
          const json = await AsyncStorage.getItem(holdingsKey(p.id)).catch(() => null);
          const hs: Holding[] = json ? JSON.parse(json) : [];
          return { id: p.id, name: p.name, holdings: hs };
        })
      );

      const symbols = Array.from(new Set(
        portfolioHoldings.flatMap((p) => p.holdings.map((h) => h.symbol))
      ));

      const quoteEntries = await Promise.all(
        symbols.map(async (symbol) => [symbol, await getStockQuote(symbol).catch(() => null)] as const)
      );
      const quotes = Object.fromEntries(quoteEntries);

      const nextSummaries = portfolioHoldings.map(({ id, name, holdings }) => {
        const investedCost = holdings.reduce(
          (sum, holding) => sum + holding.shares * holding.avgPrice * getRateFor(holding.currency ?? 'USD'),
          0
        );
        const currentValue = holdings.reduce((sum, holding) => {
          const quote = quotes[holding.symbol];
          const price = quote ? effectivePrice(quote) : holding.avgPrice;
          const rate = getRateFor(quote?.currency ?? holding.currency ?? 'USD');
          return sum + holding.shares * price * rate;
        }, 0);
        return {
          id,
          name,
          positionsCount: holdings.length,
          investedCost,
          currentValue,
        };
      });

      setSummaries(nextSummaries);
    })().finally(() => setLoadingSummaries(false));
  }, [portfolios, activePortfolioId, activeHoldings, getRateFor]);

  const totalInvested = summaries.reduce((s, p) => s + p.investedCost, 0);
  const totalCurrentValue = summaries.reduce((s, p) => s + p.currentValue, 0);
  const totalProfit = totalCurrentValue - totalInvested;

  const handleCombined = async () => {
    await switchToCombined();
    navigation.goBack();
  };

  const handleSwitch = async (id: string) => {
    if (id === activePortfolioId) { navigation.goBack(); return; }
    await switchPortfolio(id);
    navigation.goBack();
  };

  const handleCreateConfirm = async () => {
    const name = createText.trim();
    if (!name) return;
    setCreateModal(false);
    setCreateText('');
    await createPortfolio(name);
    navigation.goBack();
  };

  const handleRenameConfirm = async () => {
    if (!renameModal) return;
    const name = renameText.trim();
    if (!name) return;
    setRenameModal(null);
    await renamePortfolio(renameModal.id, name);
  };

  const handleDelete = (id: string, name: string) => {
    if (portfolios.length <= 1) {
      if (Platform.OS === 'web') {
        window.alert('Cannot delete: You must keep at least one portfolio.');
      } else {
        Alert.alert('Cannot delete', 'You must keep at least one portfolio.');
      }
      return;
    }
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete "${name}"?\nAll positions and transactions will be lost.`)) {
        deletePortfolio(id);
      }
    } else {
      Alert.alert(
        'Delete portfolio',
        `Are you sure you want to delete "${name}"?\nAll positions and transactions will be lost.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete', style: 'destructive',
            onPress: async () => {
              await deletePortfolio(id);
            },
          },
        ]
      );
    }
  };

  const renderItem = ({ item }: { item: PortfolioSummary }) => {
    const isActive = item.id === activePortfolioId;
    return (
      <TouchableOpacity
        style={[styles.row, isActive && styles.rowActive]}
        onPress={() => handleSwitch(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.rowLeft}>
          <View style={[styles.checkCircle, isActive && styles.checkCircleActive]}>
            {isActive && <Ionicons name="checkmark" size={13} color="#fff" />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.portfolioName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.portfolioSub}>
              {item.positionsCount} {item.positionsCount === 1 ? 'position' : 'positions'}
              {item.investedCost > 0 ? `  ·  ${currencySymbol}${fmtMoney(item.investedCost)} invested` : ''}
            </Text>
          </View>
        </View>
        <View style={styles.rowActions}>
          <TouchableOpacity
            hitSlop={10}
            onPress={() => { setRenameText(item.name); setRenameModal({ id: item.id, name: item.name }); }}
            style={styles.iconBtn}
          >
            <Ionicons name="pencil-outline" size={17} color="#64748b" />
          </TouchableOpacity>
          {portfolios.length > 1 && (
            <TouchableOpacity hitSlop={10} onPress={() => handleDelete(item.id, item.name)} style={styles.iconBtn}>
              <Ionicons name="trash-outline" size={17} color="#ef4444" />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Total header */}
      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Total across all portfolios</Text>
        {loadingSummaries
          ? <ActivityIndicator color="#6366f1" size="small" style={{ marginTop: 4 }} />
          : <Text style={styles.totalValue}>{currencySymbol}{fmtMoney(totalCurrentValue)}</Text>
        }
        <Text style={styles.totalSub}>
          {portfolios.length} portfolio{portfolios.length !== 1 ? 's' : ''}
          {` · P/L ${totalProfit >= 0 ? '+' : ''}${currencySymbol}${fmtMoney(totalProfit)}`}
        </Text>
      </View>

      {/* Combined view button */}
      <TouchableOpacity
        style={[
          styles.combinedBtn,
          activePortfolioId === '__combined__' && styles.combinedBtnActive,
        ]}
        onPress={handleCombined}
        activeOpacity={0.8}
      >
        <View style={styles.combinedBtnInner}>
          <Ionicons
            name="layers-outline"
            size={20}
            color={activePortfolioId === '__combined__' ? '#a5b4fc' : '#94a3b8'}
          />
          <View style={{ flex: 1 }}>
            <Text style={[
              styles.combinedBtnText,
              activePortfolioId === '__combined__' && { color: '#a5b4fc' },
            ]}>
              View all combined
            </Text>
            <Text style={styles.combinedBtnSub}>
              Merges all portfolios into one view (read-only)
            </Text>
          </View>
          {activePortfolioId === '__combined__' && (
            <Ionicons name="checkmark-circle" size={18} color="#6366f1" />
          )}
        </View>
      </TouchableOpacity>

      {/* Portfolio list */}
      <FlatList
        data={summaries}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#1e293b', marginHorizontal: 4 }} />}
      />

      {/* Add new portfolio */}
      <TouchableOpacity style={styles.addBtn} onPress={() => { setCreateText(''); setCreateModal(true); }} activeOpacity={0.8}>
        <Ionicons name="add-circle-outline" size={20} color="#6366f1" />
        <Text style={styles.addBtnText}>New portfolio</Text>
      </TouchableOpacity>

      {/* Rename modal */}
      <Modal visible={renameModal !== null} transparent animationType="fade" onRequestClose={() => setRenameModal(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setRenameModal(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.modalBox} onPress={() => {}}>
              <Text style={styles.modalTitle}>Rename portfolio</Text>
              <TextInput
                style={styles.textInput}
                value={renameText}
                onChangeText={setRenameText}
                placeholder="Portfolio name"
                placeholderTextColor="#475569"
                autoFocus
                onSubmitEditing={handleRenameConfirm}
              />
              <View style={styles.modalBtns}>
                <TouchableOpacity onPress={() => setRenameModal(null)} style={styles.modalBtnCancel}>
                  <Text style={{ color: '#64748b', fontWeight: '600' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleRenameConfirm} style={styles.modalBtnOk}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Save</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Create modal */}
      <Modal visible={createModal} transparent animationType="fade" onRequestClose={() => setCreateModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setCreateModal(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.modalBox} onPress={() => {}}>
              <Text style={styles.modalTitle}>New portfolio</Text>
              <TextInput
                style={styles.textInput}
                value={createText}
                onChangeText={setCreateText}
                placeholder="e.g. Growth, Dividends..."
                placeholderTextColor="#475569"
                autoFocus
                onSubmitEditing={handleCreateConfirm}
              />
              <View style={styles.modalBtns}>
                <TouchableOpacity onPress={() => setCreateModal(false)} style={styles.modalBtnCancel}>
                  <Text style={{ color: '#64748b', fontWeight: '600' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleCreateConfirm} style={styles.modalBtnOk}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Create</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  totalCard: {
    margin: 16, padding: 16, backgroundColor: '#1e293b',
    borderRadius: 14, borderWidth: 1, borderColor: '#293548',
  },
  totalLabel: { color: '#64748b', fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  totalValue: { color: '#f8fafc', fontSize: 28, fontWeight: '700', marginTop: 4 },
  totalSub: { color: '#8f99aa', fontSize: 12, marginTop: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 4, backgroundColor: 'transparent',
  },
  rowActive: { },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, marginRight: 8 },
  checkCircle: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: '#334155',
    alignItems: 'center', justifyContent: 'center',
  },
  checkCircleActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  portfolioName: { color: '#f8fafc', fontSize: 16, fontWeight: '600' },
  portfolioSub: { color: '#64748b', fontSize: 12, marginTop: 2 },
  rowActions: { flexDirection: 'row', gap: 4 },
  iconBtn: { padding: 6 },
  combinedBtn: {
    marginHorizontal: 16, marginBottom: 8, marginTop: 4,
    borderRadius: 12, backgroundColor: '#1e293b',
    borderWidth: 1, borderColor: '#334155',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  combinedBtnActive: {
    borderColor: '#6366f1', backgroundColor: '#1e1b4b',
  },
  combinedBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  combinedBtnText: { color: '#e2e8f0', fontSize: 15, fontWeight: '600' },
  combinedBtnSub: { color: '#8f99aa', fontSize: 12, marginTop: 1 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    margin: 16, paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155',
  },
  addBtnText: { color: '#6366f1', fontSize: 15, fontWeight: '700' },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalBox: {
    backgroundColor: '#1e293b', borderRadius: 16, padding: 24,
    width: '100%', maxWidth: 380,
  },
  modalTitle: { color: '#f8fafc', fontSize: 17, fontWeight: '700', marginBottom: 16 },
  textInput: {
    backgroundColor: '#0f172a', color: '#f8fafc', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
    borderWidth: 1, borderColor: '#334155', marginBottom: 16,
  },
  modalBtns: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  modalBtnCancel: {
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 9,
    backgroundColor: '#0f172a',
  },
  modalBtnOk: {
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 9,
    backgroundColor: '#6366f1',
  },
});
