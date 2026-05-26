import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Modal, Pressable, Dimensions,
} from 'react-native';
import Svg, { Polyline, Line, Text as SvgText, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { usePortfolio } from '../context/PortfolioContext';
import { useSettings } from '../context/SettingsContext';
import { searchTavily, fetchAVForChat } from '../services/api';
import axios from 'axios';

type Props = NativeStackScreenProps<RootStackParamList, 'PortfolioChat'>;

const CONVS_KEY = '@portfolio_chat_conversations';
const { width: SCREEN_W } = Dimensions.get('window');

interface ChartPoint { date: string; value: number; value2?: number; value3?: number; }
interface CompMetric { label: string; values: (number | null)[] }
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  chart?: { points: ChartPoint[]; label: string; symbol: string; type: string };
  chartComparison?: { tickers: string[]; metrics: CompMetric[] };
}

const NAME_TO_TICKER: Record<string, string> = {
  mastercard: 'MA', visa: 'V', apple: 'AAPL', microsoft: 'MSFT',
  google: 'GOOGL', alphabet: 'GOOGL', amazon: 'AMZN', meta: 'META',
  facebook: 'META', nvidia: 'NVDA', tesla: 'TSLA', netflix: 'NFLX',
  boeing: 'BA', disney: 'DIS', intel: 'INTC', amd: 'AMD', paypal: 'PYPL',
  uber: 'UBER', airbnb: 'ABNB', spotify: 'SPOT', salesforce: 'CRM',
  jpmorgan: 'JPM', goldman: 'GS', berkshire: 'BRK.B', coca: 'KO',
  pepsi: 'PEP', johnson: 'JNJ', walmart: 'WMT', exxon: 'XOM',
};

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  messages: Message[];
}

function buildSystemPrompt(
  holdings: ReturnType<typeof usePortfolio>['holdings'],
  transactions: ReturnType<typeof usePortfolio>['transactions'],
  currency: string,
  getRateFor: (c: string) => number,
): string {
  const fmtB = (v: number) => {
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return v.toFixed(2);
  };
  const totalCost = holdings.reduce(
    (s, h) => s + h.avgPrice * getRateFor(h.currency ?? 'USD') * h.shares, 0,
  );
  const holdingsDesc = holdings.length === 0
    ? 'O portfólio está vazio.'
    : holdings.map((h) => {
        const rate = getRateFor(h.currency ?? 'USD');
        const cost = h.avgPrice * rate * h.shares;
        const weight = totalCost > 0 ? ((cost / totalCost) * 100).toFixed(1) : '0';
        return `• ${h.symbol} (${h.name}): ${h.shares % 1 === 0 ? h.shares.toFixed(0) : h.shares.toFixed(4)} ações, preço médio ${h.avgPrice.toFixed(2)} ${h.currency ?? 'USD'}, custo total ≈ ${fmtB(cost)} ${currency}, peso ${weight}%`;
      }).join('\n');
  const txSummary = (() => {
    const bySymbol: Record<string, number> = {};
    transactions.forEach((t) => { bySymbol[t.symbol] = (bySymbol[t.symbol] ?? 0) + 1; });
    return `${transactions.length} transações (${Object.keys(bySymbol).length} símbolos diferentes)`;
  })();
  return `És um conselheiro financeiro especialista em portfólios de ações. Responde sempre em português de Portugal.

PORTFÓLIO ATUAL (moeda: ${currency})
Total de posições: ${holdings.length} | Custo total: ${fmtB(totalCost)} ${currency} | ${txSummary}

POSIÇÕES:
${holdingsDesc}

REGRAS DE COMPORTAMENTO:
1. CÁLCULOS DE PORTFÓLIO: faz livremente com os dados acima (custo médio, peso, ganho/perda, etc.).
2. INFORMAÇÃO SOBRE EMPRESAS/SETORES: usa APENAS o que receberes via contexto web. NUNCA assumas pelo nome ou símbolo.
3. NOTÍCIAS E EVENTOS: quando receberes contexto web com notícias, cruza SEMPRE com o portfólio — identifica quais posições são afetadas, de que forma e em que magnitude.
4. SEM INVENÇÕES: se não tiveres informação verificada, diz "Não tenho informação verificada sobre isso" — nunca suponhas.
5. Respostas diretas e objetivas, máximo 300 palavras.
6. NUNCA geres HTML. Os gráficos são gerados automaticamente pela app — NUNCA digas que não podes gerar gráficos. Quando receberes dados técnicos ou de comparação, comenta-os em português de forma objetiva. Se não receberes dados, compara com base no teu conhecimento.`;
}

