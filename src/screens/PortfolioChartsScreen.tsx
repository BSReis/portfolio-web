import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Dimensions, ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { usePortfolio } from '../context/PortfolioContext';
import { useSettings } from '../context/SettingsContext';
import Svg, { Path, Text as SvgText, G } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { getStockQuote, getDividends, getStockMeta, getEtfSectorWeightsYahoo, getEquitySectorYahoo, StockQuote, Dividend, effectivePrice } from '../services/api';
import { BlurValue } from '../utils/blurValue';
import { fmtNum } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'PortfolioCharts'>;

const { width: W } = Dimensions.get('window');

const PAGE_BG = '#111417';
const SURFACE = '#1b2023';
const SURFACE_ALT = '#23282d';
const BORDER = '#303841';
const TEXT_MUTED = '#8f99aa';
const TEXT_SECONDARY = '#c3cad5';
const TEXT_PRIMARY = '#f5f7fa';

function squarifiedLayout(
  items: Array<{ pct: number }>,
  containerW: number,
  containerH: number,
): Array<{ x: number; y: number; w: number; h: number }> {
  const results: Array<{ x: number; y: number; w: number; h: number }> = [];
  function layout(idxs: number[], x: number, y: number, w: number, h: number, totalPct: number) {
    if (idxs.length === 0) return;
    if (idxs.length === 1) {
      results[idxs[0]] = { x, y, w, h };
      return;
    }
    const isWide = w >= h;
    let best: number[] = [];
    let bestRatio = Infinity;
    for (let i = 0; i < idxs.length; i++) {
      const group = idxs.slice(0, i + 1);
      const groupPct = group.reduce((s, idx) => s + items[idx].pct, 0);
      const stripFrac = groupPct / totalPct;
      const strip = isWide ? stripFrac * w : stripFrac * h;
      const across = isWide ? h : w;
      let maxR = 0;
      for (const idx of group) {
        const sliceFrac = items[idx].pct / groupPct;
        const sliceSize = sliceFrac * across;
        const r = strip > 0 && sliceSize > 0 ? Math.max(strip / sliceSize, sliceSize / strip) : Infinity;
        if (r > maxR) maxR = r;
      }
      if (maxR <= bestRatio) { bestRatio = maxR; best = group; } else break;
    }
    const groupPct = best.reduce((s, idx) => s + items[idx].pct, 0);
    const stripFrac = groupPct / totalPct;
    if (isWide) {
      const stripW = stripFrac * w;
      let curY = y;
      for (const idx of best) {
        const itemH = (items[idx].pct / groupPct) * h;
        results[idx] = { x, y: curY, w: stripW, h: itemH };
        curY += itemH;
      }
      layout(idxs.slice(best.length), x + stripW, y, w - stripW, h, totalPct - groupPct);
    } else {
      const stripH = stripFrac * h;
      let curX = x;
      for (const idx of best) {
        const itemW = (items[idx].pct / groupPct) * w;
        results[idx] = { x: curX, y, w: itemW, h: stripH };
        curX += itemW;
      }
      layout(idxs.slice(best.length), x, y + stripH, w, h - stripH, totalPct - groupPct);
    }
  }
  const totalPct = items.reduce((s, i) => s + i.pct, 0);
  layout(items.map((_, i) => i), 0, 0, containerW, containerH, totalPct);
  return results;
}

