import React, { ReactNode, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, Dimensions, ActivityIndicator, Platform, useWindowDimensions } from 'react-native';
import { Canvas, Path, Skia, Line, Text as SkiaText, matchFont, Rect, Group } from '@shopify/react-native-skia';
import { useSharedValue, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const PAD_TOP = 16;
const PAD_BOT = 30;
const PRICE_AXIS_W = 44; // largura da barra de preço direita
const PLOT_W = SCREEN_WIDTH - PRICE_AXIS_W;

const FIB_RATIOS = [
  { ratio: 0,     label: '0',     color: '#9e9e9e' },
  { ratio: 0.236, label: '0.236', color: '#f44336' },
  { ratio: 0.382, label: '0.382', color: '#ff9800' },
  { ratio: 0.5,   label: '0.5',   color: '#4caf50' },
  { ratio: 0.618, label: '0.618', color: '#2196f3' },
  { ratio: 0.786, label: '0.786', color: '#9c27b0' },
  { ratio: 1,     label: '1',     color: '#9e9e9e' },
];

interface Props {
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  timestamps: number[];
  initialPoints?: number;
  height?: number;
  loading?: boolean;
  avgPrice?: number;
  footerLegend?: ReactNode;
  footerAccessory?: ReactNode;
  tool?: 'none' | 'ruler' | 'fib'; // handled by web version only
  onCrosshairChange?: (visible: boolean, price: number, timestamp: number) => void;
  onVisibleChange?: (closes: number[], timestamps: number[]) => void;
}

export default function CandlestickChart({
  open, high, low, close, timestamps,
  initialPoints = 60,
  height = 260,
  loading = false,
  avgPrice,
  footerLegend,
  footerAccessory,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tool: _tool,
  onCrosshairChange,
  onVisibleChange,
}: Props) {
  const CHART_H = height;
  const plotH = CHART_H - PAD_TOP - PAD_BOT;

  // ---- Zoom horizontal (nº de candles) ----
  const [visiblePoints, setVisiblePoints] = useState(initialPoints);
  const [panOffset, setPanOffset] = useState(0);

  // Quando os dados chegam de forma assíncrona, initialPoints muda de 5 (array vazio)
  // para o valor correto — resetar visiblePoints para evitar velas gigantes.
  useEffect(() => {
    setVisiblePoints(initialPoints);
    setPanOffset(0);
    pinchHBase.value = initialPoints;
    panHBase.value = 0;
  }, [initialPoints]);

  // ---- Zoom vertical (expansão do eixo de preço) ----
  // priceZoom > 1 = zoom in (estreita o range de preço), < 1 = zoom out
  const [priceZoom, setPriceZoom] = useState(1);
  const [priceCenter, setPriceCenter] = useState<number | null>(null); // preço central do zoom

  // SharedValues para gestures
  const pinchHBase = useSharedValue(initialPoints);
  const panHBase = useSharedValue(0);
  const pinchVBase = useSharedValue(1);
  const priceCenterBase = useSharedValue<number>(0);

  // Crosshair
  const crosshairActive = useSharedValue(false);
  const crosshairX = useSharedValue(-1);
  const [chState, setChState] = useState({ visible: false, x: 0, y: 0, price: 0, ts: 0 });

  // Régua de medição
  const [rulerMode, setRulerMode] = useState(false);
  const rulerModeShared = useSharedValue(false);
  const rulerX1sv = useSharedValue(0);
  const rulerY1sv = useSharedValue(0);
  const [rulerState, setRulerState] = useState({ visible: false, x1: 0, price1: 0, x2: 0, price2: 0 });

  // Fibonacci
  const [fibMode, setFibMode] = useState(false);
  const fibModeShared = useSharedValue(false);
  const fibX1sv = useSharedValue(0);
  const fibY1sv = useSharedValue(0);
  const [fibState, setFibState] = useState({ visible: false, x1: 0, price1: 0, x2: 0, price2: 0 });

  // ---- Desktop web ----
  const { width: windowWidth } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && windowWidth >= 768;
  const [plotWidth, setPlotWidth] = useState(SCREEN_WIDTH - PRICE_AXIS_W);
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const PLOT_W = plotWidth; // shadows module-level; corrected by onLayout
  const chartDomRef = useRef<any>(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);

  const total = close.length;
  const zoomMin = Math.max(5, Math.floor(initialPoints / 6));
  const zoomMax = Math.min(total, initialPoints * 4);
  const clamped = Math.max(zoomMin, Math.min(visiblePoints, zoomMax));
  const maxOffset = Math.max(0, total - clamped);
  const safeOffset = Math.min(panOffset, maxOffset);
  const startIdx = total - clamped - safeOffset;
  // Mutable refs so mouse handlers always see latest values
  const clampedRef = useRef(clamped);
  const safeOffsetRef = useRef(safeOffset);
  const maxOffsetRef = useRef(maxOffset);
  clampedRef.current = clamped;
  safeOffsetRef.current = safeOffset;
  maxOffsetRef.current = maxOffset;

  const visibleClose = useMemo(() => close.slice(startIdx, startIdx + clamped), [startIdx, clamped, close]);
  const visibleHigh = useMemo(() => high.slice(startIdx, startIdx + clamped), [startIdx, clamped, high]);
  const visibleLow = useMemo(() => low.slice(startIdx, startIdx + clamped), [startIdx, clamped, low]);
  const visibleOpen = useMemo(() => open.slice(startIdx, startIdx + clamped), [startIdx, clamped, open]);
  const visibleTs = useMemo(() => timestamps.slice(startIdx, startIdx + clamped), [startIdx, clamped, timestamps]);

  // Notificar o pai sempre que as velas visíveis mudam (pan/zoom/dados novos)
  useEffect(() => {
    if (visibleClose.length > 0) onVisibleChange?.(visibleClose, visibleTs);
  }, [visibleClose, visibleTs]);

  // ---- Faixa de preço visível (com zoom vertical) ----
  const [rawMin, rawMax] = useMemo(() => {
    if (visibleHigh.length === 0) return [0, 1];
    let mn = visibleLow[0], mx = visibleHigh[0];
    for (let i = 1; i < visibleHigh.length; i++) {
      if (visibleLow[i] < mn) mn = visibleLow[i];
      if (visibleHigh[i] > mx) mx = visibleHigh[i];
    }
    return [mn, mx];
  }, [visibleHigh, visibleLow]);

  const rawMid = (rawMin + rawMax) / 2;
  const rawRange = rawMax - rawMin || 1;

  // Aplicar zoom vertical: reduz o range visível em torno do centro
  const effectiveCenter = priceCenter ?? rawMid;
  const halfRange = (rawRange / 2) / priceZoom;
  const priceMin = effectiveCenter - halfRange;
  const priceMax = effectiveCenter + halfRange;
  const priceRange = priceMax - priceMin;

  const toY = useCallback((p: number) =>
    PAD_TOP + plotH * (1 - (p - priceMin) / priceRange),
    [plotH, priceMin, priceRange],
  );

  // Refs so gesture callbacks can convert pixel Y → price without stale closures
  const priceMaxRef = useRef(priceMax);
  const priceRangeRef = useRef(priceRange);
  useEffect(() => { priceMaxRef.current = priceMax; priceRangeRef.current = priceRange; }, [priceMax, priceRange]);
  const yToPrice = useCallback((y: number) =>
    priceMaxRef.current - ((y - PAD_TOP) / plotH) * priceRangeRef.current,
    [plotH],
  );

  // candle X: de 0 a PLOT_W
  const toX = useCallback((i: number) =>
    (i / Math.max(1, clamped - 1)) * PLOT_W,
    [clamped, plotWidth],
  );

  const candleW = useMemo(() =>
    Math.min(8, Math.max(1, Math.floor((PLOT_W / clamped) * 0.7))),
    [clamped, plotWidth],
  );

  // ---- Skia path para as mechas (lines) e corpos (rects via path) ----
  const { wickPath, bullPath, bearPath } = useMemo(() => {
    const wick = Skia.Path.Make();
    const bull = Skia.Path.Make();
    const bear = Skia.Path.Make();

    const halfW = candleW / 2;
    visibleClose.forEach((c, i) => {
      const o = visibleOpen[i];
      const h = visibleHigh[i];
      const l = visibleLow[i];
      const cx = toX(i);
      // Mecha
      wick.moveTo(cx, toY(h));
      wick.lineTo(cx, toY(l));
      // Corpo
      const yO = toY(o);
      const yC = toY(c);
      const top = Math.min(yO, yC);
      const bodyH = Math.max(1, Math.abs(yC - yO));
      (c >= o ? bull : bear).addRect({ x: cx - halfW, y: top, width: candleW, height: bodyH });
    });

    return { wickPath: wick, bullPath: bull, bearPath: bear };
  // priceMin e priceRange mudam com zoom vertical → toY muda → recalcula
  }, [visibleClose, visibleOpen, visibleHigh, visibleLow, clamped, toY, toX, candleW]);

  // ---- Preços no eixo direito ----
  const priceLabels = useMemo(() => {
    const count = 6;
    return Array.from({ length: count }, (_, i) => {
      const p = priceMax - (priceRange * i) / (count - 1);
      const y = toY(p);
      // só mostra se dentro da área do plot
      if (y < PAD_TOP || y > CHART_H - PAD_BOT) return null;
      return { y, label: p >= 1000 ? p.toFixed(0) : p.toFixed(2) };
    }).filter(Boolean) as { y: number; label: string }[];
  }, [priceMin, priceMax, priceRange, toY, CHART_H]);

  // ---- Avg price dashed line ----
  const avgPriceLine = useMemo(() => {
    if (avgPrice == null || avgPrice <= 0) return null;
    const y = toY(avgPrice);
    if (y < PAD_TOP || y > CHART_H - PAD_BOT) return null;
    const p = Skia.Path.Make();
    const dashLen = 7;
    const gapLen = 4;
    let x = 0;
    while (x < PLOT_W) {
      p.moveTo(x, y);
      p.lineTo(Math.min(x + dashLen, PLOT_W), y);
      x += dashLen + gapLen;
    }
    return { path: p, y };
  }, [avgPrice, toY, CHART_H]);

  // ---- Timestamps no eixo inferior ----
  const tsLabels = useMemo(() => {
    if (visibleTs.length < 2) return [];
    const count = 6;
    const avgDiff = (visibleTs[visibleTs.length - 1] - visibleTs[0]) / (visibleTs.length - 1);
    const fmt = avgDiff > 20 * 86400
      ? (d: Date) => d.toLocaleDateString('pt-PT', { month: 'short', year: '2-digit' })
      : avgDiff > 3600
      ? (d: Date) => d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' })
      : (d: Date) => d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    return Array.from({ length: count }, (_, i) => {
      const idx = Math.round((i / (count - 1)) * (visibleTs.length - 1));
      const x = (idx / Math.max(1, clamped - 1)) * PLOT_W;
      return { label: fmt(new Date(visibleTs[idx] * 1000)), x };
    });
  }, [visibleTs, clamped]);

  const font = useMemo(() =>
    matchFont({ fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif', fontSize: 11, fontStyle: 'normal', fontWeight: 'normal' }),
    [],
  );

  // ---- JS callbacks chamados via runOnJS ----
  const updateCrosshair = useCallback((px: number, py: number) => {
    const idx = visibleClose.length > 1
      ? Math.max(0, Math.min(Math.round((px / PLOT_W) * (visibleClose.length - 1)), visibleClose.length - 1))
      : 0;
    const ts = visibleTs[idx] ?? 0;
    const axisPrice = priceMax - ((py - PAD_TOP) / plotH) * priceRange;
    const closePrice = visibleClose[idx] ?? axisPrice;
    setChState({ visible: true, x: px, y: py, price: axisPrice, ts });
    onCrosshairChange?.(true, closePrice, ts);
  }, [visibleClose, visibleTs, priceMax, priceRange, plotH, onCrosshairChange, plotWidth]);

  const hideCrosshair = useCallback(() => {
    setChState(s => ({ ...s, visible: false }));
    onCrosshairChange?.(false, 0, 0);
  }, [onCrosshairChange]);

  // ---- Desktop web mouse handlers ----
  const stableUpdateCrosshairRef = useRef(updateCrosshair);
  stableUpdateCrosshairRef.current = updateCrosshair;

  const handleMouseMove = useCallback((e: any) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const py = Math.max(PAD_TOP, Math.min(e.clientY - rect.top, rect.height - PAD_BOT));
    stableUpdateCrosshairRef.current(px, py);
    if (isDragging.current && !rulerMode && !fibMode) {
      const deltaPx = e.clientX - dragStartX.current;
      const pxPerCandle = rect.width / Math.max(1, clampedRef.current);
      const delta = Math.round(-deltaPx / pxPerCandle);
      setPanOffset(Math.max(0, Math.min(dragStartOffset.current + delta, maxOffsetRef.current)));
    }
  }, [rulerMode, fibMode]);

  const handleMouseLeave = useCallback(() => {
    hideCrosshair();
    isDragging.current = false;
  }, [hideCrosshair]);

  const handleMouseDown = useCallback((e: any) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartOffset.current = safeOffsetRef.current;
    e.preventDefault();
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // Wheel zoom — attached imperatively so we can use { passive: false }
  useEffect(() => {
    if (!isDesktopWeb) return;
    const el = chartDomRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.15 : 0.87;
      setVisiblePoints(prev => Math.max(zoomMin, Math.min(Math.round(prev * factor), zoomMax)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isDesktopWeb, zoomMin, zoomMax]);

  // Refs estáveis para os gestos — evita stale closure no worklet
  const updateCrosshairRef = useRef(updateCrosshair);
  updateCrosshairRef.current = updateCrosshair;
  const hideCrosshairRef = useRef(hideCrosshair);
  hideCrosshairRef.current = hideCrosshair;
  const stableUpdateCrosshair = useCallback((px: number, py: number) => {
    updateCrosshairRef.current(px, py);
  }, []);
  const stableHideCrosshair = useCallback(() => {
    hideCrosshairRef.current();
  }, []);

  const toggleRulerMode = useCallback(() => {
    setRulerMode(prev => {
      const next = !prev;
      rulerModeShared.value = next;
      if (!next) setRulerState(s => ({ ...s, visible: false }));
      if (next) {
        fibModeShared.value = false;
        setFibMode(false);
        setFibState(s => ({ ...s, visible: false }));
      }
      return next;
    });
  }, [rulerModeShared, fibModeShared]);

  const updateRuler = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    setRulerState({ visible: true, x1, price1: yToPrice(y1), x2, price2: yToPrice(y2) });
  }, [yToPrice]);

  const toggleFibMode = useCallback(() => {
    // If a fib is on screen, clear it
    if (fibState.visible || fibMode) {
      fibModeShared.value = false;
      setFibMode(false);
      setFibState(s => ({ ...s, visible: false }));
      return;
    }
    // Otherwise enter drawing mode
    fibModeShared.value = true;
    setFibMode(true);
    rulerModeShared.value = false;
    setRulerMode(false);
    setRulerState(s => ({ ...s, visible: false }));
  }, [fibModeShared, rulerModeShared, fibState.visible, fibMode]);

  const updateFib = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    setFibState({ visible: true, x1, price1: yToPrice(y1), x2, price2: yToPrice(y2) });
  }, [yToPrice]);

  const rulerInfo = useMemo(() => {
    if (!rulerState.visible) return null;
    const len = visibleClose.length;
    const i1 = Math.max(0, Math.min(Math.round((rulerState.x1 / PLOT_W) * (len - 1)), len - 1));
    const i2 = Math.max(0, Math.min(Math.round((rulerState.x2 / PLOT_W) * (len - 1)), len - 1));
    const price1 = rulerState.price1;
    const price2 = rulerState.price2;
    const priceDiff = price2 - price1;
    const pricePct = Math.abs(price1) > 0 ? (priceDiff / price1) * 100 : 0;
    const bars = Math.abs(i2 - i1);
    const ts1 = visibleTs[Math.min(i1, i2)] ?? 0;
    const ts2 = visibleTs[Math.max(i1, i2)] ?? 0;
    const secDiff = Math.abs(ts2 - ts1);
    let dur = '';
    if (secDiff >= 86400) dur = `${Math.floor(secDiff / 86400)}d ${Math.floor((secDiff % 86400) / 3600)}h`;
    else if (secDiff >= 3600) dur = `${Math.floor(secDiff / 3600)}h ${Math.floor((secDiff % 3600) / 60)}m`;
    else dur = `${Math.round(secDiff / 60)}m`;
    const sign = priceDiff >= 0 ? '+' : '';
    const absLabel = Math.abs(priceDiff) >= 1000 ? priceDiff.toFixed(0) : priceDiff.toFixed(2);
    return {
      line1: `${sign}${absLabel} (${sign}${pricePct.toFixed(2)}%)`,
      line2: `${bars} barras, ${dur}`,
      isUp: priceDiff >= 0,
    };
  }, [rulerState, visibleClose, visibleTs]);

  const rulerBorderPath = useMemo(() => {
    if (!rulerState.visible) return null;
    const p = Skia.Path.Make();
    const rx1 = Math.min(rulerState.x1, rulerState.x2);
    const rx2 = Math.max(rulerState.x1, rulerState.x2);
    const ry1 = toY(rulerState.price1);
    const ry2 = toY(rulerState.price2);
    const ryMin = Math.min(ry1, ry2); const ryMax = Math.max(ry1, ry2);
    p.moveTo(rx1, ryMin); p.lineTo(rx2, ryMin); p.lineTo(rx2, ryMax); p.lineTo(rx1, ryMax); p.close();
    return p;
  }, [rulerState, toY]);

  // ---- Ruler arrows (horizontal + vertical from start point) ----
  const rulerArrowPaths = useMemo(() => {
    if (!rulerState.visible) return null;
    const { x1, price1, x2, price2 } = rulerState;
    const y1 = toY(price1);
    const y2 = toY(price2);
    const A = 7; // arrowhead size
    const hPath = Skia.Path.Make();
    hPath.moveTo(x1, y1);
    hPath.lineTo(x2, y1);
    const hDir = x2 >= x1 ? 1 : -1;
    hPath.moveTo(x2, y1);
    hPath.lineTo(x2 - hDir * A, y1 - A * 0.5);
    hPath.moveTo(x2, y1);
    hPath.lineTo(x2 - hDir * A, y1 + A * 0.5);

    const vPath = Skia.Path.Make();
    vPath.moveTo(x1, y1);
    vPath.lineTo(x1, y2);
    const vDir = y2 >= y1 ? 1 : -1;
    vPath.moveTo(x1, y2);
    vPath.lineTo(x1 - A * 0.5, y2 - vDir * A);
    vPath.moveTo(x1, y2);
    vPath.lineTo(x1 + A * 0.5, y2 - vDir * A);

    return { hPath, vPath };
  }, [rulerState, toY]);

  const fibLevels = useMemo(() => {
    if (!fibState.visible) return null;
    const { price1, price2 } = fibState;
    const xLeft = Math.min(fibState.x1, fibState.x2);
    const xRight = Math.max(fibState.x1, fibState.x2);
    return FIB_RATIOS.map(({ ratio, label, color }) => {
      const price = price1 + (price2 - price1) * ratio;
      const y = toY(price);
      const priceStr = price >= 1000 ? price.toFixed(0) : price.toFixed(2);
      return { label, color, priceStr, y, xLeft, xRight };
    }).filter(({ y }) => y >= PAD_TOP && y <= CHART_H - PAD_BOT);
  }, [fibState, toY, CHART_H]);

  // ---- Gestures ----
  // Pinch horizontal (na área do gráfico)
  const pinchH = Gesture.Pinch()
    .onUpdate((e) => {
      'worklet';
      const newPts = Math.round(pinchHBase.value / e.scale);
      runOnJS(setVisiblePoints)(Math.max(zoomMin, Math.min(newPts, zoomMax)));
    })
    .onEnd(() => {
      'worklet';
      pinchHBase.value = clamped;
    });

  // Pan horizontal = scroll; com long press = crosshair
  const panH = Gesture.Pan()
    .onBegin((e) => {
      'worklet';
      if (rulerModeShared.value) {
        rulerX1sv.value = Math.max(0, Math.min(e.x, PLOT_W));
        rulerY1sv.value = Math.max(PAD_TOP, Math.min(e.y, CHART_H - PAD_BOT));
        return;
      }
      if (fibModeShared.value) {
        fibX1sv.value = Math.max(0, Math.min(e.x, PLOT_W));
        fibY1sv.value = Math.max(PAD_TOP, Math.min(e.y, CHART_H - PAD_BOT));
        return;
      }
      panHBase.value = safeOffset;
      priceCenterBase.value = effectiveCenter;
    })
    .onUpdate((e) => {
      'worklet';
      if (rulerModeShared.value) {
        const x2 = Math.max(0, Math.min(e.x, PLOT_W));
        const y2 = Math.max(PAD_TOP, Math.min(e.y, CHART_H - PAD_BOT));
        runOnJS(updateRuler)(rulerX1sv.value, rulerY1sv.value, x2, y2);
        return;
      }
      if (fibModeShared.value) {
        const x2 = Math.max(0, Math.min(e.x, PLOT_W));
        const y2 = Math.max(PAD_TOP, Math.min(e.y, CHART_H - PAD_BOT));
        runOnJS(updateFib)(fibX1sv.value, fibY1sv.value, x2, y2);
        return;
      }
      if (crosshairActive.value) {
        const px = Math.max(0, Math.min(e.x, PLOT_W));
        const py = Math.max(PAD_TOP, Math.min(e.y, CHART_H - PAD_BOT));
        crosshairX.value = px;
        runOnJS(stableUpdateCrosshair)(px, py);
        return;
      }
      // Pan livre: horizontal (scroll) + vertical (deslocar preço) em simultâneo
      const pxPerCandle = PLOT_W / Math.max(1, clamped);
      const delta = Math.round(e.translationX / pxPerCandle);
      runOnJS(setPanOffset)(Math.max(0, Math.min(panHBase.value + delta, maxOffset)));
      const newCenter = priceCenterBase.value + e.translationY * (priceRange / plotH);
      runOnJS(setPriceCenter)(newCenter);
    })
    .onEnd(() => {
      'worklet';
      if (rulerModeShared.value) {
        return; // manter régua visível
      }
      if (fibModeShared.value) {
        // exit drawing mode but keep the fib on screen
        fibModeShared.value = false;
        runOnJS(setFibMode)(false);
        panHBase.value = safeOffset;
        return;
      }
      if (crosshairActive.value) {
        crosshairActive.value = false;
        crosshairX.value = -1;
        runOnJS(stableHideCrosshair)();
      } else {
        panHBase.value = safeOffset;
      }
    });

  const longPress = Gesture.LongPress()
    .minDuration(350)
    .onStart((e) => {
      'worklet';
      if (rulerModeShared.value) return;
      crosshairActive.value = true;
      const px = Math.max(0, Math.min(e.x, PLOT_W));
      const py = Math.max(PAD_TOP, Math.min(e.y, CHART_H - PAD_BOT));
      crosshairX.value = px;
      runOnJS(stableUpdateCrosshair)(px, py);
    });

  const chartGesture = Gesture.Simultaneous(longPress, panH, pinchH);

  // ---- Gesture do eixo de preço: pan vertical = zoom (arrastar cima = zoom in) ----
  const axisGesture = Gesture.Pan()
    .onBegin(() => {
      'worklet';
      pinchVBase.value = priceZoom;
      priceCenterBase.value = effectiveCenter;
    })
    .onUpdate((e) => {
      'worklet';
      // translationY < 0 = arrastar para cima = zoom in (velas maiores)
      // translationY > 0 = arrastar para baixo = zoom out (velas menores)
      const factor = Math.exp(-e.translationY / 150);
      const newZoom = Math.max(0.3, Math.min(pinchVBase.value * factor, 30));
      runOnJS(setPriceZoom)(newZoom);
    });

  if (loading) return <ActivityIndicator color="#6366f1" style={{ height: CHART_H }} />;
  if (visibleClose.length < 2) {
    return (
      <View style={{ height: CHART_H, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: '#475569' }}>Sem dados</Text>
      </View>
    );
  }

  const BULL_COLOR = '#26a69a'; // verde TradingView
  const BEAR_COLOR = '#ef5350'; // vermelho TradingView
  const chY = chState.visible ? chState.y : -1;

  return (
    <View onLayout={(e) => setPlotWidth(Math.max(10, e.nativeEvent.layout.width - PRICE_AXIS_W))}>
      <View style={{ flexDirection: 'row', height: CHART_H }}>
      {/* Área principal do gráfico */}
      {isDesktopWeb ? (
        <View
          ref={chartDomRef}
          style={{ width: PLOT_W, height: CHART_H, cursor: 'crosshair' } as any}
          {...({ onMouseMove: handleMouseMove, onMouseLeave: handleMouseLeave, onMouseDown: handleMouseDown, onMouseUp: handleMouseUp } as any)}
        >
          <Canvas style={{ width: PLOT_W, height: CHART_H }}>
            {/* Linhas de grade horizontais (no canvas principal) */}
            {priceLabels.map(({ y }, i) => (
              <Line key={`g${i}`} p1={{ x: 0, y }} p2={{ x: PLOT_W, y }} color="#1e293b" strokeWidth={1} />
            ))}
            {/* Fibonacci levels */}
            {fibLevels && fibLevels.map(({ color, y, xLeft, xRight }, i) => (
              <Line key={`fibl${i}`} p1={{ x: xLeft, y }} p2={{ x: xRight, y }} color={color} strokeWidth={1} />
            ))}
            {fibLevels && font && fibLevels.map(({ label, priceStr, color, y, xLeft }, i) => (
              <SkiaText key={`fibt${i}`} x={xLeft + 3} y={y - 2} text={`${label} (${priceStr})`} font={font} color={color} />
            ))}
            {/* Régua de medição — atrás das velas */}
            {rulerState.visible && (() => {
              const ry1 = toY(rulerState.price1); const ry2 = toY(rulerState.price2);
              return (
              <>
                <Rect
                  x={Math.min(rulerState.x1, rulerState.x2)}
                  y={Math.min(ry1, ry2)}
                  width={Math.abs(rulerState.x2 - rulerState.x1)}
                  height={Math.abs(ry2 - ry1)}
                  color={rulerInfo?.isUp ? '#26a69a25' : '#ef535025'}
                />
                {rulerBorderPath && (
                  <Path path={rulerBorderPath} color={rulerInfo?.isUp ? '#26a69a' : '#ef5350'} strokeWidth={1} style="stroke" />
                )}
                {rulerArrowPaths && (
                  <>
                    <Path path={rulerArrowPaths.hPath} color={rulerInfo?.isUp ? '#26a69a' : '#ef5350'} strokeWidth={1.5} style="stroke" />
                    <Path path={rulerArrowPaths.vPath} color={rulerInfo?.isUp ? '#26a69a' : '#ef5350'} strokeWidth={1.5} style="stroke" />
                  </>
                )}
              </>
              );
            })()}
            {/* Crosshair — atrás de tudo */}
            {chState.visible && (
              <>
                <Line p1={{ x: chState.x, y: PAD_TOP }} p2={{ x: chState.x, y: CHART_H - PAD_BOT }} color="#94a3b8" strokeWidth={1} />
                <Line p1={{ x: 0, y: chY }} p2={{ x: PLOT_W, y: chY }} color="#94a3b8" strokeWidth={1} />
              </>
            )}
            {/* Avg price dashed line */}
            {avgPriceLine && (
              <Path path={avgPriceLine.path} color="#f59e0b" strokeWidth={1.5} style="stroke" />
            )}
            {/* Clip para as velas não ultrapassarem a área do plot */}
            <Group clip={{ x: 0, y: PAD_TOP, width: PLOT_W, height: plotH }}>
              {/* Mechas — antes dos corpos para ficar atrás */}
              <Path path={wickPath} color="#9e9e9e" strokeWidth={1} style="stroke" />
              {/* Corpos altos — por cima das mechas */}
              <Path path={bullPath} color={BULL_COLOR} style="fill" />
              {/* Corpos baixos — por cima das mechas */}
              <Path path={bearPath} color={BEAR_COLOR} style="fill" />
            </Group>
            {/* Labels X */}
            {font && tsLabels.map(({ label, x }, i) => (
              <SkiaText key={i} x={Math.max(0, Math.min(x - 16, PLOT_W - label.length * 6))} y={CHART_H - 6} text={label} font={font} color="#475569" />
            ))}
            {/* Tag de data do crosshair no eixo X */}
            {chState.visible && font && (() => {
              const tsLabel = (() => {
                const d = new Date(chState.ts * 1000);
                const avgDiff = visibleTs.length > 1
                  ? (visibleTs[visibleTs.length - 1] - visibleTs[0]) / (visibleTs.length - 1)
                  : 86400;
                if (avgDiff > 20 * 86400) return d.toLocaleDateString('pt-PT', { month: 'short', year: '2-digit' });
                if (avgDiff > 3600) return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
                return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
              })();
              const tagW = tsLabel.length * 7 + 8;
              const tagX = Math.max(0, Math.min(chState.x - tagW / 2, PLOT_W - tagW));
              return (
                <>
                  <Rect x={tagX} y={CHART_H - PAD_BOT} width={tagW} height={PAD_BOT - 2} color="#6366f1" />
                  <SkiaText x={tagX + 4} y={CHART_H - 6} text={tsLabel} font={font} color="#ffffff" />
                </>
              );
            })()}
          </Canvas>
        </View>
      ) : (
        <GestureDetector gesture={chartGesture}>
          <View style={{ width: PLOT_W, height: CHART_H }}>
            <Canvas style={{ width: PLOT_W, height: CHART_H }}>
              {priceLabels.map(({ y }, i) => (
                <Line key={`g${i}`} p1={{ x: 0, y }} p2={{ x: PLOT_W, y }} color="#1e293b" strokeWidth={1} />
              ))}
              {fibLevels && fibLevels.map(({ color, y, xLeft, xRight }, i) => (
                <Line key={`fibl${i}`} p1={{ x: xLeft, y }} p2={{ x: xRight, y }} color={color} strokeWidth={1} />
              ))}
              {fibLevels && font && fibLevels.map(({ label, priceStr, color, y, xLeft }, i) => (
                <SkiaText key={`fibt${i}`} x={xLeft + 3} y={y - 2} text={`${label} (${priceStr})`} font={font} color={color} />
              ))}
              {rulerState.visible && (() => {
                const ry1 = toY(rulerState.price1); const ry2 = toY(rulerState.price2);
                return (
                  <>
                    <Rect x={Math.min(rulerState.x1, rulerState.x2)} y={Math.min(ry1, ry2)} width={Math.abs(rulerState.x2 - rulerState.x1)} height={Math.abs(ry2 - ry1)} color={rulerInfo?.isUp ? '#26a69a25' : '#ef535025'} />
                    {rulerBorderPath && (<Path path={rulerBorderPath} color={rulerInfo?.isUp ? '#26a69a' : '#ef5350'} strokeWidth={1} style="stroke" />)}
                    {rulerArrowPaths && (<><Path path={rulerArrowPaths.hPath} color={rulerInfo?.isUp ? '#26a69a' : '#ef5350'} strokeWidth={1.5} style="stroke" /><Path path={rulerArrowPaths.vPath} color={rulerInfo?.isUp ? '#26a69a' : '#ef5350'} strokeWidth={1.5} style="stroke" /></>)}
                  </>
                );
              })()}
              {chState.visible && (<><Line p1={{ x: chState.x, y: PAD_TOP }} p2={{ x: chState.x, y: CHART_H - PAD_BOT }} color="#94a3b8" strokeWidth={1} /><Line p1={{ x: 0, y: chY }} p2={{ x: PLOT_W, y: chY }} color="#94a3b8" strokeWidth={1} /></>)}
              {avgPriceLine && (<Path path={avgPriceLine.path} color="#f59e0b" strokeWidth={1.5} style="stroke" />)}
              <Group clip={{ x: 0, y: PAD_TOP, width: PLOT_W, height: plotH }}>
                <Path path={wickPath} color="#9e9e9e" strokeWidth={1} style="stroke" />
                <Path path={bullPath} color={BULL_COLOR} style="fill" />
                <Path path={bearPath} color={BEAR_COLOR} style="fill" />
              </Group>
              {font && tsLabels.map(({ label, x }, i) => (
                <SkiaText key={i} x={Math.max(0, Math.min(x - 16, PLOT_W - label.length * 6))} y={CHART_H - 6} text={label} font={font} color="#475569" />
              ))}
              {chState.visible && font && (() => {
                const tsLabel = (() => {
                  const d = new Date(chState.ts * 1000);
                  const avgDiff = visibleTs.length > 1 ? (visibleTs[visibleTs.length - 1] - visibleTs[0]) / (visibleTs.length - 1) : 86400;
                  if (avgDiff > 20 * 86400) return d.toLocaleDateString('pt-PT', { month: 'short', year: '2-digit' });
                  if (avgDiff > 3600) return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
                  return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
                })();
                const tagW = tsLabel.length * 7 + 8;
                const tagX = Math.max(0, Math.min(chState.x - tagW / 2, PLOT_W - tagW));
                return (<><Rect x={tagX} y={CHART_H - PAD_BOT} width={tagW} height={PAD_BOT - 2} color="#6366f1" /><SkiaText x={tagX + 4} y={CHART_H - 6} text={tsLabel} font={font} color="#ffffff" /></>);
              })()}
            </Canvas>
          </View>
        </GestureDetector>
      )}

      {/* Barra de preço direita — pinch/pan vertical */}
      <GestureDetector gesture={axisGesture}>
        <View style={{ width: PRICE_AXIS_W, height: CHART_H, backgroundColor: '#0f0f0f', borderLeftWidth: 1, borderLeftColor: '#1e293b' }}>
          <Canvas style={{ width: PRICE_AXIS_W, height: CHART_H }}>
            {/* Labels de preço */}
            {font && priceLabels.map(({ y, label }, i) => (
              <SkiaText key={i} x={4} y={y + 4} text={label} font={font} color="#94a3b8" />
            ))}
            {/* Fib price labels */}
            {fibLevels && font && fibLevels.map(({ color, priceStr, y }, i) => (
              <SkiaText key={`fibax${i}`} x={3} y={y + 4} text={priceStr} font={font} color={color} />
            ))}
            {/* Avg price label */}
            {avgPriceLine && font && (
              <>
                <Rect x={0} y={avgPriceLine.y - 9} width={PRICE_AXIS_W} height={18} color="#f59e0b" />
                <SkiaText x={4} y={avgPriceLine.y + 4} text={avgPrice! >= 1000 ? avgPrice!.toFixed(0) : avgPrice!.toFixed(2)} font={font} color="#0f0f0f" />
              </>
            )}
            {/* Label do crosshair */}
            {chState.visible && font && (
              <>
                <Rect x={0} y={chY - 9} width={PRICE_AXIS_W} height={18} color="#6366f1" />
                <SkiaText x={4} y={chY + 4} text={chState.price >= 1000 ? chState.price.toFixed(0) : chState.price.toFixed(2)} font={font} color="#ffffff" />
              </>
            )}
          </Canvas>
          {priceZoom !== 1 && (
            <View style={{ position: 'absolute', bottom: PAD_BOT + 2, left: 4 }}>
              <Text style={{ color: '#6366f1', fontSize: 9 }}>{priceZoom.toFixed(1)}×</Text>
            </View>
          )}
        </View>
      </GestureDetector>
      </View>
      {rulerInfo && rulerState.visible && (() => {
        const ttWidth = 160;
        const midX = (rulerState.x1 + rulerState.x2) / 2;
        const ry1 = toY(rulerState.price1); const ry2 = toY(rulerState.price2);
        const rectBottom = Math.max(ry1, ry2);
        const rectTop = Math.min(ry1, ry2);
        const ttX = Math.max(4, Math.min(midX - ttWidth / 2, PLOT_W - ttWidth));
        const ttY = rectBottom + 54 < CHART_H ? rectBottom + 4 : rectTop - 54;
        return (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: ttX, top: ttY, backgroundColor: rulerInfo.isUp ? '#26a69add' : '#ef5350dd', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, minWidth: ttWidth }}>
            <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: 'bold', textAlign: 'center' }}>{rulerInfo.line1}</Text>
            <Text style={{ color: '#ffffff', fontSize: 11, textAlign: 'center' }}>{rulerInfo.line2}</Text>
          </View>
        );
      })()}
      {/* Tool buttons */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 8, paddingTop: 4, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity onPress={toggleRulerMode} style={{ backgroundColor: rulerMode ? '#6366f1' : '#1e293b', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ color: rulerMode ? '#ffffff' : '#94a3b8', fontSize: 10 }}>📏 Ruler</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={toggleFibMode} style={{ backgroundColor: (fibMode || fibState.visible) ? '#6366f1' : '#1e293b', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ color: (fibMode || fibState.visible) ? '#ffffff' : '#94a3b8', fontSize: 10 }}>〰 Fib</Text>
            </TouchableOpacity>
          </View>
          {footerLegend}
        </View>
        {footerAccessory}
      </View>
    </View>
  );
}
