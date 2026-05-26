import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  RefreshControl, TouchableOpacity, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle as SvgCircle, Line as SvgLine, Path as SvgPath, Text as SvgText, TSpan } from 'react-native-svg';
import { getHistoricalData, HistoricalData } from '../services/api';
import InteractiveChart from '../components/InteractiveChart';

const PERIODS = ['1W', '1M', '3M', '1Y', '5Y'] as const;
type Period = typeof PERIODS[number];
type ViewMode = 'overview' | 'timeline';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const RANGE_MAP: Record<Period, { range: string; interval: string }> = {
  '1W': { range: '5d',  interval: '1h' },
  '1M': { range: '1mo', interval: '1d' },
  '3M': { range: '3mo', interval: '1d' },
  '1Y': { range: '1y',  interval: '1wk' },
  '5Y': { range: '5y',  interval: '1wk' },
};

const scoreZones = [
  { min: 0, max: 20, label: 'Extreme Fear', color: '#b91c1c', bg: '#450a0a' },
  { min: 21, max: 40, label: 'Fear', color: '#ef4444', bg: '#7f1d1d' },
  { min: 41, max: 60, label: 'Neutral', color: '#f59e0b', bg: '#78350f' },
  { min: 61, max: 75, label: 'Greed', color: '#22c55e', bg: '#166534' },
  { min: 76, max: 100, label: 'Extreme Greed', color: '#16a34a', bg: '#14532d' },
] as const;

function getScoreZone(score: number) {
  return scoreZones.find((zone) => score >= zone.min && score <= zone.max) ?? scoreZones[scoreZones.length - 1];
}

const GAUGE_MAX = 50;
const GAUGE_SEGMENTS = [
  { start: 0, end: 10, label: ['EXTREME', 'FEAR'], color: '#b91c1c' },
  { start: 10, end: 20, label: ['FEAR'], color: '#ef4444' },
  { start: 20, end: 30, label: ['NEUTRAL'], color: '#f59e0b' },
  { start: 30, end: 38, label: ['GREED'], color: '#22c55e' },
  { start: 38, end: GAUGE_MAX, label: ['EXTREME', 'GREED'], color: '#16a34a' },
] as const;

function clampGaugeValue(value: number) {
  return Math.max(0, Math.min(GAUGE_MAX, value));
}

function gaugeDisplayValue(value: number) {
  return GAUGE_MAX - clampGaugeValue(value);
}

function gaugeScoreFromFearGreedValue(value: number) {
  return Math.round((gaugeDisplayValue(value) / GAUGE_MAX) * 100);
}

function gaugeScoreLabel(score: number) {
  return getScoreZone(score).label;
}

function gaugeAngleForValue(value: number) {
  return 180 - (clampGaugeValue(value) / GAUGE_MAX) * 180;
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const angleRad = (Math.PI / 180) * angleDeg;
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy - radius * Math.sin(angleRad),
  };
}