export default function PortfolioChartsScreen({ navigation }: Props) {
  const { holdings } = usePortfolio();
  const { currency, getRateFor, hideValues, setHideValues, applyDividendTax } = useSettings();
  const currencySymbol = currency === 'EUR' ? '€' : '$';

  const [quotes, setQuotes] = useState<Record<string, StockQuote | null>>({});
  const [annualDivs, setAnnualDivs] = useState<Record<string, number>>({});
  const [rawDivs, setRawDivs] = useState<Record<string, Dividend[]>>({});
  const [stockMeta, setStockMeta] = useState<Record<string, { cap: number | null; sector: string | null }>>({}); 
  const [etfSectors, setEtfSectors] = useState<Record<string, { sector: string; weight: number }[]>>({});
  const [loading, setLoading] = useState(true);
  const [donutMode, setDonutMode] = useState<'holdings' | 'sectors'>('holdings');
  const [selectedSlice, setSelectedSlice] = useState<number | null>(null);
  const marketRateFor = (symbol: string, fallbackCurrency?: string) => getRateFor(quotes[symbol]?.currency ?? fallbackCurrency ?? 'USD');

  useEffect(() => {
    if (holdings.length === 0) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      Promise.all(holdings.map(async (h) => {
        const q = await getStockQuote(h.symbol).catch(() => null);
        return { symbol: h.symbol, q };
      })),
      Promise.all(holdings.map(async (h) => {
        const divs = await getDividends(h.symbol).catch(() => [] as Dividend[]);
        const oneYearAgo = Date.now() / 1000 - 365 * 86400;
        const annual = divs
          .filter((d) => d.date >= oneYearAgo)
          .reduce((s, d) => s + applyDividendTax(d.amount), 0);
        return { symbol: h.symbol, annual: annual * h.shares * getRateFor(h.currency ?? 'USD'), divs };
      })),
      Promise.all(holdings.map(async (h) => {
        const meta = await getStockMeta(h.symbol).catch(() => ({ cap: null, sector: null }));
        return { symbol: h.symbol, meta };
      })),
      Promise.all(holdings.map(async (h) => {
        const weights = await getEtfSectorWeightsYahoo(h.symbol).catch(() => [] as { sector: string; weight: number }[]);
        return { symbol: h.symbol, weights };
      })),
    ]).then(async ([qResults, divResults, metaResults, etfResults]) => {
      const qMap: Record<string, StockQuote | null> = {};
      qResults.forEach(({ symbol, q }) => (qMap[symbol] = q));
      setQuotes(qMap);
      const dMap: Record<string, number> = {};
      const rawMap: Record<string, Dividend[]> = {};
      divResults.forEach(({ symbol, annual, divs }) => {
        dMap[symbol] = annual;
        rawMap[symbol] = divs;
      });
      setAnnualDivs(dMap);
      setRawDivs(rawMap);
      const etfMap: Record<string, { sector: string; weight: number }[]> = {};
      etfResults.forEach(({ symbol, weights }) => { if (weights.length > 0) etfMap[symbol] = weights; });
      setEtfSectors(etfMap);

      // Build initial metaMap from Finnhub results
      const metaMap: Record<string, { cap: number | null; sector: string | null }> = {};
      metaResults.forEach(({ symbol, meta }) => (metaMap[symbol] = meta));

      // Sequential Yahoo sector fallback — only for equities missing a sector.
      // Done sequentially (not in parallel) to avoid Yahoo rate limits.
      for (const { symbol, meta } of metaResults) {
        const isEtf = qMap[symbol]?.quoteType === 'ETF' || !!etfMap[symbol]?.length;
        if (!meta.sector && !isEtf) {
          const yahoSector = await getEquitySectorYahoo(symbol).catch(() => null);
          if (yahoSector) metaMap[symbol] = { ...meta, sector: yahoSector };
          // Small delay between sequential Yahoo requests to avoid rate limiting
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      setStockMeta(metaMap);
    }).finally(() => setLoading(false));
  }, [holdings, getRateFor, applyDividendTax]);

  // ---- Cálculos ----
  const totalValue = holdings.reduce((sum, h) => {
    const quote = quotes[h.symbol];
    const price = (quote ? effectivePrice(quote) : h.avgPrice) * marketRateFor(h.symbol, h.currency);
    return sum + price * h.shares;
  }, 0);
  const totalCost = holdings.reduce((sum, h) => sum + h.avgPrice * getRateFor(h.currency ?? 'USD') * h.shares, 0);
  const totalReturn = totalValue - totalCost;
  const totalReturnPct = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0;
  const isPositive = totalReturn >= 0;

  const totalAnnualDiv = Object.values(annualDivs).reduce((s, v) => s + v, 0);
  const dividendYield = totalValue > 0 ? (totalAnnualDiv / totalValue) * 100 : 0;
  const yieldOnCost = totalCost > 0 ? (totalAnnualDiv / totalCost) * 100 : 0;
  const monthlyIncome = totalAnnualDiv / 12;

  const fmt = (v: number) => {
    const [int, dec] = Math.abs(v).toFixed(2).split('.');
    const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${v < 0 ? '-' : ''}${intFmt},${dec} ${currencySymbol}`;
  };

  // ---- Cores por símbolo ----
  const COLORS = ['#3b82f6','#14b8a6','#f59e0b','#f97316','#8b5cf6','#ec4899','#22c55e','#ef4444','#06b6d4','#a78bfa','#84cc16','#fb923c'];
  const symbolColor = (idx: number) => COLORS[idx % COLORS.length];

  // ---- Distribuição de dividendos por ação (barra horizontal stacked) ----
  const divAlloc = holdings
    .map((h, i) => ({ symbol: h.symbol, amount: annualDivs[h.symbol] ?? 0, color: symbolColor(i) }))
    .sort((a, b) => b.amount - a.amount);
  const totalDivAlloc = divAlloc.reduce((s, d) => s + d.amount, 0);

  // ---- Rendimento mensal (calendário Jan-Dez) ----
  // Agrupa os últimos 12 meses de dividendos por mês do calendário (0=Jan … 11=Dez)
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const calMonthTotals = new Array(12).fill(0) as number[];
  const ttmCutoff = Date.now() / 1000 - 365 * 86400;
  holdings.forEach((h) => {
    const divs = rawDivs[h.symbol] ?? [];
    const rate = getRateFor(h.currency ?? 'USD');
    divs.filter((d) => d.date >= ttmCutoff && d.date <= Date.now() / 1000).forEach((d) => {
      const m = new Date(d.date * 1000).getMonth();
      calMonthTotals[m] += applyDividendTax(d.amount) * h.shares * rate;
    });
  });
  const maxCalMonth = Math.max(...calMonthTotals, 1);

  // ---- Sector abbreviation ----
  const sectorAbr = (s: string | null): string => {
    if (!s) return 'OTH';
    const l = s.toLowerCase();
    if (l.includes('tech') || l.includes('software') || l.includes('semiconductor') || l === 'technology') return 'TEC';
    if (l.includes('communic') || l.includes('media') || l.includes('telecom') || l.includes('internet')) return 'COM';
    if (l.includes('financ') || l.includes('bank') || l.includes('insur') || l.includes('asset')) return 'FIN';
    if (l.includes('health') || l.includes('pharma') || l.includes('biotech') || l.includes('medical')) return 'HEA';
    if (l.includes('consumer') && (l.includes('cycl') || l.includes('discret') || l.includes('retail'))) return 'CON';
    if (l.includes('consumer') || l.includes('food') || l.includes('beverag') || l.includes('staple') || l.includes('defensive')) return 'DEF';
    if (l.includes('energy') || l.includes('oil') || l.includes('gas')) return 'ENE';
    if (l.includes('industri') || l.includes('manufactur') || l.includes('aerospace')) return 'IND';
    if (l.includes('utilit')) return 'UTI';
    if (l.includes('real estate') || l.includes('reit')) return 'REA';
    if (l.includes('material') || l.includes('chemical') || l.includes('mining') || l === 'basic materials') return 'BAS';
    if (l.includes('etf') || l.includes('fund') || l.includes('trust')) return 'ETF';
    return s.slice(0, 3).toUpperCase();
  };

  // ---- Sector allocation ----
  const sectorMap: Record<string, number> = {};
  // Note: populated after holdingAlloc below

  // ---- Alocação (treemap) ----
  const holdingAlloc = holdings.map((h) => {
    const quote = quotes[h.symbol];
    const val = (quote ? effectivePrice(quote) : h.avgPrice) * marketRateFor(h.symbol, h.currency) * h.shares;
    const pct = totalValue > 0 ? val / totalValue : 0;
    const holdingReturn = quotes[h.symbol]
      ? (effectivePrice(quotes[h.symbol]!) - h.avgPrice) / h.avgPrice
      : 0;
    return { symbol: h.symbol, val, pct, holdingReturn };
  }).sort((a, b) => b.pct - a.pct);

  // ---- Build sector allocation from holdingAlloc ----
  holdingAlloc.forEach((item) => {
    const etfWeights = etfSectors[item.symbol];
    const isEtf = quotes[item.symbol]?.quoteType === 'ETF' || !!etfWeights?.length;
    if (etfWeights?.length) {
      // Decompose ETF into its underlying sector weights
      etfWeights.forEach(({ sector, weight }) => {
        const abr = sectorAbr(sector);
        sectorMap[abr] = (sectorMap[abr] ?? 0) + item.val * weight;
      });
    } else if (isEtf) {
      // Confirmed ETF but no sector data available
      sectorMap['ETF'] = (sectorMap['ETF'] ?? 0) + item.val;
    } else {
      const rawSector = stockMeta[item.symbol]?.sector ?? null;
      const abr = sectorAbr(rawSector);
      sectorMap[abr] = (sectorMap[abr] ?? 0) + item.val;
    }
  });
  const sectorAlloc = Object.entries(sectorMap)
    .map(([sector, val]) => ({ sector, val, pct: totalValue > 0 ? val / totalValue : 0 }))
    .sort((a, b) => b.pct - a.pct);

  // ---- Donut chart renderer ----
  const donutSize = W - 32;
  const DCX = donutSize / 2;
  const DCY = donutSize / 2;
  const OUTER_R = donutSize * 0.41;
  const INNER_R = donutSize * 0.265;
  const POP_OFFSET = 10; // px outward when a slice is selected
  const renderDonut = (
    items: Array<{ label: string; pct: number; color: string; value: number }>,
    centerLabel: string,
    centerValue: number,
    centerGain: number,
    centerReturnPct: number,
    gainPositive: boolean,
  ) => {
    const sel = selectedSlice !== null && selectedSlice < items.length ? selectedSlice : null;
    let ang = -Math.PI / 2;
    // Pre-compute angles so we can use them for both path and hit-test
    const slices = items.map((item) => {
      const sa = ang;
      const sweep = item.pct * 2 * Math.PI;
      ang = sa + sweep;
      const mid = sa + sweep / 2;
      return { ...item, sa, ea: sa + sweep, sweep, mid };
    });
    const selItem = sel !== null ? slices[sel] : null;
    const handleDonutTouch = (locationX: number, locationY: number) => {
      const dx = locationX - DCX;
      const dy = locationY - DCY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < INNER_R || dist > OUTER_R + POP_OFFSET + 6) {
        setSelectedSlice(null);
        return;
      }
      let angle = Math.atan2(dy, dx) - (-Math.PI / 2);
      if (angle < 0) angle += 2 * Math.PI;
      let cumAngle = 0;
      for (let i = 0; i < slices.length; i++) {
        cumAngle += slices[i].pct * 2 * Math.PI;
        if (angle <= cumAngle + 0.0001) {
          setSelectedSlice((prev) => (prev === i ? null : i));
          return;
        }
      }
      setSelectedSlice(null);
    };
    return (
      <View style={{ alignItems: 'center', marginHorizontal: -20 }}>
      <View
        style={{ width: donutSize, height: donutSize }}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => handleDonutTouch(e.nativeEvent.locationX, e.nativeEvent.locationY)}
      >
      <Svg width={donutSize} height={donutSize}>
        {slices.map((item, i) => {
          const { sa, ea, sweep, mid } = item;
          const lR = (OUTER_R + INNER_R) / 2;
          const lx = DCX + lR * Math.cos(mid);
          const ly = DCY + lR * Math.sin(mid);
          const large = sweep > Math.PI ? 1 : 0;
          const isSelected = sel === i;
          const dx = isSelected ? POP_OFFSET * Math.cos(mid) : 0;
          const dy = isSelected ? POP_OFFSET * Math.sin(mid) : 0;
          const r = isSelected ? OUTER_R + 4 : OUTER_R;
          const d = [
            `M${DCX + dx + r * Math.cos(sa)},${DCY + dy + r * Math.sin(sa)}`,
            `A${r},${r},0,${large},1,${DCX + dx + r * Math.cos(ea)},${DCY + dy + r * Math.sin(ea)}`,
            `L${DCX + dx + INNER_R * Math.cos(ea)},${DCY + dy + INNER_R * Math.sin(ea)}`,
            `A${INNER_R},${INNER_R},0,${large},0,${DCX + dx + INNER_R * Math.cos(sa)},${DCY + dy + INNER_R * Math.sin(sa)}`,
            'Z',
          ].join(' ');
          return (
            <G key={i}>
              <Path d={d} fill={item.color} />
              {!isSelected && item.pct >= 0.04 && (
                <>
                  <SvgText x={lx} y={ly - 7} textAnchor="middle" fill="#fff" fontSize={item.pct >= 0.08 ? 12 : 9} fontWeight="bold">{item.label}</SvgText>
                  <SvgText x={lx} y={ly + 7} textAnchor="middle" fill="#fff" fontSize={item.pct >= 0.08 ? 11 : 9}>{(item.pct * 100).toFixed(0)}%</SvgText>
                </>
              )}
              {!isSelected && item.pct >= 0.018 && item.pct < 0.04 && (
                <SvgText x={lx} y={ly + 4} textAnchor="middle" fill="#fff" fontSize={7}>{item.label} {(item.pct * 100).toFixed(0)}%</SvgText>
              )}
            </G>
          );
        })}
      </Svg>
      {/* RN overlay for sensitive center values — pointerEvents none passes touches to SVG handler */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]}>
        {selItem ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: selItem.color, fontSize: 14, fontWeight: 'bold', textAlign: 'center' }}>{selItem.label}</Text>
            <BlurValue hidden={hideValues} style={{ alignSelf: 'center' }}>
              <Text style={{ color: TEXT_PRIMARY, fontSize: 16, fontWeight: 'bold' }}>
                {fmtNum(selItem.value)}{currencySymbol}
              </Text>
            </BlurValue>
            <Text style={{ color: TEXT_MUTED, fontSize: 13, textAlign: 'center' }}>{(selItem.pct * 100).toFixed(1)}%</Text>
          </View>
        ) : (
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 13 }}>{centerLabel}</Text>
            <BlurValue hidden={hideValues} style={{ alignSelf: 'center' }}>
              <Text style={{ color: TEXT_PRIMARY, fontSize: 17, fontWeight: 'bold' }}>
                {fmtNum(centerValue)}{currencySymbol}
              </Text>
            </BlurValue>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ color: gainPositive ? '#22c55e' : '#ef4444', fontSize: 13, fontWeight: '600' }}>
                {gainPositive ? '▲' : '▼'}{' '}
              </Text>
              <BlurValue hidden={hideValues} tint={gainPositive ? 'green' : 'red'}>
                <Text style={{ color: gainPositive ? '#22c55e' : '#ef4444', fontSize: 13, fontWeight: '600' }}>
                  {fmtNum(Math.abs(centerGain))}{currencySymbol}
                </Text>
              </BlurValue>
              <Text style={{ color: gainPositive ? '#22c55e' : '#ef4444', fontSize: 13, fontWeight: '600' }}>
                {' '}({centerReturnPct.toFixed(2)}%)
              </Text>
            </View>
          </View>
        )}
      </View>
      </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

      {/* Card principal */}
      <View style={styles.mainCard}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <BlurValue hidden={hideValues} style={{ alignSelf: 'flex-start' }}>
              <Text style={styles.mainValue}>{fmtNum(totalValue)}{currencySymbol}</Text>
            </BlurValue>
          </View>
          <TouchableOpacity onPress={() => setHideValues(!hideValues)} style={styles.hideBtn} hitSlop={8}>
            <Ionicons name={hideValues ? 'eye-off-outline' : 'eye-outline'} size={20} color={TEXT_MUTED} />
          </TouchableOpacity>
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricCol}>
            <Text style={styles.metricLabel}>Investimento</Text>
            <BlurValue hidden={hideValues} style={{ alignSelf: 'flex-start' }}>
              <Text style={[styles.metricValue, { color: '#6366f1' }]}>{fmt(totalCost)}</Text>
            </BlurValue>
            <Text style={styles.metricSub}>{holdings.length} Ativo{holdings.length !== 1 ? 's' : ''}</Text>
          </View>
          <View style={[styles.metricCol, { alignItems: 'flex-end' }]}>
            <Text style={styles.metricLabel}>Retorno</Text>
            <Text style={[styles.metricValue, { color: isPositive ? '#22c55e' : '#ef4444' }]}>
              {isPositive ? '▲' : '▼'}{" "}
            </Text>
            <BlurValue hidden={hideValues} style={{ alignSelf: 'flex-end' }}>
              <Text style={[styles.metricValue, { color: isPositive ? '#22c55e' : '#ef4444' }]}>
                {fmt(Math.abs(totalReturn))}
              </Text>
            </BlurValue>
            <Text style={[styles.metricSub, { color: isPositive ? '#22c55e' : '#ef4444' }]}>
              ({isPositive ? '+' : ''}{totalReturnPct.toFixed(2)}%)
            </Text>
          </View>
        </View>
      </View>

      {/* Dividend Yield / Yield on Cost */}
      <View style={styles.row2}>
        <View style={styles.smallCard}>
          <Text style={styles.smallLabel}>Dividend Yield</Text>
          <Text style={styles.smallValue}>{dividendYield.toFixed(2)}%</Text>
        </View>
        <View style={styles.smallCard}>
          <Text style={styles.smallLabel}>Yield on Cost</Text>
          <Text style={styles.smallValue}>{yieldOnCost.toFixed(2)}%</Text>
        </View>
      </View>

      {/* Rendimento Mensal / Anual */}
      <View style={styles.row2}>
        <View style={styles.smallCard}>
          <Text style={styles.smallLabel}>Monthly Income</Text>
          <Text style={styles.smallValue}>{fmt(monthlyIncome)}</Text>
        </View>
        <View style={styles.smallCard}>
          <Text style={styles.smallLabel}>Annual Income</Text>
          <Text style={styles.smallValue}>{fmt(totalAnnualDiv)}</Text>
        </View>
      </View>

      {/* === Estrutura do Portfólio / Sectores === */}
      <View style={styles.dashCard}>
        <Text style={styles.dashTitle}>
          {donutMode === 'holdings' ? 'Portfolio Structure' : 'Invested Sectors'}
        </Text>
        <Text style={styles.dashSub}>
          {donutMode === 'holdings' ? 'by stock weight' : 'by sector weight'}
        </Text>
        {/* Toggle pills */}
        <View style={styles.toggleRow}>
          <TouchableOpacity
            onPress={() => { setDonutMode('holdings'); setSelectedSlice(null); }}
            style={[styles.toggleBtn, donutMode === 'holdings' && styles.toggleBtnActive]}
          >
            <Text style={[styles.toggleLabel, donutMode === 'holdings' && styles.toggleLabelActive]}>Stocks</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setDonutMode('sectors'); setSelectedSlice(null); }}
            style={[styles.toggleBtn, donutMode === 'sectors' && styles.toggleBtnActive]}
          >
            <Text style={[styles.toggleLabel, donutMode === 'sectors' && styles.toggleLabelActive]}>Sectors</Text>
          </TouchableOpacity>
        </View>
        {donutMode === 'holdings'
          ? renderDonut(
              holdingAlloc.map((item, i) => ({ label: item.symbol, pct: item.pct, color: COLORS[i % COLORS.length], value: item.val })),
              currency === 'EUR' ? 'euro' : 'dollar',
              totalValue,
              totalReturn,
              totalReturnPct,
              isPositive,
            )
          : renderDonut(
              sectorAlloc.map((item, i) => ({ label: item.sector, pct: item.pct, color: COLORS[i % COLORS.length], value: item.val })),
              currency === 'EUR' ? 'euro' : 'dollar',
              totalValue,
              totalReturn,
              totalReturnPct,
              isPositive,
            )
        }
      </View>

      {/* Alocação de Ativos (heatmap treemap) */}
      <Text style={styles.sectionTitle}>Asset Allocation</Text>
      {(() => {
        const cW = W - 32;
        const cH = Math.max(cW * 0.72, 200);
        const GAP = 3;
        const layout = squarifiedLayout(holdingAlloc, cW, cH);
        return (
          <View style={{ width: cW, height: cH, marginBottom: 24, position: 'relative' }}>
            {holdingAlloc.map((item, i) => {
              const pos = item.holdingReturn >= 0;
              const intensity = Math.min(Math.abs(item.holdingReturn) * 3, 1);
              const bgColor = pos
                ? `rgba(34,197,94,${0.25 + intensity * 0.55})`
                : `rgba(239,68,68,${0.25 + intensity * 0.55})`;
              const rect = layout[i];
              if (!rect) return null;
              const boxW = rect.w - GAP;
              const boxH = rect.h - GAP;
              const showLabel = boxW > 36 && boxH > 28;
              const showPct = boxW > 44 && boxH > 48;
              const showReturn = boxW > 44 && boxH > 66;
              return (
                <View
                  key={item.symbol}
                  style={[
                    styles.treemapBox,
                    {
                      position: 'absolute',
                      left: rect.x,
                      top: rect.y,
                      width: boxW,
                      height: boxH,
                      backgroundColor: bgColor,
                      justifyContent: 'center',
                      alignItems: 'center',
                    },
                  ]}
                >
                  {showLabel && <Text style={[styles.treemapSymbol, { fontSize: boxW > 70 ? 13 : 10 }]}>{item.symbol}</Text>}
                  {showPct && <Text style={styles.treemapPct}>{(item.pct * 100).toFixed(1)}%</Text>}
                  {showReturn && (
                    <Text style={[styles.treemapReturn, { color: pos ? '#bbf7d0' : '#fecaca' }]}>
                      {pos ? '+' : ''}{(item.holdingReturn * 100).toFixed(1)}%
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        );
      })()}

            {/* === Alocação do Portfólio === */}
      <View style={styles.dashCard}>
        <View>
          <Text style={styles.dashTitle}>Portfolio Allocation</Text>
          <Text style={styles.dashSub}>by position weight</Text>
        </View>
        {/* Barra horizontal stacked */}
        <View style={{ flexDirection: 'row', height: 32, borderRadius: 8, overflow: 'hidden', marginVertical: 16 }}>
          {holdingAlloc.map((item, i) => (
            <View key={item.symbol} style={{ flex: item.pct, backgroundColor: COLORS[i % COLORS.length] }} />
          ))}
        </View>
        {/* Legenda 2 colunas */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {holdingAlloc.map((item, i) => (
            <View key={item.symbol} style={{ width: '50%', flexDirection: 'row', alignItems: 'center', marginBottom: 10, paddingRight: i % 2 === 0 ? 8 : 0, paddingLeft: i % 2 === 1 ? 8 : 0 }}>
              <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: COLORS[i % COLORS.length], marginRight: 6 }} />
              <Text style={styles.dashSymbol}>{item.symbol}</Text>
              <Text style={styles.dashPct}>{(item.pct * 100).toFixed(2)}%</Text>
            </View>
          ))}
        </View>
      </View>

      {/* === Distribuição de Dividendos por pagamento anual === */}
      {totalDivAlloc > 0 && <View style={styles.dashCard}>
        <Text style={styles.dashTitle}>Dividend Distribution</Text>
        <Text style={styles.dashSub}>by annual payout</Text>
        <View style={{ flexDirection: 'row', height: 32, borderRadius: 8, overflow: 'hidden', marginVertical: 16 }}>
          {divAlloc.filter(d => d.amount > 0).map((d) => (
            <View key={d.symbol} style={{ flex: d.amount / totalDivAlloc, backgroundColor: d.color }} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {divAlloc.map((d, i) => (
            <View key={d.symbol} style={{ width: '50%', flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingRight: i % 2 === 0 ? 8 : 0, paddingLeft: i % 2 === 1 ? 8 : 0 }}>
              <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: d.color, marginRight: 6 }} />
              <Text style={{ color: TEXT_PRIMARY, fontWeight: '600', fontSize: 13, width: 52 }}>{d.symbol}</Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 13, flex: 1, textAlign: 'right' }}>
                {totalDivAlloc > 0 ? ((d.amount / totalDivAlloc) * 100).toFixed(2) : '0.00'}%
              </Text>
            </View>
          ))}
        </View>
      </View>}

      {/* === Distribuição de Dividendos por rendimento mensal === */}
      {totalAnnualDiv > 0 && <View style={styles.dashCard}>
        <Text style={styles.dashTitle}>Dividend Distribution</Text>
        <Text style={styles.dashSub}>by calendar month (last 12 months)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 16 }}>
          <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 4 }}>
            {calMonthTotals.map((val, i) => {
              const BAR_MAX = 100;
              const barH = Math.max((val / maxCalMonth) * BAR_MAX, val > 0 ? 4 : 0);
              const isCurrentMonth = i === new Date().getMonth();
              return (
                <View key={i} style={{ alignItems: 'center', width: 44 }}>
                  {/* valor em cima */}
                  <Text style={{ color: val > 0 ? TEXT_MUTED : 'transparent', fontSize: 9, marginBottom: 3, height: 13 }}>
                    {val > 0 ? `${currencySymbol}${val.toFixed(0)}` : ' '}
                  </Text>
                  {/* área do gráfico: fundo cinza + barra colorida a crescer de baixo */}
                  <View style={{ width: 34, height: BAR_MAX, backgroundColor: SURFACE_ALT, borderRadius: 6, justifyContent: 'flex-end', overflow: 'hidden' }}>
                    <View style={{ width: 34, height: barH, backgroundColor: isCurrentMonth ? '#818cf8' : '#3b82f6', borderRadius: 6 }} />
                  </View>
                  {/* label do mês */}
                  <Text style={{ color: isCurrentMonth ? TEXT_PRIMARY : TEXT_MUTED, fontSize: 10, marginTop: 5, fontWeight: isCurrentMonth ? '700' : '400' }}>
                    {MONTH_NAMES[i]}
                  </Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: PAGE_BG },
  mainCard: {
    backgroundColor: SURFACE, borderRadius: 16, padding: 20, marginBottom: 12,
  },
  mainValue: { color: TEXT_PRIMARY, fontSize: 32, fontWeight: 'bold', letterSpacing: -1 },
  hideBtn: { padding: 4 },
  metricsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  metricCol: { flex: 1 },
  metricLabel: { color: TEXT_MUTED, fontSize: 13, marginBottom: 4 },
  metricValue: { fontSize: 17, fontWeight: '700' },
  metricSub: { color: TEXT_MUTED, fontSize: 12, marginTop: 2 },
  row2: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  smallCard: {
    flex: 1, backgroundColor: SURFACE, borderRadius: 14, padding: 16,
  },
  smallLabel: { color: TEXT_MUTED, fontSize: 13, marginBottom: 6 },
  smallValue: { color: TEXT_PRIMARY, fontSize: 18, fontWeight: '700' },
  sectionTitle: { color: TEXT_PRIMARY, fontSize: 17, fontWeight: 'bold', marginBottom: 4, marginTop: 8 },
  sectionSub: { color: TEXT_MUTED, fontSize: 13, marginBottom: 12 },
  treemapBox: {
    borderRadius: 8, padding: 6,
  },
  treemapSymbol: { color: '#fff', fontWeight: '800', fontSize: 13 },
  treemapPct: { color: '#fff', fontSize: 12, marginTop: 2, opacity: 0.85 },
  treemapReturn: { fontSize: 11, marginTop: 2, fontWeight: '600' },
  dashCard: {
    backgroundColor: SURFACE, borderRadius: 16, padding: 20, marginBottom: 14,
  },
  dashTitle: { color: TEXT_PRIMARY, fontSize: 17, fontWeight: '700', marginBottom: 2 },
  dashSub: { color: TEXT_MUTED, fontSize: 13 },
  dashSymbol: { color: TEXT_PRIMARY, fontWeight: '600', fontSize: 13, width: 54 },
  dashPct: { color: TEXT_MUTED, fontSize: 13, flex: 1, textAlign: 'right' as const },  
  toggleRow: {
    flexDirection: 'row', backgroundColor: SURFACE_ALT, borderRadius: 10,
    marginTop: 12, marginBottom: 4, padding: 3, alignSelf: 'flex-start',
  },
  toggleBtn: {
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8,
  },
  toggleBtnActive: {
    backgroundColor: '#6366f1',
  },
  toggleLabel: { color: TEXT_MUTED, fontSize: 13, fontWeight: '600' },
  toggleLabelActive: { color: '#fff' },
});