// ─── Inline SVG sparkline chart ──────────────────────────────────────────────
function SparkChart({ points, label, symbol, type }: { points: ChartPoint[]; label: string; symbol: string; type: string }) {
  const W = SCREEN_W - 72;
  const H = 180;
  const PAD = { top: 24, bottom: 28, left: 8, right: 8 };
  const vals = points.map(p => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const toX = (i: number) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
  const toY = (v: number) => PAD.top + (1 - (v - min) / range) * (H - PAD.top - PAD.bottom);

  const polyPoints = points.map((p, i) => `${toX(i)},${toY(p.value)}`).join(' ');

  // For MACD: also draw value2 (signal) and value3 (hist bars)
  const poly2 = type === 'macd' && points[0]?.value2 != null
    ? points.map((p, i) => `${toX(i)},${toY(p.value2!)}`).join(' ')
    : null;

  // RSI reference lines at 30 and 70
  const rsiLine30 = type === 'rsi' ? toY(30) : null;
  const rsiLine70 = type === 'rsi' ? toY(70) : null;

  // BBands: value2=upper, value3=lower → already in value (middle)
  const polyUpper = type === 'bbands' && points[0]?.value2 != null
    ? points.map((p, i) => `${toX(i)},${toY(p.value2!)}`).join(' ')
    : null;
  const polyLower = type === 'bbands' && points[0]?.value3 != null
    ? points.map((p, i) => `${toX(i)},${toY(p.value3!)}`).join(' ')
    : null;

  const lastVal = vals[vals.length - 1];
  const firstVal = vals[0];
  const isUp = lastVal >= firstVal;
  const lineColor = type === 'rsi' ? '#a78bfa' : isUp ? '#4ade80' : '#fb923c';

  // X-axis labels: first, middle, last date
  const xLabels = [0, Math.floor(points.length / 2), points.length - 1].map(i => ({
    x: toX(i), label: points[i]?.date?.slice(5) ?? '',
  }));

  return (
    <View style={{ backgroundColor: '#0f172a', borderRadius: 10, overflow: 'hidden', marginBottom: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10, paddingTop: 10, paddingBottom: 4 }}>
        <Text style={{ color: '#94a3b8', fontSize: 12, fontWeight: '600' }}>{symbol} — {label}</Text>
        <Text style={{ color: isUp ? '#4ade80' : '#fb923c', fontSize: 12, fontWeight: '700' }}>
          {lastVal.toFixed(type === 'rsi' ? 1 : 2)}
        </Text>
      </View>
      <Svg width={W} height={H}>
        {/* RSI reference lines */}
        {rsiLine30 != null && <Line x1={PAD.left} y1={rsiLine30} x2={W - PAD.right} y2={rsiLine30} stroke="#ef4444" strokeWidth={1} strokeDasharray="4,3" opacity={0.6} />}
        {rsiLine70 != null && <Line x1={PAD.left} y1={rsiLine70} x2={W - PAD.right} y2={rsiLine70} stroke="#ef4444" strokeWidth={1} strokeDasharray="4,3" opacity={0.6} />}
        {rsiLine30 != null && <SvgText x={W - PAD.right - 2} y={rsiLine30 - 3} fontSize={9} fill="#ef4444" textAnchor="end">30</SvgText>}
        {rsiLine70 != null && <SvgText x={W - PAD.right - 2} y={rsiLine70 - 3} fontSize={9} fill="#ef4444" textAnchor="end">70</SvgText>}
        {/* BBands upper/lower */}
        {polyUpper && <Polyline points={polyUpper} fill="none" stroke="#6366f1" strokeWidth={1} opacity={0.5} />}
        {polyLower && <Polyline points={polyLower} fill="none" stroke="#6366f1" strokeWidth={1} opacity={0.5} />}
        {/* Main line */}
        <Polyline points={polyPoints} fill="none" stroke={lineColor} strokeWidth={2} />
        {/* MACD signal line */}
        {poly2 && <Polyline points={poly2} fill="none" stroke="#f59e0b" strokeWidth={1.5} />}
        {/* X-axis labels */}
        {xLabels.map(({ x, label: lbl }) => (
          <SvgText key={lbl} x={x} y={H - 6} fontSize={9} fill="#475569" textAnchor="middle">{lbl}</SvgText>
        ))}
      </Svg>
    </View>
  );
}

// ─── Comparison bar chart ────────────────────────────────────────────────────
function ComparisonBarChart({ tickers, metrics }: { tickers: string[]; metrics: CompMetric[] }) {
  const W = SCREEN_W - 72;
  const H = 210;
  const PAD = { top: 28, bottom: 34, left: 6, right: 6 };
  const COLORS = ['#6366f1', '#f59e0b'];
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const allPcts = metrics.flatMap(m => m.values.map(v => v != null ? Math.abs(v * 100) : 0));
  const maxPct = Math.max(...allPcts, 1);
  const hasNeg = metrics.some(m => m.values.some(v => v != null && v < 0));
  const zeroY = hasNeg ? PAD.top + chartH / 2 : PAD.top + chartH;
  const scaleH = hasNeg ? chartH / 2 : chartH;
  const groupW = chartW / metrics.length;
  const barW = Math.min(groupW * 0.3, 18);

  return (
    <View style={{ backgroundColor: '#0f172a', borderRadius: 10, overflow: 'hidden', marginBottom: 6 }}>
      <View style={{ flexDirection: 'row', gap: 14, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 2 }}>
        {tickers.map((t, i) => (
          <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: COLORS[i] }} />
            <Text style={{ color: '#e2e8f0', fontSize: 12, fontWeight: '600' }}>{t}</Text>
          </View>
        ))}
      </View>
      <Svg width={W} height={H}>
        <Line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY} stroke="#334155" strokeWidth={1} />
        {metrics.map((metric, mi) => {
          const cx = PAD.left + mi * groupW + groupW / 2;
          return (
            <React.Fragment key={metric.label}>
              {metric.values.map((val, ti) => {
                if (val == null) return null;
                const pct = val * 100;
                const bh = Math.max(2, (Math.abs(pct) / maxPct) * scaleH);
                const bx = cx + (ti === 0 ? -(barW + 1) : 1);
                const by = pct < 0 ? zeroY : zeroY - bh;
                const ly = pct < 0 ? zeroY + bh + 9 : zeroY - bh - 4;
                return (
                  <React.Fragment key={ti}>
                    <Rect x={bx} y={by} width={barW} height={bh} fill={COLORS[ti]} rx={2} opacity={0.9} />
                    <SvgText x={bx + barW / 2} y={ly} fontSize={8} fill={COLORS[ti]} textAnchor="middle">
                      {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
                    </SvgText>
                  </React.Fragment>
                );
              })}
              <SvgText x={cx} y={H - 6} fontSize={9} fill="#64748b" textAnchor="middle">{metric.label}</SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

// ─── Earnings bar + surprise line chart ─────────────────────────────────────
function EarningsChart({ points, symbol }: { points: ChartPoint[]; symbol: string }) {
  const W = SCREEN_W - 72;
  const H = 220;
  const PAD = { top: 30, bottom: 40, left: 36, right: 36 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const n = points.length;
  if (n === 0) return null;
  const maxEPS = Math.max(...points.map(p => Math.max(p.value, p.value2 ?? 0, 0.01)));
  const surprises = points.map(p => p.value3 ?? 0);
  const maxSurp = Math.max(...surprises.map(Math.abs), 1);
  const barGroup = chartW / n;
  const barW = Math.min(barGroup * 0.35, 14);
  const toY = (v: number) => PAD.top + chartH - (v / maxEPS) * chartH;
  const toSurpY = (v: number) => PAD.top + chartH / 2 - (v / maxSurp) * (chartH / 2.2);
  const surpPoints = points.map((p, i) => {
    const cx = PAD.left + i * barGroup + barGroup / 2;
    return `${cx},${toSurpY(p.value3 ?? 0)}`;
  }).join(' ');
  return (
    <View style={{ backgroundColor: '#0f172a', borderRadius: 10, overflow: 'hidden', marginBottom: 6 }}>
      <View style={{ flexDirection: 'row', gap: 14, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 10, height: 10, borderRadius: 1, backgroundColor: '#e2e8f0' }} />
          <Text style={{ color: '#e2e8f0', fontSize: 11, fontWeight: '600' }}>EPS Real</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 10, height: 10, borderRadius: 1, backgroundColor: '#475569' }} />
          <Text style={{ color: '#94a3b8', fontSize: 11 }}>Estimativa</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 10, height: 2, backgroundColor: '#34d399' }} />
          <Text style={{ color: '#34d399', fontSize: 11 }}>Surpresa %</Text>
        </View>
      </View>
      <Svg width={W} height={H}>
        {/* Zero baseline */}
        <Line x1={PAD.left} y1={PAD.top + chartH} x2={W - PAD.right} y2={PAD.top + chartH} stroke="#334155" strokeWidth={1} />
        {/* Bars: actual (white) and estimate (gray) */}
        {points.map((p, i) => {
          const cx = PAD.left + i * barGroup + barGroup / 2;
          const bxEst = cx - barW - 1;
          const bxAct = cx + 1;
          const yAct = toY(Math.max(p.value, 0));
          const yEst = toY(Math.max(p.value2 ?? 0, 0));
          const hAct = PAD.top + chartH - yAct;
          const hEst = PAD.top + chartH - yEst;
          const beat = p.value >= (p.value2 ?? 0);
          // quarter label (YYYY-MM → Q?)
          const parts = p.date.split('-');
          const mo = parseInt(parts[1] ?? '1');
          const qLabel = `Q${Math.ceil(mo / 3)} ${parts[0]?.slice(2)}`;
          return (
            <React.Fragment key={i}>
              <Rect x={bxEst} y={yEst} width={barW} height={Math.max(hEst, 2)} fill="#475569" rx={2} />
              <Rect x={bxAct} y={yAct} width={barW} height={Math.max(hAct, 2)} fill={beat ? '#e2e8f0' : '#f87171'} rx={2} />
              <SvgText x={cx} y={H - 6} fontSize={8} fill="#64748b" textAnchor="middle">{qLabel}</SvgText>
              <SvgText x={cx} y={yAct - 3} fontSize={7} fill={beat ? '#34d399' : '#f87171'} textAnchor="middle">
                {(p.value3 ?? 0) > 0 ? '+' : ''}{(p.value3 ?? 0).toFixed(1)}%
              </SvgText>
            </React.Fragment>
          );
        })}
        {/* Surprise % line */}
        {points.length > 1 && (
          <Polyline points={surpPoints} fill="none" stroke="#34d399" strokeWidth={1.5} strokeDasharray="3,2" />
        )}
        {/* Y-axis label */}
        <SvgText x={PAD.left - 2} y={PAD.top + 8} fontSize={8} fill="#64748b" textAnchor="end">EPS</SvgText>
        <SvgText x={W - PAD.right + 2} y={PAD.top + 8} fontSize={8} fill="#34d399" textAnchor="start">%</SvgText>
      </Svg>
    </View>
  );
}

function newConversation(firstMsg: Message): Conversation {
  return {
    id: Date.now().toString(),
    title: 'New conversation',
    createdAt: new Date().toISOString(),
    messages: [firstMsg],
  };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PortfolioChatScreen({ navigation }: Props) {
  const { holdings, transactions } = usePortfolio();
  const { groqKey, tavilyKey, currency, getRateFor } = useSettings();
  const insets = useSafeAreaInsets();
  const systemPrompt = buildSystemPrompt(holdings, transactions, currency, getRateFor);

  const makeWelcome = (): Message => ({
    id: '0',
    role: 'assistant',
    content: `Hello! I have access to your portfolio (${holdings.length} ${holdings.length === 1 ? 'position' : 'positions'}). Ask me anything about macro events, risk analysis, diversification, or whatever you need.`,
  });

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const flatRef = useRef<FlatList>(null);

  const activeConv = conversations.find((c) => c.id === activeId);
  const messages = activeConv?.messages ?? [];

  // Load conversations on mount
  useEffect(() => {
    AsyncStorage.getItem(CONVS_KEY).then((raw) => {
      if (raw) {
        try {
          const saved: Conversation[] = JSON.parse(raw);
          if (saved.length > 0) {
            setConversations(saved);
            setActiveId(saved[0].id);
            return;
          }
        } catch { /* ignore */ }
      }
      // No saved conversations — create first one
      const first = newConversation(makeWelcome());
      setConversations([first]);
      setActiveId(first.id);
    });
  }, []);

  // Persist whenever conversations change
  useEffect(() => {
    if (conversations.length > 0) {
      AsyncStorage.setItem(CONVS_KEY, JSON.stringify(conversations));
    }
  }, [conversations]);

  const updateActiveMessages = useCallback((msgs: Message[]) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c;
        // Auto-title from first user message
        const firstUser = msgs.find((m) => m.role === 'user');
        const title = firstUser
          ? firstUser.content.slice(0, 50) + (firstUser.content.length > 50 ? '…' : '')
          : c.title;
        return { ...c, title, messages: msgs };
      }),
    );
  }, [activeId]);

  const startNewChat = useCallback(() => {
    const conv = newConversation(makeWelcome());
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    setHistoryOpen(false);
  }, [holdings.length]);

  const openConversation = useCallback((id: string) => {
    setActiveId(id);
    setHistoryOpen(false);
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (id === activeId) {
        if (next.length > 0) setActiveId(next[0].id);
        else {
          const fresh = newConversation(makeWelcome());
          setActiveId(fresh.id);
          return [fresh];
        }
      }
      return next;
    });
  }, [activeId, holdings.length]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: 16, marginRight: 4 }}>
          <TouchableOpacity onPress={() => setHistoryOpen(true)} hitSlop={8}>
            <Ionicons name="time-outline" size={22} color="#94a3b8" />
          </TouchableOpacity>
          <TouchableOpacity onPress={startNewChat} hitSlop={8}>
            <Ionicons name="create-outline" size={22} color="#94a3b8" />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, startNewChat]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !activeId) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    updateActiveMessages(newMessages);
    setInput('');
    setLoading(true);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      // ── Shared ticker resolver ────────────────────────────────────────────
      const holdingSymbols = holdings.map(h => h.symbol);
      const resolveTicker = (word: string): string | null => {
        const clean = word.toLowerCase().replace(/[^a-z]/g, '');
        if (NAME_TO_TICKER[clean]) return NAME_TO_TICKER[clean];
        const holding = holdingSymbols.find(s => s.toLowerCase() === clean);
        if (holding) return holding;
        if (/^[A-Z]{2,5}$/.test(word)) return word;
        return null;
      };

      // ── Find ALL tickers mentioned in message ─────────────────────────────
      const allMentionedTickers: string[] = [];
      for (const word of text.split(/[\s,]+/)) {
        const t = resolveTicker(word);
        if (t && !allMentionedTickers.includes(t)) allMentionedTickers.push(t);
      }
      // Context-clue fallback: "da AAPL", "para MSFT"
      if (allMentionedTickers.length === 0) {
        const ctxMatch = text.match(/(?:de |do |da |for |para |sobre |ticker[:\s]+)([A-Za-z]{2,5})\b/i);
        if (ctxMatch) allMentionedTickers.push(ctxMatch[1].toUpperCase());
      }
      // Last resort: standalone uppercase 2-5 letter word
      if (allMentionedTickers.length === 0) {
        const upMatch = text.match(/\b([A-Z]{2,5})\b/);
        if (upMatch) allMentionedTickers.push(upMatch[1]);
      }
      const detectedSymbol = allMentionedTickers[0] ?? null;

      // ── Detect comparison: explicit keywords OR 2+ tickers + chart intent ─
      const COMPARE_RE = /\b(compara(r)?|vs\.?|versus|diferen[cç]a entre|comparação|compare)\b/i;
      const CHART_PATTERNS: [RegExp, string, string][] = [
        [/\brsi\b/i, 'rsi', 'RSI (14 períodos)'],
        [/\bmacd\b/i, 'macd', 'MACD'],
        [/\b(sma|média móvel|moving average)\b/i, 'sma', 'SMA 50'],
        [/\b(bollinger|bbands|bandas)\b/i, 'bbands', 'Bollinger Bands'],
        [/\b(earnings|lucros?|resultados?|eps|surpresa|beat|miss)\b/i, 'earnings', 'Earnings'],
        [/\b(preço|price|histórico|chart|gráfico|crescimento|evolução|valorização|performance)\b/i, 'price', 'Price'],
      ];
      const isChartIntent = CHART_PATTERNS.some(([re]) => re.test(text));
      const isCompareRequest = COMPARE_RE.test(text) || (isChartIntent && allMentionedTickers.length >= 2);
      let chartComparison: Message['chartComparison'] | undefined;
      let comparisonTickers: string[] = isCompareRequest ? allMentionedTickers.slice(0, 2) : [];

      if (isCompareRequest && comparisonTickers.length === 2) {
        try {
          const [ov1, ov2] = await Promise.all([
            fetchAVForChat(comparisonTickers[0], 'overview'),
            fetchAVForChat(comparisonTickers[1], 'overview'),
          ]);
          const pct = (v: unknown) => { const n = parseFloat(v as string); return isNaN(n) ? null : n; };
          const metrics: CompMetric[] = [
            { label: 'Rev Growth', values: [pct(ov1.QuarterlyRevenueGrowthYOY), pct(ov2.QuarterlyRevenueGrowthYOY)] },
            { label: 'EPS Growth', values: [pct(ov1.QuarterlyEarningsGrowthYOY), pct(ov2.QuarterlyEarningsGrowthYOY)] },
            { label: 'Profit Mgn', values: [pct(ov1.ProfitMargin), pct(ov2.ProfitMargin)] },
            { label: 'ROE', values: [pct(ov1.ReturnOnEquityTTM), pct(ov2.ReturnOnEquityTTM)] },
          ];
          if (metrics.some(m => m.values.some(v => v != null))) {
            chartComparison = { tickers: comparisonTickers, metrics };
          }
        } catch { /* AV unavailable, will use fallback context */ }
      }

      const isChartRequest = isChartIntent && detectedSymbol && !isCompareRequest;
      let chartData: Message['chart'] | undefined;
      let chartSummaryContext = '';

      if (isChartRequest && detectedSymbol) {
        const [chartType, chartLabel] = CHART_PATTERNS.find(([re]) => re.test(text))!.slice(1) as [string, string];
        try {
          const avData = await fetchAVForChat(detectedSymbol, chartType as any);
          const buildPoints = (): ChartPoint[] => {
            if (chartType === 'earnings') {
              const qArr = (avData.quarterlyEarnings as any[]) ?? [];
              return qArr.slice(0, 8).reverse().map((q: any) => ({
                date: q.fiscalDateEnding ?? '',
                value: parseFloat(q.reportedEPS) || 0,
                value2: parseFloat(q.estimatedEPS) || 0,
                value3: parseFloat(q.surprisePercentage) || 0,
              }));
            } else if (chartType === 'rsi') {
              const ts = avData['Technical Analysis: RSI'] as Record<string, Record<string, string>> ?? {};
              return Object.entries(ts).slice(0, 30).reverse().map(([d, v]) => ({ date: d, value: parseFloat(v['RSI']) }));
            } else if (chartType === 'macd') {
              const ts = avData['Technical Analysis: MACD'] as Record<string, Record<string, string>> ?? {};
              return Object.entries(ts).slice(0, 30).reverse().map(([d, v]) => ({
                date: d, value: parseFloat(v['MACD']), value2: parseFloat(v['MACD_Signal']), value3: parseFloat(v['MACD_Hist']),
              }));
            } else if (chartType === 'sma') {
              const ts = avData['Technical Analysis: SMA'] as Record<string, Record<string, string>> ?? {};
              return Object.entries(ts).slice(0, 30).reverse().map(([d, v]) => ({ date: d, value: parseFloat(v['SMA']) }));
            } else if (chartType === 'bbands') {
              const ts = avData['Technical Analysis: BBANDS'] as Record<string, Record<string, string>> ?? {};
              return Object.entries(ts).slice(0, 30).reverse().map(([d, v]) => ({
                date: d, value: parseFloat(v['Real Middle Band']), value2: parseFloat(v['Real Upper Band']), value3: parseFloat(v['Real Lower Band']),
              }));
            } else {
              const ts = avData['Time Series (Daily)'] as Record<string, Record<string, string>> ?? {};
              return Object.entries(ts).slice(0, 30).reverse().map(([d, v]) => ({ date: d, value: parseFloat(v['4. close']) }));
            }
          };
          const pts = buildPoints().filter(p => !isNaN(p.value));
          if (pts.length > 0) {
            chartData = { points: pts, label: chartLabel, symbol: detectedSymbol, type: chartType };
            if (chartType === 'earnings') {
              const last = pts[pts.length - 1];
              chartSummaryContext = ` [GRÁFICO JÁ GERADO PELA APP — APARECE ACIMA] Earnings ${detectedSymbol}: último EPS real $${last.value.toFixed(2)} vs estimativa $${(last.value2 ?? 0).toFixed(2)}, surpresa ${(last.value3 ?? 0) > 0 ? '+' : ''}${(last.value3 ?? 0).toFixed(1)}%. Comenta a tendência de beats/misses em português (máx 80 palavras).`;
            } else {
              const last = pts[pts.length - 1];
              chartSummaryContext = ` [GRÁFICO JÁ GERADO PELA APP — APARECE ACIMA] Dados ${chartLabel} ${detectedSymbol}: último valor ${last.value.toFixed(2)} em ${last.date}. Comenta em português (máx 80 palavras). NÃO digas que não podes gerar gráficos.`;
            }
          }
        } catch { /* ignore AV errors */ }
      }

      // Inject comparison data into Groq context
      if (chartComparison) {
        const { tickers, metrics } = chartComparison;
        const fmt = (v: number | null) => v == null ? 'N/A' : `${(v * 100).toFixed(1)}%`;
        chartSummaryContext = ` [GRÁFICO DE COMPARAÇÃO JÁ GERADO — APARECE ACIMA] Dados Alpha Vantage: ${tickers[0]}: Rev Growth ${fmt(metrics[0].values[0])}, EPS Growth ${fmt(metrics[1].values[0])}, Margem ${fmt(metrics[2].values[0])}, ROE ${fmt(metrics[3].values[0])}. ${tickers[1]}: Rev Growth ${fmt(metrics[0].values[1])}, EPS Growth ${fmt(metrics[1].values[1])}, Margem ${fmt(metrics[2].values[1])}, ROE ${fmt(metrics[3].values[1])}. Comenta qual tem melhor performance e porquê em português (máx 100 palavras). NÃO digas que não podes gerar gráficos.`;
      } else if (isCompareRequest && comparisonTickers.length === 2) {
        // AV unavailable — ask Groq to compare from own knowledge
        chartSummaryContext = ` [SEM DADOS TEMPO REAL] Compara ${comparisonTickers[0]} e ${comparisonTickers[1]} com base no teu conhecimento: crescimento de receita, margens, ROE e perspetivas (máx 120 palavras). NÃO digas que não podes gerar gráficos — a app trata disso.`;
      }

      // ── Build system prompt with optional web search ──────────────────────
      const PURE_MATH = /^(quanto (investi|gastei|está|vale|lucrei|perdi)|qual (o |a )?(preço médio|custo médio|total investido|peso|custo total|n[úmeroº]+ de ações)|quantas ações (tenho|comprei))/i;
      let finalSystemPrompt = systemPrompt;
      if (tavilyKey && !PURE_MATH.test(text) && !chartData && !chartComparison) {
        try {
          const PT_TO_EN: [RegExp, string][] = [
            [/\bhoje\b/gi, 'today'], [/\bmercados?\b/gi, 'stock markets'],
            [/\bsob(e|em|iu|er)\b/gi, 'rising'], [/\bcai(u|ram|r)?\b/gi, 'falling'],
            [/\bgu(e|er)rra\b/gi, 'war'], [/\bestreito\b/gi, 'strait'],
            [/\bpetróleo\b/gi, 'oil'], [/\bouro\b/gi, 'gold'],
            [/\binfla[cç][aã]o\b/gi, 'inflation'], [/\bjuros?\b/gi, 'interest rates'],
            [/\bações\b/gi, 'stocks'], [/\bbolsa\b/gi, 'stock exchange'],
            [/\brecupera[cç][aã]o\b/gi, 'recovery'], [/\bcrash\b/gi, 'crash'],
            [/\bnotí?cias?\b/gi, 'news'], [/\beua\b/gi, 'USA'],
            [/\bcesar.?fogo\b/gi, 'ceasefire'], [/\biran\b/gi, 'Iran'],
            [/\bchina\b/gi, 'China'], [/\btarifas?\b/gi, 'tariffs'],
            [/\bimpacto\b/gi, 'impact'], [/\becono[nm]ia\b/gi, 'economy'],
          ];
          const now = new Date();
          const dateTag = `${now.toLocaleString('en-US', { month: 'long' })} ${now.getDate()} ${now.getFullYear()}`;
          let enQuery = text;
          PT_TO_EN.forEach(([re, en]) => { enQuery = enQuery.replace(re, en); });
          enQuery = `${enQuery} ${dateTag}`;
          const breakingQuery = `breaking financial markets news ${dateTag}`;
          const [userContext, breakingContext] = await Promise.all([
            searchTavily(enQuery, tavilyKey).catch(() => ''),
            searchTavily(breakingQuery, tavilyKey).catch(() => ''),
          ]);
          const combined = [userContext, breakingContext].filter(Boolean).join('\n\n---\n\n');
          if (combined) {
            finalSystemPrompt = `${systemPrompt}\n\n===INFORMAÇÃO ATUAL DA WEB (obtida agora, ${dateTag})===\n${combined}\n===FIM===\n\nREGRA ABSOLUTA: Usa a informação acima para responder. Cruza-a com o portfólio do utilizador: que posições são afetadas pelas notícias? Em que direção e magnitude? NUNCA digas que não tens acesso a dados em tempo real — tens a informação acima.`;
          }
        } catch { /* skip */ }
      }

      // When a chart was generated, replace the user question with ONLY the data commentary
      // instruction — so Groq never sees "gera um gráfico" and has no reason to refuse.
      const hasChart = !!(chartData || chartComparison);
      const userContentForApi = hasChart
        ? chartSummaryContext  // pure data commentary instruction, no "gera gráfico"
        : chartSummaryContext ? `${text}${chartSummaryContext}` : text;
      const { data } = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: finalSystemPrompt },
            ...newMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: userContentForApi },
          ],
          max_tokens: hasChart ? 200 : 500,
          temperature: hasChart ? 0.3 : 0.5,
        },
        { timeout: 25000, headers: { Authorization: `Bearer ${groqKey}` } },
      );
      let reply: string = data?.choices?.[0]?.message?.content ?? 'No response.';
      // Strip HTML / refusals when chart is already rendered
      if (reply.includes('<!DOCTYPE') || reply.includes('<!-- CHART -->') ||
          (hasChart && /n[ãa]o posso gerar gr[áa]ficos?/i.test(reply))) {
        reply = chartData
          ? `Gráfico gerado acima — ${chartData.label} ${chartData.symbol}, último valor: ${chartData.points[chartData.points.length - 1]?.value?.toFixed(2)}.`
          : chartComparison
            ? `Comparação ${chartComparison.tickers.join(' vs ')} gerada acima.`
            : 'Dados analisados.';
      }

      const withReply: Message[] = [...newMessages, {
        id: (Date.now() + 1).toString(),
        role: 'assistant' as const,
        content: reply.trim(),
        chart: chartData,
        chartComparison,
      }];
      updateActiveMessages(withReply);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err: any) {
      const status = err?.response?.status;
      const errMsg = status === 401 ? 'Invalid Groq key. Check Settings.'
        : status === 429 ? 'Groq rate limit reached. Try again.'
        : `Error: ${err?.response?.data?.error?.message ?? err?.message ?? 'unknown'}`;
      updateActiveMessages([...newMessages, { id: (Date.now() + 1).toString(), role: 'assistant', content: errMsg }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, activeId, systemPrompt, groqKey, tavilyKey, holdings, updateActiveMessages]);

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAI]}>
        {!isUser && <View style={styles.aiAvatar}><Ionicons name="sparkles" size={12} color="#94a3b8" /></View>}
        <View style={[styles.bubbleInner, isUser ? styles.bubbleInnerUser : styles.bubbleInnerAI, (item.chart || item.chartComparison) ? { padding: 8, width: SCREEN_W - 64 } : {}]}>
          {item.chart && item.chart.type === 'earnings' ? (
              <EarningsChart points={item.chart.points} symbol={item.chart.symbol} />
            ) : item.chart ? (
              <SparkChart points={item.chart.points} label={item.chart.label} symbol={item.chart.symbol} type={item.chart.type} />
            ) : null}
          {item.chartComparison && (
            <ComparisonBarChart tickers={item.chartComparison.tickers} metrics={item.chartComparison.metrics} />
          )}
          <Text style={[styles.bubbleTxt, isUser ? styles.bubbleTxtUser : styles.bubbleTxtAI]}>{item.content}</Text>
        </View>
      </View>
    );
  };

  const suggestions = [
    'Compara Mastercard vs Visa',
    'Gráfico RSI da AAPL',
    'Mostra o MACD da MSFT',
    'Estou bem diversificado?',
  ];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
        ListFooterComponent={
          loading ? (
            <View style={styles.typingRow}>
              <View style={styles.aiAvatar}><Ionicons name="sparkles" size={12} color="#94a3b8" /></View>
              <View style={styles.typingBubble}><ActivityIndicator size="small" color="#94a3b8" /></View>
            </View>
          ) : messages.length <= 1 ? (
            <View style={styles.suggestionsWrap}>
              {suggestions.map((s) => (
                <TouchableOpacity key={s} style={styles.suggestionBtn} onPress={() => setInput(s)}>
                  <Text style={styles.suggestionTxt}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null
        }
      />

      <View style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 60) }]}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Pergunta sobre o teu portfólio…"
          placeholderTextColor="#475569"
          multiline
          maxLength={500}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
          onPress={sendMessage}
          disabled={!input.trim() || loading}
        >
          <Ionicons name="send" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* History modal */}
      <Modal visible={historyOpen} transparent animationType="slide" onRequestClose={() => setHistoryOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setHistoryOpen(false)}>
          <Pressable style={styles.historyPanel} onPress={() => {}}>
            <View style={styles.historyHeader}>
              <Text style={styles.historyTitle}>Conversas</Text>
              <TouchableOpacity onPress={startNewChat} style={styles.newChatBtn}>
                <Ionicons name="create-outline" size={16} color="#94a3b8" />
                <Text style={styles.newChatTxt}>Nova</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={conversations}
              keyExtractor={(c) => c.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.convRow, item.id === activeId && styles.convRowActive]}
                  onPress={() => openConversation(item.id)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.convTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.convDate}>{formatDate(item.createdAt)}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => deleteConversation(item.id)}
                    hitSlop={8}
                    style={{ padding: 4 }}
                  >
                    <Ionicons name="trash-outline" size={16} color="#475569" />
                  </TouchableOpacity>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.emptyTxt}>Sem conversas guardadas.</Text>}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  list: { padding: 16, paddingBottom: 8 },
  bubble: { marginBottom: 12 },
  bubbleUser: { alignItems: 'flex-end' },
  bubbleAI: { alignItems: 'flex-start', flexDirection: 'row', gap: 8 },
  aiAvatar: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155',
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  bubbleInner: { maxWidth: '82%', borderRadius: 16, padding: 12 },
  bubbleInnerUser: { backgroundColor: '#6366f1', borderBottomRightRadius: 4 },
  bubbleInnerAI: { backgroundColor: '#1e293b', borderBottomLeftRadius: 4 },
  bubbleTxt: { fontSize: 15, lineHeight: 22 },
  bubbleTxtUser: { color: '#fff' },
  bubbleTxtAI: { color: '#e2e8f0' },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  typingBubble: { backgroundColor: '#1e293b', borderRadius: 16, borderBottomLeftRadius: 4, padding: 12, minWidth: 56, alignItems: 'center' },
  suggestionsWrap: { marginTop: 8, gap: 8 },
  suggestionBtn: { backgroundColor: '#1e293b', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#334155' },
  suggestionTxt: { color: '#94a3b8', fontSize: 14 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: '#1e293b', backgroundColor: '#0f0f0f' },
  input: { flex: 1, backgroundColor: '#1e293b', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: '#f1f5f9', fontSize: 15, maxHeight: 120, borderWidth: 1, borderColor: '#334155' },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: '#334155' },

  // History modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  historyPanel: { backgroundColor: '#0f0f0f', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%', paddingBottom: 32 },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  historyTitle: { color: '#f8fafc', fontSize: 17, fontWeight: '700' },
  newChatBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1e293b', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#334155' },
  newChatTxt: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  convRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  convRowActive: { backgroundColor: '#1e293b' },
  convTitle: { color: '#f1f5f9', fontSize: 15, fontWeight: '500' },
  convDate: { color: '#475569', fontSize: 12, marginTop: 2 },
  emptyTxt: { color: '#475569', textAlign: 'center', padding: 24 },
});
