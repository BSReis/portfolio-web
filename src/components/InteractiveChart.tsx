import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Dimensions, ActivityIndicator, Text, Platform, useWindowDimensions } from 'react-native';
import {
  Canvas,
  Path,
  Skia,
  Line,
  Circle,
  Text as SkiaText,
  matchFont,
  Rect,
} from '@shopify/react-native-skia';
import {
  useSharedValue,
  runOnJS,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const CH_PAD_TOP = 16;
const CH_PAD_BOT = 30;
const PRICE_AXIS_W = 56;
const CHART_PLOT_W = SCREEN_WIDTH - PRICE_AXIS_W;

interface Props {
  prices: number[];
  timestamps: number[];
  initialPoints?: number;
  color: string;
  height?: number;
  loading?: boolean;
  overlayPrices?: number[];
  avgPrice?: number;
  renderOverlay?: (vp: number[], vt: number[], plotH: number, w: number, pMin: number, pMax: number) => React.ReactNode;
  renderTooltip?: (price: number, timestamp: number) => React.ReactNode;
  onVisibleChange?: (visiblePrices: number[], visibleTimestamps: number[]) => void;
  onCrosshairChange?: (visible: boolean, price: number, timestamp: number) => void;
}

export default function InteractiveChart({
  prices,
  timestamps,
  initialPoints = 30,
  color,
  height = 200,
  loading = false,
  overlayPrices,
  avgPrice,
  renderOverlay,
  renderTooltip,
  onVisibleChange,
  onCrosshairChange,
}: Props) {
  const CHART_H = height;
  const plotH = CHART_H - CH_PAD_TOP - CH_PAD_BOT;

  // ---- Zoom/pan state ----
  const [visiblePoints, setVisiblePoints] = useState(initialPoints);
  const [panOffset, setPanOffset] = useState(0);

  // ---- Crosshair (Reanimated shared values — no JS state updates per frame) ----
  const crosshairX = useSharedValue(-1);       // -1 = hidden
  const crosshairVisible = useSharedValue(false);
  const [chState, setChState] = useState({ visible: false, x: 0, price: 0, ts: 0 });

  // gesture shared values (accessible on UI thread)
  const pinchBase = useSharedValue(initialPoints);
  const panBase = useSharedValue(0);
  const crosshairActive = useSharedValue(false);

  // ---- Desktop web ----
  const { width: windowWidth } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && windowWidth >= 768;
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const [plotWidth, setPlotWidth] = useState(SCREEN_WIDTH - PRICE_AXIS_W);
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const CHART_PLOT_W = plotWidth; // shadows module-level; corrected by onLayout
  const chartDomRef = useRef<any>(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);

  // ---- Derived window ----
  const zoomMin = Math.max(5, Math.floor(initialPoints / 5));
  const zoomMax = Math.min(prices.length, initialPoints * 5);
  const clamped = Math.max(zoomMin, Math.min(visiblePoints, zoomMax));
  const maxOffset = Math.max(0, prices.length - clamped);
  const safeOffset = Math.min(panOffset, maxOffset);
  const startIdx = prices.length - clamped - safeOffset;
  // Mutable refs so event-handler closures always see latest values
  const clampedRef = useRef(clamped);
  const safeOffsetRef = useRef(safeOffset);
  const maxOffsetRef = useRef(maxOffset);
  clampedRef.current = clamped;
  safeOffsetRef.current = safeOffset;
  maxOffsetRef.current = maxOffset;

  const visiblePrices = useMemo(
    () => prices.slice(startIdx, startIdx + clamped),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startIdx, clamped],
  );
  const visibleTimestamps = useMemo(
    () => timestamps.slice(startIdx, startIdx + clamped),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startIdx, clamped],
  );

  useEffect(() => {
    onVisibleChange?.(visiblePrices, visibleTimestamps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startIdx, clamped]);

  // ---- Price range (memoized) ----
  const [priceMin, priceMax] = useMemo(() => {
    if (visiblePrices.length === 0) return [0, 1];
    let mn = visiblePrices[0], mx = visiblePrices[0];
    for (let i = 1; i < visiblePrices.length; i++) {
      if (visiblePrices[i] < mn) mn = visiblePrices[i];
      if (visiblePrices[i] > mx) mx = visiblePrices[i];
    }
    return [mn, mx];
  }, [visiblePrices]);
  const priceRange = priceMax - priceMin || 1;

  // ---- Coordinate helpers ----
  const toY = useCallback((p: number) =>
    CH_PAD_TOP + plotH * (1 - (p - priceMin) / priceRange),
    [plotH, priceMin, priceRange],
  );
  const toX = useCallback((i: number, len: number) =>
    (i / Math.max(1, len - 1)) * CHART_PLOT_W,
    [CHART_PLOT_W],
  );

  // ---- Build Skia paths (memoized) ----
  const mainPath = useMemo(() => {
    if (visiblePrices.length < 2) return null;
    const path = Skia.Path.Make();
    visiblePrices.forEach((p, i) => {
      const x = toX(i, visiblePrices.length);
      const y = toY(p);
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    });
    return path;
  }, [visiblePrices, toX, toY]);

  // Fill (gradient area below line)
  const fillPath = useMemo(() => {
    if (visiblePrices.length < 2) return null;
    const path = Skia.Path.Make();
    const firstX = toX(0, visiblePrices.length);
    const lastX = toX(visiblePrices.length - 1, visiblePrices.length);
    path.moveTo(firstX, CHART_H - CH_PAD_BOT);
    visiblePrices.forEach((p, i) => {
      path.lineTo(toX(i, visiblePrices.length), toY(p));
    });
    path.lineTo(lastX, CHART_H - CH_PAD_BOT);
    path.close();
    return path;
  }, [visiblePrices, toX, toY, CHART_H]);

  // Overlay path
  const visibleOverlayPrices = useMemo(() => {
    if (!overlayPrices || overlayPrices.length !== prices.length || prices.length === 0) return [];
    const raw = overlayPrices.slice(startIdx, startIdx + clamped);
    if (raw.length < 2 || visiblePrices.length < 2) return raw;
    const ovStart = raw[0], portStart = visiblePrices[0];
    if (!ovStart || !portStart) return raw;
    return raw.map((v) => (v / ovStart) * portStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startIdx, clamped, overlayPrices]);

  const overlayPath = useMemo(() => {
    if (visibleOverlayPrices.length < 2) return null;
    const path = Skia.Path.Make();
    visibleOverlayPrices.forEach((p, i) => {
      const x = toX(i, visibleOverlayPrices.length);
      const y = toY(p);
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    });
    return path;
  }, [visibleOverlayPrices, toX, toY]);

  // ---- X axis labels ----
  const labels = useMemo(() => {
    if (visibleTimestamps.length < 2) return [];
    const count = 5;
    const avgDiff = (visibleTimestamps[visibleTimestamps.length - 1] - visibleTimestamps[0]) / (visibleTimestamps.length - 1);
    const fmt = avgDiff > 20 * 86400
      ? (d: Date) => d.toLocaleDateString('pt-PT', { month: 'short', year: '2-digit' })
      : avgDiff > 3600
      ? (d: Date) => d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' })
      : (d: Date) => d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    return Array.from({ length: count }, (_, i) => {
      const idx = Math.round((i / (count - 1)) * (visibleTimestamps.length - 1));
      return { label: fmt(new Date(visibleTimestamps[idx] * 1000)), x: toX(idx, visibleTimestamps.length) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startIdx, clamped]);

  // ---- Price axis labels (right panel) ----
  const priceAxisLabels = useMemo(() => {
    const count = 6;
    return Array.from({ length: count }, (_, i) => {
      const p = priceMax - (priceRange * i) / (count - 1);
      const y = toY(p);
      if (y < CH_PAD_TOP || y > CHART_H - CH_PAD_BOT) return null;
      return { y, label: p >= 1000 ? p.toFixed(0) : p.toFixed(2) };
    }).filter(Boolean) as { y: number; label: string }[];
  }, [priceMin, priceMax, priceRange, toY, CHART_H]);

  // ---- Avg price dashed line ----
  const avgPricePath = useMemo(() => {
    if (avgPrice == null || avgPrice <= 0) return null;
    const y = toY(avgPrice);
    if (y < CH_PAD_TOP || y > CHART_H - CH_PAD_BOT) return null;
    const p = Skia.Path.Make();
    const dashLen = 7, gapLen = 4;
    let x = 0;
    while (x < CHART_PLOT_W) {
      p.moveTo(x, y);
      p.lineTo(Math.min(x + dashLen, CHART_PLOT_W), y);
      x += dashLen + gapLen;
    }
    return { path: p, y };
  }, [avgPrice, toY, CHART_H]);

  // Font for Skia text labels
  const font = useMemo(() => matchFont({ fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif', fontSize: 11, fontStyle: 'normal', fontWeight: 'normal' }), []);

  // ---- Crosshair data from x position ----
  const dataAtX = useCallback((x: number) => {
    const idx = visiblePrices.length > 1
      ? Math.max(0, Math.min(Math.round((x / CHART_PLOT_W) * (visiblePrices.length - 1)), visiblePrices.length - 1))
      : 0;
    return { price: visiblePrices[idx] ?? 0, ts: visibleTimestamps[idx] ?? 0, x: toX(idx, visiblePrices.length) };
  }, [visiblePrices, visibleTimestamps, toX]);

  // Combined JS callback: compute data + notify (called via runOnJS from worklets)
  const updateCrosshair = useCallback((px: number) => {
    const d = dataAtX(px);
    setChState({ visible: true, x: d.x, price: d.price, ts: d.ts });
    onCrosshairChange?.(true, d.price, d.ts);
  }, [dataAtX, onCrosshairChange]);

  const hideCrosshair = useCallback(() => {
    setChState(s => ({ ...s, visible: false }));
    onCrosshairChange?.(false, 0, 0);
  }, [onCrosshairChange]);

  // ---- Desktop web mouse handlers ----
  const handleMouseMove = useCallback((e: any) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    updateCrosshair(px);
    if (isDragging.current) {
      const deltaPx = e.clientX - dragStartX.current;
      const pxPerPoint = rect.width / Math.max(1, clampedRef.current);
      const delta = Math.round(-deltaPx / pxPerPoint);
      setPanOffset(Math.max(0, Math.min(dragStartOffset.current + delta, maxOffsetRef.current)));
    }
  }, [updateCrosshair]);

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

  // ---- Gestures (new Gesture API) ----
  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      'worklet';
      const newPts = Math.round(pinchBase.value / e.scale);
      runOnJS(setVisiblePoints)(Math.max(zoomMin, Math.min(newPts, zoomMax)));
    })
    .onEnd(() => {
      'worklet';
      pinchBase.value = clamped;
    });

  const panGesture = Gesture.Pan()
    .onBegin(() => {
      'worklet';
      panBase.value = safeOffset;
    })
    .onUpdate((e) => {
      'worklet';
      if (crosshairActive.value) {
        const px = Math.max(0, Math.min(e.x, SCREEN_WIDTH));
        crosshairX.value = px;
        runOnJS(updateCrosshair)(px);
        return;
      }
      const pxPerPoint = SCREEN_WIDTH / Math.max(1, clamped);
      const delta = Math.round(e.translationX / pxPerPoint);
      const newOffset = Math.max(0, Math.min(panBase.value + delta, maxOffset));
      runOnJS(setPanOffset)(newOffset);
    })
    .onEnd(() => {
      'worklet';
      if (crosshairActive.value) {
        crosshairActive.value = false;
        crosshairX.value = -1;
        crosshairVisible.value = false;
        runOnJS(hideCrosshair)();
      } else {
        panBase.value = safeOffset;
      }
    });

  const longPressGesture = Gesture.LongPress()
    .minDuration(400)
    .onStart((e) => {
      'worklet';
      crosshairActive.value = true;
      crosshairVisible.value = true;
      const px = Math.max(0, Math.min(e.x, SCREEN_WIDTH));
      crosshairX.value = px;
      runOnJS(updateCrosshair)(px);
    });

  const composed = Gesture.Simultaneous(longPressGesture, panGesture, pinchGesture);

  if (loading) return <ActivityIndicator color="#6366f1" style={{ height: CHART_H }} />;
  if (visiblePrices.length < 2) {
    return (
      <View style={{ height: CHART_H, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: '#475569' }}>Sem dados</Text>
      </View>
    );
  }

  const chY = chState.visible ? toY(chState.price) : -1;

  // Canvas + overlay — shared between desktop and mobile wrappers
  const chartCanvas = (
    <>
      <Canvas style={{ width: CHART_PLOT_W, height: CHART_H }}>
            {/* Grid lines */}
            {priceAxisLabels.map(({ y }, i) => (
              <Line key={`g${i}`} p1={{ x: 0, y }} p2={{ x: CHART_PLOT_W, y }} color="#1e293b" strokeWidth={1} />
            ))}
            {/* Fill area */}
            {fillPath && (
              <Path
                path={fillPath}
                color={`${color}22`}
                style="fill"
              />
            )}
            {/* Overlay line (e.g. S&P 500) */}
            {overlayPath && (
              <Path
                path={overlayPath}
                color="rgba(148,163,184,0.55)"
                style="stroke"
                strokeWidth={1.5}
              />
            )}
            {/* Main line */}
            {mainPath && (
              <Path
                path={mainPath}
                color={color}
                style="stroke"
                strokeWidth={2}
                strokeCap="round"
                strokeJoin="round"
              />
            )}
            {/* X axis labels */}
            {font && labels.map(({ label, x }, i) => (
              <SkiaText
                key={i}
                x={Math.min(x, CHART_PLOT_W - label.length * 5.5)}
                y={CHART_H - 6}
                text={label}
                font={font}
                color="#475569"
              />
            ))}
            {/* Crosshair */}
            {chState.visible && (
              <>
                <Line
                  p1={{ x: chState.x, y: CH_PAD_TOP }}
                  p2={{ x: chState.x, y: CHART_H - CH_PAD_BOT }}
                  color="#94a3b8"
                  strokeWidth={1}
                />
                <Line
                  p1={{ x: 0, y: chY }}
                  p2={{ x: CHART_PLOT_W, y: chY }}
                  color="#94a3b8"
                  strokeWidth={1}
                />
                <Circle cx={chState.x} cy={chY} r={5} color="#0f172a" />
                <Circle cx={chState.x} cy={chY} r={4} color="#6366f1" />
              </>
            )}
            {/* Avg price dashed line */}
            {avgPricePath && (
              <Path path={avgPricePath.path} color="#f59e0b" strokeWidth={1.5} style="stroke" />
            )}
          </Canvas>
          {renderOverlay?.(visiblePrices, visibleTimestamps, plotH, CHART_PLOT_W, priceMin, priceMax)}
    </>
  );

  return (
    <View onLayout={(e) => setPlotWidth(Math.max(10, e.nativeEvent.layout.width - PRICE_AXIS_W))}>
      <View style={{ flexDirection: 'row', height: CHART_H }}>
        {isDesktopWeb ? (
          <View
            ref={chartDomRef}
            style={{ width: CHART_PLOT_W, height: CHART_H, cursor: 'crosshair' } as any}
            {...({ onMouseMove: handleMouseMove, onMouseLeave: handleMouseLeave, onMouseDown: handleMouseDown, onMouseUp: handleMouseUp } as any)}
          >
            {chartCanvas}
          </View>
        ) : (
          <GestureDetector gesture={composed}>
            <View style={{ width: CHART_PLOT_W, height: CHART_H }}>
              {chartCanvas}
            </View>
          </GestureDetector>
        )}

        {/* Right price axis */}
        <View style={{ width: PRICE_AXIS_W, height: CHART_H, backgroundColor: '#0f0f0f', borderLeftWidth: 1, borderLeftColor: '#1e293b' }}>
          <Canvas style={{ width: PRICE_AXIS_W, height: CHART_H }}>
            {font && priceAxisLabels.map(({ y, label }, i) => (
              <SkiaText key={i} x={4} y={y + 4} text={label} font={font} color="#94a3b8" />
            ))}
            {avgPricePath && font && (() => {
              const label = avgPrice! >= 1000 ? avgPrice!.toFixed(0) : avgPrice!.toFixed(2);
              return (
                <>
                  <Rect x={0} y={avgPricePath.y - 9} width={PRICE_AXIS_W} height={18} color="#f59e0b" />
                  <SkiaText x={4} y={avgPricePath.y + 4} text={label} font={font} color="#0f0f0f" />
                </>
              );
            })()}
            {chState.visible && font && (
              <>
                <Rect x={0} y={chY - 9} width={PRICE_AXIS_W} height={18} color="#6366f1" />
                <SkiaText x={4} y={chY + 4} text={chState.price >= 1000 ? chState.price.toFixed(0) : chState.price.toFixed(2)} font={font} color="#ffffff" />
              </>
            )}
          </Canvas>
        </View>
      </View>
      {chState.visible && renderTooltip && (
        <View
          style={{
            position: 'absolute', top: 8, left: 16,
            backgroundColor: '#1e293b', borderRadius: 8,
            paddingHorizontal: 12, paddingVertical: 6,
          }}
          pointerEvents="none"
        >
          {renderTooltip(chState.price, chState.ts)}
        </View>
      )}
    </View>
  );
}