function describeRingSegment(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  const largeArcFlag = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  const outerSweepFlag = startAngle > endAngle ? 1 : 0;
  const innerSweepFlag = outerSweepFlag === 1 ? 0 : 1;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} ${outerSweepFlag} ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} ${innerSweepFlag} ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
) {
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);
  const largeArcFlag = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  const sweepFlag = startAngle > endAngle ? 1 : 0;

  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}`;
}

function nearestValueAt(history: HistoricalData, targetTs: number) {
  if (history.timestamps.length === 0 || history.prices.length === 0) return null;
  let bestIndex = 0;
  let bestDiff = Math.abs(history.timestamps[0] - targetTs);
  for (let i = 1; i < history.timestamps.length; i++) {
    const diff = Math.abs(history.timestamps[i] - targetTs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  }
  return history.prices[bestIndex] ?? null;
}

function GaugeChart({ value }: { value: number }) {
  const width = Math.min(SCREEN_WIDTH - 56, 388);
  const height = width * 0.56;
  const cx = width / 2;
  const cy = height - 18;
  const outerRadius = Math.min(width * 0.40, 156);
  const innerRadius = outerRadius - 38;
  const guideRadius = innerRadius - 18;
  const centerRadius = 56;
  const visualValue = gaugeDisplayValue(value);
  const scoreValue = gaugeScoreFromFearGreedValue(value);
  const activeSegment = GAUGE_SEGMENTS.find((segment) => visualValue >= segment.start && visualValue < segment.end) ?? GAUGE_SEGMENTS[GAUGE_SEGMENTS.length - 1];
  const needleAngle = gaugeAngleForValue(visualValue);
  const needleTip = polarToCartesian(cx, cy, outerRadius - 10, needleAngle);
  const needleBaseLeft = polarToCartesian(cx, cy, 5, needleAngle + 90);
  const needleBaseRight = polarToCartesian(cx, cy, 5, needleAngle - 90);
  const markerValues = [0, 10, 20, 30, 40, 50];
  const guideValues = Array.from({ length: 15 }, (_, index) => (GAUGE_MAX / 14) * index);
  const labelRadius = outerRadius - 14;

  return (
    <View style={styles.gaugeWrap}>
      <View style={styles.gaugePanel}>
      <Svg width={width} height={height}>
        <SvgPath
          d={describeRingSegment(cx, cy, outerRadius, innerRadius, gaugeAngleForValue(0), gaugeAngleForValue(GAUGE_MAX))}
          fill="#171c1f"
          stroke="#22292f"
          strokeWidth={1}
        />

        {GAUGE_SEGMENTS.map((segment) => {
          const startAngle = gaugeAngleForValue(segment.start);
          const boundaryAngle = gaugeAngleForValue(segment.end);
          const isActive = segment === activeSegment;
          const segmentOuterRadius = outerRadius + 12;
          const segmentInnerRadius = innerRadius;
          const midAngle = (startAngle + boundaryAngle) / 2;
          const segmentLabelRadius = (segmentOuterRadius + segmentInnerRadius) / 2;
          const labelPoint = polarToCartesian(cx, cy, segmentLabelRadius, midAngle);
          const separatorOuter = polarToCartesian(cx, cy, segmentOuterRadius - 1, boundaryAngle);
          const separatorInner = polarToCartesian(cx, cy, innerRadius + 2, boundaryAngle);
          const segmentFill = isActive ? activeSegment.color + '5c' : '#171c1f';
          const labelFontSize = '8.5';
          const labelDy = 9;

          return (
            <React.Fragment key={segment.label.join('-')}>
              <SvgPath
                d={describeRingSegment(cx, cy, segmentOuterRadius, segmentInnerRadius, startAngle, boundaryAngle)}
                fill={segmentFill}
                stroke={isActive ? activeSegment.color : 'none'}
                strokeWidth={isActive ? 2 : 0}
              />
              {segment.end < GAUGE_MAX ? (
                <SvgLine
                  x1={separatorInner.x}
                  y1={separatorInner.y}
                  x2={separatorOuter.x}
                  y2={separatorOuter.y}
                  stroke="#22292f"
                  strokeWidth={1}
                />
              ) : null}
              <SvgText
                x={labelPoint.x}
                y={labelPoint.y - (segment.label.length > 1 ? 5 : 0)}
                fill={isActive ? '#0d1611' : '#7c8593'}
                fontSize={labelFontSize}
                fontWeight="700"
                textAnchor="middle"
                transform={`rotate(${90 - midAngle}, ${labelPoint.x}, ${labelPoint.y})`}
              >
                {segment.label.map((line, index) => (
                  <TSpan key={`${segment.label.join('-')}-${index}`} x={labelPoint.x} dy={index === 0 ? 0 : labelDy}>
                    {line}
                  </TSpan>
                ))}
              </SvgText>
            </React.Fragment>
          );
        })}

        <SvgPath
          d={`M ${needleBaseLeft.x} ${needleBaseLeft.y} L ${needleTip.x} ${needleTip.y} L ${needleBaseRight.x} ${needleBaseRight.y} Z`}
          fill="#f5f5f5"
        />
        {guideValues.map((marker, index) => {
          const angle = gaugeAngleForValue(marker);
          const point = polarToCartesian(cx, cy, guideRadius, angle);
          return (
            <SvgCircle
              key={`guide-${index}`}
              cx={point.x}
              cy={point.y}
              r={index % 2 === 0 ? 2 : 1.2}
              fill="#8b93a1"
              opacity={index % 2 === 0 ? 0.75 : 0.45}
            />
          );
        })}

        {markerValues.map((marker) => {
          const angle = gaugeAngleForValue(marker);
          const point = polarToCartesian(cx, cy, guideRadius - 22, angle);
          const markerLabel = Math.round((marker / GAUGE_MAX) * 100);
          return (
            <SvgText key={marker} x={point.x} y={point.y + 4} fill="#9ca3af" fontSize="10" fontWeight="700" textAnchor="middle">
              {markerLabel}
            </SvgText>
          );
        })}

        <SvgCircle cx={cx} cy={cy} r={centerRadius} fill="#171c1f" stroke="#22292f" strokeWidth={1.2} />
        <SvgText x={cx} y={cy - 6} fill="#f8fafc" fontSize="26" fontWeight="800" textAnchor="middle">
          {scoreValue}
        </SvgText>
        <SvgText x={cx} y={cy + 14} fill={activeSegment.color} fontSize="11" fontWeight="700" textAnchor="middle">
          {gaugeScoreLabel(scoreValue)}
        </SvgText>
      </Svg>
      </View>
    </View>
  );
}

export default function FearGreedIndexScreen() {
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [period, setPeriod] = useState<Period>('1M');
  const [data, setData] = useState<HistoricalData>({ prices: [], timestamps: [] });
  const [overviewData, setOverviewData] = useState<HistoricalData>({ prices: [], timestamps: [] });
  const [loading, setLoading] = useState(true);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentFearGreedValue, setCurrentFearGreedValue] = useState<number | null>(null);
  const [crossPrice, setCrossPrice] = useState<number | null>(null);
  const [crossDate, setCrossDate] = useState('');

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const { range, interval } = RANGE_MAP[p];
      const result = await getHistoricalData('^VIX', range, interval);
      setData(result);
      if (result.prices.length > 0) {
        setCurrentFearGreedValue(result.prices[result.prices.length - 1]);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const result = await getHistoricalData('^VIX', '1y', '1d');
      setOverviewData(result);
      if (result.prices.length > 0 && currentFearGreedValue == null) {
        setCurrentFearGreedValue(result.prices[result.prices.length - 1]);
      }
    } catch { /* ignore */ }
    setOverviewLoading(false);
  }, [currentFearGreedValue]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(period), loadOverview()]);
    setRefreshing(false);
  }, [load, loadOverview, period]);

  useEffect(() => {
    load(period);
  }, [load, period]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const overviewStats = useMemo(() => {
    if (overviewData.prices.length === 0 || overviewData.timestamps.length === 0) {
      return [] as Array<{ label: string; value: number; zone: string; color: string }>;
    }
    const latest = overviewData.prices[overviewData.prices.length - 1] ?? 0;
    const latestTs = overviewData.timestamps[overviewData.timestamps.length - 1] ?? Math.floor(Date.now() / 1000);
    const previousClose = overviewData.prices.length > 1 ? overviewData.prices[overviewData.prices.length - 2] : latest;
    const weekAgo = nearestValueAt(overviewData, latestTs - 7 * 86400) ?? latest;
    const monthAgo = nearestValueAt(overviewData, latestTs - 30 * 86400) ?? latest;
    const yearAgo = nearestValueAt(overviewData, latestTs - 365 * 86400) ?? latest;
    const previousCloseScore = gaugeScoreFromFearGreedValue(previousClose);
    const weekAgoScore = gaugeScoreFromFearGreedValue(weekAgo);
    const monthAgoScore = gaugeScoreFromFearGreedValue(monthAgo);
    const yearAgoScore = gaugeScoreFromFearGreedValue(yearAgo);

    return [
      { label: 'Previous Close', value: previousCloseScore, zone: getScoreZone(previousCloseScore).label, color: getScoreZone(previousCloseScore).color },
      { label: '1 Week Ago', value: weekAgoScore, zone: getScoreZone(weekAgoScore).label, color: getScoreZone(weekAgoScore).color },
      { label: '1 Month Ago', value: monthAgoScore, zone: getScoreZone(monthAgoScore).label, color: getScoreZone(monthAgoScore).color },
      { label: '1 Year Ago', value: yearAgoScore, zone: getScoreZone(yearAgoScore).label, color: getScoreZone(yearAgoScore).color },
    ];
  }, [overviewData]);

  const currentScore = gaugeScoreFromFearGreedValue(currentFearGreedValue ?? 0);
  const displayScore = viewMode === 'timeline' ? (crossPrice ?? currentScore) : currentScore;
  const zone = getScoreZone(displayScore);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.viewModeRow}>
          {(['overview', 'timeline'] as ViewMode[]).map((mode) => (
            <TouchableOpacity
              key={mode}
              onPress={() => setViewMode(mode)}
              style={[styles.viewModeBtn, mode === viewMode && styles.viewModeBtnActive]}
            >
              <Text style={[styles.viewModeTxt, mode === viewMode && styles.viewModeTxtActive]}>
                {mode === 'overview' ? 'Overview' : 'Timeline'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {viewMode === 'overview' ? (
          overviewLoading ? (
            <ActivityIndicator color="#6366f1" style={{ marginTop: 48 }} />
          ) : (
            <>
              <GaugeChart value={currentFearGreedValue ?? 0} />
              <View style={styles.statsGrid}>
                {overviewStats.map((stat) => (
                  <View key={stat.label} style={styles.statCard}>
                    <Text style={styles.statLabel}>{stat.label}</Text>
                    <Text style={[styles.statValue, { color: stat.color }]}>{stat.value.toFixed(2)}</Text>
                    <Text style={styles.statZone}>{stat.zone}</Text>
                  </View>
                ))}
              </View>
            </>
          )
        ) : (
          <>
            {loading ? (
              <ActivityIndicator color="#6366f1" style={{ marginTop: 60 }} />
            ) : (
              <>
                <View style={styles.timelineChartWrap}>
                  <InteractiveChart
                    key={`fear-greed-${period}`}
                    prices={data.prices.map(gaugeScoreFromFearGreedValue)}
                    timestamps={data.timestamps}
                    initialPoints={data.prices.length}
                    color={zone.color}
                    onCrosshairChange={(visible, price, ts) => {
                      setCrossPrice(visible ? price : null);
                      setCrossDate(visible && ts
                        ? new Date(ts * 1000).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })
                        : '');
                    }}
                  />
                </View>
                <View style={styles.periods}>
                  {PERIODS.map((p) => (
                    <TouchableOpacity
                      key={p}
                      onPress={() => setPeriod(p)}
                      style={[styles.periodBtn, p === period && styles.periodBtnActive]}
                    >
                      <Text style={[styles.periodTxt, p === period && styles.periodTxtActive]}>{p}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
          </>
        )}

        {/* Zone legend */}
        <Text style={styles.sectionTitle}>Fear & Greed Zones</Text>
        <View style={styles.zonesContainer}>
          {scoreZones.map((zoneItem) => (
            <View key={zoneItem.label} style={[styles.zoneRow, { backgroundColor: zoneItem.bg }]}>
              <View style={[styles.zoneBar, { backgroundColor: zoneItem.color }]} />
              <Text style={[styles.zoneLabel, { color: zoneItem.color }]}>{zoneItem.label}</Text>
              <Text style={styles.zoneRange}>
                {`${zoneItem.min}-${zoneItem.max}`}
              </Text>
            </View>
          ))}
        </View>

        {/* Info */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Como Ler Este Índice?</Text>
          <Text style={styles.infoText}>
            Este ecrã converte o VIX bruto numa escala de 0 a 100 para ficar mais legível como fear index. Quanto mais alto o score, mais greed existe no mercado; quanto mais baixo, maior é o fear.{"\n\n"}
            0-20 → Extreme Fear{"\n"}
            21-40 → Fear{"\n"}
            41-60 → Neutral{"\n"}
            61-75 → Greed{"\n"}
            76-100 → Extreme Greed
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  viewModeRow: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    marginTop: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: '#171c1f',
    borderRadius: 20,
    padding: 4,
    gap: 4,
  },
  viewModeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
  },
  viewModeBtnActive: { backgroundColor: '#f8fafc' },
  viewModeTxt: { color: '#a1a1aa', fontSize: 13, fontWeight: '600' },
  viewModeTxtActive: { color: '#0f0f0f' },
  periods: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  periodBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1e293b',
  },
  periodBtnActive: { backgroundColor: '#6366f1' },
  periodTxt: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  periodTxtActive: { color: '#fff' },
  timelineChartWrap: {
    transform: [{ translateX: 10 }],
  },
  gaugeWrap: {
    marginHorizontal: 16,
    marginTop: 2,
    marginBottom: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gaugePanel: {
    backgroundColor: '#111417',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#22292f',
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 2,
    transform: [{ translateX: -10 }],
  },
  gaugeCenterBadge: {
    backgroundColor: '#171c1f',
  },
  gaugeValue: { color: '#f8fafc', fontSize: 26, fontWeight: '800' },
  gaugeZoneText: { marginTop: 4, fontSize: 11, fontWeight: '700' },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 16,
  },
  statCard: {
    width: '47%',
    backgroundColor: '#171c1f',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#22292f',
    padding: 14,
  },
  statLabel: { color: '#94a3b8', fontSize: 12, marginBottom: 6 },
  statValue: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  statZone: { color: '#e2e8f0', fontSize: 13, fontWeight: '600', marginTop: 4 },
  sectionTitle: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 20,
    marginBottom: 8,
    marginHorizontal: 16,
  },
  zonesContainer: {
    marginHorizontal: 16,
    borderRadius: 14,
    overflow: 'hidden',
    gap: 1,
  },
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
  },
  zoneBar: { width: 4, height: 20, borderRadius: 2 },
  zoneLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  zoneRange: { color: '#64748b', fontSize: 13 },
  infoCard: {
    margin: 16,
    backgroundColor: '#1b2023',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#303841',
  },
  infoTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700', marginBottom: 8 },
  infoText: { color: '#cfd6e0', fontSize: 13, lineHeight: 20 },
});
