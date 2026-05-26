import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Linking, Modal, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { useSettings, Currency } from '../context/SettingsContext';
import { usePortfolio } from '../context/PortfolioContext';
import { BrokerType } from '../utils/importBroker';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export default function SettingsScreen({ navigation }: Props) {
  const {
    currency,
    setCurrency,
    fmpKey,
    fhKey,
    groqKey,
    tavilyKey,
    avKey,
    setFmpKey,
    setFhKey,
    setGroqKey,
    setTavilyKey,
    setAvKey,
    dividendTaxEnabled,
    setDividendTaxEnabled,
    dividendTaxRate,
    setDividendTaxRate,
    colorScheme,
    setColorScheme,
  } = useSettings();
  const { exportPortfolio, importPortfolio, importBrokerCSV, clearPortfolio } = usePortfolio();

  const [draftFmp, setDraftFmp] = useState(fmpKey);
  const [draftFh, setDraftFh] = useState(fhKey);
  const [draftGroq, setDraftGroq] = useState(groqKey);
  const [draftTavily, setDraftTavily] = useState(tavilyKey);
  const [draftAv, setDraftAv] = useState(avKey);
  const [draftDividendTaxEnabled, setDraftDividendTaxEnabled] = useState(dividendTaxEnabled);
  const [draftDividendTaxRate, setDraftDividendTaxRate] = useState(String(dividendTaxRate));
  const [backupBusy, setBackupBusy] = useState(false);
  const [brokerBusy, setBrokerBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [apiInfo, setApiInfo] = useState<null | { title: string; desc: string; url: string; urlLabel: string }>(null);

  const API_INFO = {
    fmp: {
      title: 'Financial Modeling Prep (FMP)',
      desc: 'Usado para fundamentais, demonstrações financeiras, dividendos e dados históricos.\n\nRegista-te gratuitamente e obtém a tua API key na secção "Dashboard". O plano gratuito cobre todas as funcionalidades desta app.',
      url: 'https://financialmodelingprep.com/developer/docs/',
      urlLabel: 'financialmodelingprep.com',
    },
    fh: {
      title: 'Finnhub',
      desc: 'Usado para cotações em tempo real, notícias de mercado, calendário de earnings e dados de insiders.\n\nRegista-te gratuitamente em finnhub.io e copia a tua API key no "Dashboard".',
      url: 'https://finnhub.io/',
      urlLabel: 'finnhub.io',
    },
    groq: {
      title: 'Groq AI',
      desc: 'Usado para análise de ações, notícias e demonstrações financeiras com IA (modelos LLaMA 3).\n\nRegista-te gratuitamente em console.groq.com e cria uma API key em "API Keys". Sem custos no plano gratuito.',
      url: 'https://console.groq.com/',
      urlLabel: 'console.groq.com',
    },
    tavily: {
      title: 'Tavily AI Search',
      desc: 'Usado para pesquisa de notícias e dados em tempo real via IA, complementando a análise da Groq.\n\nRegista-te gratuitamente em app.tavily.com e obtém a tua API key no painel principal.',
      url: 'https://app.tavily.com/',
      urlLabel: 'app.tavily.com',
    },
    av: {
      title: 'Alpha Vantage',
      desc: 'Usado para dados de earnings, receitas trimestrais, EPS e indicadores técnicos.\n\nRegista-te gratuitamente em alphavantage.co e obtém a tua API key (Standard plan, 25 req/dia). Sem custos no plano gratuito.',
      url: 'https://www.alphavantage.co/support/#api-key',
      urlLabel: 'alphavantage.co',
    },
  };

  // Keep drafts in sync if keys change externally
  useEffect(() => { setDraftFmp(fmpKey); }, [fmpKey]);
  useEffect(() => { setDraftFh(fhKey); }, [fhKey]);
  useEffect(() => { setDraftGroq(groqKey); }, [groqKey]);
  useEffect(() => { setDraftTavily(tavilyKey); }, [tavilyKey]);
  useEffect(() => { setDraftAv(avKey); }, [avKey]);
  useEffect(() => { setDraftDividendTaxEnabled(dividendTaxEnabled); }, [dividendTaxEnabled]);
  useEffect(() => { setDraftDividendTaxRate(String(dividendTaxRate)); }, [dividendTaxRate]);

  const handleSave = () => {
    setFmpKey(draftFmp);
    setFhKey(draftFh);
    setGroqKey(draftGroq);
    setTavilyKey(draftTavily);
    setAvKey(draftAv);
    setDividendTaxEnabled(draftDividendTaxEnabled);
    setDividendTaxRate(Number(draftDividendTaxRate || 0));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDividendTaxRateChange = (text: string) => {
    const sanitized = text.replace(/[^0-9]/g, '');
    if (sanitized.length === 0) {
      setDraftDividendTaxRate('');
      return;
    }
    const numeric = Math.min(100, Number(sanitized));
    setDraftDividendTaxRate(String(numeric));
  };

  const handleExport = async () => {
    setBackupBusy(true);
    try { await exportPortfolio({ fmpKey, fhKey, groqKey, tavilyKey, avKey }); }
    catch { Alert.alert('Error', 'Could not export the portfolio.'); }
    finally { setBackupBusy(false); }
  };

  const handleImport = async () => {
    // On web, window.confirm() is synchronous — preserves the browser's user gesture
    // chain so the file picker can open. Alert.alert is async and breaks it.
    if (typeof window !== 'undefined' && typeof (window as any).confirm === 'function') {
      const confirmed = (window as any).confirm('This will replace all current portfolios and data. Are you sure?');
      if (!confirmed) return;
      setBackupBusy(true);
      try {
        const res = await importPortfolio();
        if (res.ok && res.apiKeys) {
          const k = res.apiKeys;
          if (k.fmpKey) { setFmpKey(k.fmpKey); setDraftFmp(k.fmpKey); }
          if (k.fhKey) { setFhKey(k.fhKey); setDraftFh(k.fhKey); }
          if (k.groqKey) { setGroqKey(k.groqKey); setDraftGroq(k.groqKey); }
          if (k.tavilyKey) { setTavilyKey(k.tavilyKey); setDraftTavily(k.tavilyKey); }
          if (k.avKey) { setAvKey(k.avKey); setDraftAv(k.avKey); }
        }
        Alert.alert(res.ok ? 'Success' : 'Error', res.message);
        if (res.ok) navigation.goBack();
      } finally { setBackupBusy(false); }
      return;
    }
    // Mobile: keep the existing Alert.alert flow
    Alert.alert(
      'Import portfolios',
      'This will replace all current portfolios and data. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import', style: 'destructive',
          onPress: async () => {
            setBackupBusy(true);
            try {
              const res = await importPortfolio();
              if (res.ok && res.apiKeys) {
                const k = res.apiKeys;
                if (k.fmpKey) { setFmpKey(k.fmpKey); setDraftFmp(k.fmpKey); }
                if (k.fhKey) { setFhKey(k.fhKey); setDraftFh(k.fhKey); }
                if (k.groqKey) { setGroqKey(k.groqKey); setDraftGroq(k.groqKey); }
                if (k.tavilyKey) { setTavilyKey(k.tavilyKey); setDraftTavily(k.tavilyKey); }
                if (k.avKey) { setAvKey(k.avKey); setDraftAv(k.avKey); }
              }
              Alert.alert(res.ok ? 'Success' : 'Error', res.message);
              if (res.ok) navigation.goBack();
            } finally { setBackupBusy(false); }
          },
        },
      ]
    );
  };

  const handleClearPortfolio = () => {
    Alert.alert(
      'Delete portfolio',
      'This will permanently erase all positions and transactions. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything', style: 'destructive',
          onPress: async () => {
            await clearPortfolio();
            Alert.alert('Done', 'Portfolio deleted.');
          },
        },
      ]
    );
  };

  const handleBrokerImport = async (broker: BrokerType) => {
    setBrokerBusy(true);
    try {
      const res = await importBrokerCSV(broker);
      Alert.alert(res.ok ? 'Success' : 'Error', res.message);
    } finally { setBrokerBusy(false); }
  };

  const currencyOptions: { label: string; value: Currency; desc: string }[] = [
    { label: 'Euro (€)', value: 'EUR', desc: 'Automatically converts USD → EUR' },
    { label: 'Dollar ($)', value: 'USD', desc: 'Shows values in the original currency' },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      <Text style={styles.section}>Portfolio currency</Text>
      {currencyOptions.map((opt) => (
        <TouchableOpacity
          key={opt.value}
          style={[styles.optionRow, currency === opt.value && styles.optionRowActive]}
          onPress={() => setCurrency(opt.value)}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.optionLabel}>{opt.label}</Text>
            <Text style={styles.optionDesc}>{opt.desc}</Text>
          </View>
          {currency === opt.value && (
            <Ionicons name="checkmark-circle" size={22} color="#6366f1" />
          )}
        </TouchableOpacity>
      ))}
      <Text style={[styles.section, { marginTop: 28 }]}>Appearance</Text>
      <View style={[styles.taxCard, { flexDirection: 'row', alignItems: 'center' }]}>
        <Ionicons
          name={colorScheme === 'light' ? 'sunny' : 'moon'}
          size={20}
          color={colorScheme === 'light' ? '#f59e0b' : '#6366f1'}
          style={{ marginRight: 12 }}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.taxTitle}>{colorScheme === 'light' ? 'Light mode' : 'Dark mode'}</Text>
          <Text style={styles.taxDesc}>Switch between dark and light theme.</Text>
        </View>
        <Switch
          value={colorScheme === 'light'}
          onValueChange={(v) => setColorScheme(v ? 'light' : 'dark')}
          trackColor={{ false: '#2d3748', true: '#6366f1' }}
          thumbColor="#fff"
        />
      </View>
      <Text style={[styles.section, { marginTop: 28 }]}>Dividend taxes</Text>
      <View style={styles.taxCard}>
        <View style={styles.taxHeaderRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.taxTitle}>Consider dividend taxes</Text>
            <Text style={styles.taxDesc}>Apply a net dividend rate across the app.</Text>
          </View>
          <Switch
            value={draftDividendTaxEnabled}
            onValueChange={setDraftDividendTaxEnabled}
            trackColor={{ false: '#334155', true: '#6366f1' }}
            thumbColor="#f8fafc"
          />
        </View>

        <Text style={styles.label}>Dividend tax rate (%)</Text>
        <TextInput
          style={[styles.input, !draftDividendTaxEnabled && styles.inputDisabled]}
          value={draftDividendTaxRate}
          onChangeText={handleDividendTaxRateChange}
          placeholder="15"
          placeholderTextColor="#475569"
          keyboardType="number-pad"
          editable={draftDividendTaxEnabled}
          maxLength={3}
        />

        <View style={styles.taxInfoBox}>
          <Ionicons name="information-circle-outline" size={15} color="#94a3b8" style={{ marginTop: 1 }} />
          <Text style={styles.taxInfoText}>
            Enabling taxes on your dashboard applies them to all portfolios and dividend screens.
          </Text>
        </View>
      </View>

      <Text style={[styles.section, { marginTop: 28 }]}>API Keys</Text>
      <View style={styles.apiBanner}>
        <Ionicons name="key-outline" size={16} color="#f59e0b" style={{ marginTop: 1 }} />
        <Text style={styles.apiBannerText}>
          This app uses only free plans. You need to create an account for each service and enter your own API keys — nothing is shared or sent to our servers.
        </Text>
      </View>

      <View style={styles.labelRow}>
        <Text style={styles.label}>Financial Modeling Prep (FMP)</Text>
        <TouchableOpacity onPress={() => setApiInfo(API_INFO.fmp)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="information-circle-outline" size={17} color="#64748b" />
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.input}
        value={draftFmp}
        onChangeText={setDraftFmp}
        placeholder="Paste your FMP API key here"
        placeholderTextColor="#475569"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={[styles.labelRow, { marginTop: 12 }]}>
        <Text style={styles.label}>Finnhub</Text>
        <TouchableOpacity onPress={() => setApiInfo(API_INFO.fh)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="information-circle-outline" size={17} color="#64748b" />
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.input}
        value={draftFh}
        onChangeText={setDraftFh}
        placeholder="Paste your Finnhub API key here"
        placeholderTextColor="#475569"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={[styles.labelRow, { marginTop: 12 }]}>
        <Text style={styles.label}>Groq AI</Text>
        <TouchableOpacity onPress={() => setApiInfo(API_INFO.groq)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="information-circle-outline" size={17} color="#64748b" />
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.input}
        value={draftGroq}
        onChangeText={setDraftGroq}
        placeholder="Paste your Groq API key here"
        placeholderTextColor="#475569"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={[styles.labelRow, { marginTop: 12 }]}>
        <Text style={styles.label}>Tavily AI Search</Text>
        <TouchableOpacity onPress={() => setApiInfo(API_INFO.tavily)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="information-circle-outline" size={17} color="#64748b" />
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.input}
        value={draftTavily}
        onChangeText={setDraftTavily}
        placeholder="Paste your Tavily API key here"
        placeholderTextColor="#475569"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={[styles.labelRow, { marginTop: 12 }]}>
        <Text style={styles.label}>Alpha Vantage</Text>
        <TouchableOpacity onPress={() => setApiInfo(API_INFO.av)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="information-circle-outline" size={17} color="#64748b" />
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.input}
        value={draftAv}
        onChangeText={setDraftAv}
        placeholder="Paste your Alpha Vantage API key here"
        placeholderTextColor="#475569"
        autoCapitalize="none"
        autoCorrect={false}
      />

      {apiInfo && (
        <Modal transparent animationType="fade" onRequestClose={() => setApiInfo(null)}>
          <TouchableOpacity style={styles.apiModalOverlay} activeOpacity={1} onPress={() => setApiInfo(null)}>
            <View style={styles.apiModalBox}>
              <Text style={styles.apiModalTitle}>{apiInfo.title}</Text>
              <Text style={styles.apiModalDesc}>{apiInfo.desc}</Text>
              <TouchableOpacity onPress={() => Linking.openURL(apiInfo.url)} style={styles.apiModalLink}>
                <Ionicons name="open-outline" size={14} color="#818cf8" />
                <Text style={styles.apiModalLinkText}>{apiInfo.urlLabel}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setApiInfo(null)} style={styles.apiModalClose}>
                <Text style={styles.apiModalCloseTxt}>Close</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      <TouchableOpacity style={[styles.saveBtn, saved && styles.saveBtnDone]} onPress={handleSave}>
        {saved
          ? <><Ionicons name="checkmark" size={18} color="#fff" /><Text style={styles.saveBtnText}>  Saved</Text></>
          : <Text style={styles.saveBtnText}>Save Settings</Text>
        }
      </TouchableOpacity>

      <Text style={[styles.section, { marginTop: 28 }]}>Portfolio backup</Text>
      <Text style={styles.hint}>
        Export to a JSON file that you can keep and import on another device or after reinstalling the app.
      </Text>

      {backupBusy
        ? <ActivityIndicator color="#6366f1" style={{ marginTop: 12 }} />
        : (
          <View style={styles.backupRow}>
            <TouchableOpacity style={[styles.backupBtn, { flex: 1 }]} onPress={handleExport}>
              <Ionicons name="share-outline" size={18} color="#f8fafc" />
              <Text style={styles.backupBtnText}>Export</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.backupBtn, { flex: 1 }]} onPress={handleImport}>
              <Ionicons name="download-outline" size={18} color="#f8fafc" />
              <Text style={styles.backupBtnText}>Import</Text>
            </TouchableOpacity>
          </View>
        )
      }

      <Text style={[styles.section, { marginTop: 28 }]}>Import from broker</Text>
      <Text style={styles.hint}>
        Import transactions directly from your broker statement. Existing positions are preserved.
      </Text>
      {brokerBusy
        ? <ActivityIndicator color="#6366f1" style={{ marginTop: 12 }} />
        : (
          <View style={{ marginTop: 4, gap: 10 }}>
            <TouchableOpacity style={styles.backupBtn} onPress={() => handleBrokerImport('ibkr')}>
              <Ionicons name="cloud-download-outline" size={18} color="#f8fafc" />
              <Text style={styles.backupBtnText}>Upload Interactive Brokers CSV</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.backupBtn} onPress={() => handleBrokerImport('trade_republic')}>
              <Ionicons name="document-text-outline" size={18} color="#f8fafc" />
              <Text style={styles.backupBtnText}>Upload Trade Republic CSV</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.backupBtn} onPress={() => handleBrokerImport('trading212')}>
              <Ionicons name="document-attach-outline" size={18} color="#f8fafc" />
              <Text style={styles.backupBtnText}>Upload Trading 212 CSV</Text>
            </TouchableOpacity>
          </View>
        )
      }

      <Text style={[styles.section, { marginTop: 32, color: '#ef4444' }]}>Danger zone</Text>
      <TouchableOpacity style={styles.dangerBtn} onPress={handleClearPortfolio}>
        <Ionicons name="trash-outline" size={18} color="#ef4444" />
        <Text style={styles.dangerBtnText}>Delete portfolio</Text>
      </TouchableOpacity>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  content: { padding: 20, paddingBottom: 60 },
  section: {
    color: '#64748b', fontSize: 12, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10,
  },
  hint: { color: '#64748b', fontSize: 12, marginBottom: 14, lineHeight: 18 },
  apiBanner: {
    flexDirection: 'row', gap: 8, backgroundColor: '#1c1a0e', borderLeftWidth: 3,
    borderLeftColor: '#f59e0b', borderRadius: 8, padding: 12, marginBottom: 16, alignItems: 'flex-start',
  },
  apiBannerText: { flex: 1, color: '#fbbf24', fontSize: 12, lineHeight: 18 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  label: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  apiModalOverlay: {
    flex: 1, backgroundColor: '#00000099', justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  apiModalBox: {
    backgroundColor: '#1b2023', borderRadius: 14, padding: 20, width: '100%', maxWidth: 360,
    borderWidth: 1, borderColor: '#303841',
  },
  apiModalTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700', marginBottom: 10 },
  apiModalDesc: { color: '#94a3b8', fontSize: 13, lineHeight: 20, marginBottom: 14 },
  apiModalLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 18 },
  apiModalLinkText: { color: '#818cf8', fontSize: 13, textDecorationLine: 'underline' },
  apiModalClose: {
    backgroundColor: '#1b2023', borderRadius: 8, paddingVertical: 10, alignItems: 'center',
    borderWidth: 1, borderColor: '#303841',
  },
  apiModalCloseTxt: { color: '#f8fafc', fontWeight: '600', fontSize: 14 },
  optionRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, borderRadius: 10, marginBottom: 8,
    backgroundColor: '#1b2023',
    borderWidth: 1,
    borderColor: '#303841',
  },
  optionRowActive: { borderWidth: 1, borderColor: '#6366f1' },
  optionLabel: { color: '#f8fafc', fontWeight: '600', fontSize: 15 },
  optionDesc: { color: '#64748b', fontSize: 12, marginTop: 2 },
  taxCard: {
    backgroundColor: '#1b2023',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#303841',
    padding: 16,
  },
  taxHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  taxTitle: { color: '#f8fafc', fontWeight: '600', fontSize: 16 },
  taxDesc: { color: '#64748b', fontSize: 12, marginTop: 4, lineHeight: 17 },
  input: {
    backgroundColor: '#171c1f', borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: 12, color: '#f8fafc', fontSize: 14,
    borderWidth: 1, borderColor: '#2a3036',
  },
  inputDisabled: { opacity: 0.55 },
  taxInfoBox: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#171c1f',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#2a3036',
  },
  taxInfoText: { flex: 1, color: '#cbd5e1', fontSize: 12, lineHeight: 18 },
  saveBtn: {
    marginTop: 20, padding: 14, backgroundColor: '#6366f1',
    borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center',
  },
  saveBtnDone: { backgroundColor: '#16a34a' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  backupRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  backupBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 13, backgroundColor: '#1b2023', borderRadius: 10,
    borderWidth: 1, borderColor: '#303841',
  },
  backupBtnText: { color: '#f8fafc', fontWeight: '600', fontSize: 14 },
  dangerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 13, borderRadius: 10, marginTop: 4,
    borderWidth: 1, borderColor: '#ef4444', backgroundColor: 'transparent',
  },
  dangerBtnText: { color: '#ef4444', fontWeight: '600', fontSize: 14 },
});
