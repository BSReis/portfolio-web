/**
 * InteractiveChart — web version (HTML Canvas 2D API)
 * Replaces the Skia-based version for browser rendering.
 * Webpack picks this file automatically (.web.tsx priority).
 */
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Dimensions, ActivityIndicator, Text } from 'react-native';

const CH_PAD_TOP = 16;
const CH_PAD_BOT = 30;
const PRICE_AXIS_W = 56;

const fmtPrice = (p: number) =>
  p >= 1000
    ? p.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : p.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  height = 340,
  loading = false,
  overlayPrices,
  avgPrice,
  renderOverlay,
  renderTooltip,
  onVisibleChange,
  onCrosshairChange,
}: Props) {
  const CHART_H = height;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const axisCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<View>(null);

  const [containerWidth, setContainerWidth] = useState(
    Math.max(100, Dimensions.get('window').width - PRICE_AXIS_W)
  );
  const CHART_PLOT_W = containerWidth;
  const plotH = CHART_H - CH_PAD_TOP - CH_PAD_BOT;

  // ── Zoom / pan ──────────────────────────────────────────────────────────────
  const [visiblePoints, setVisiblePoints] = useState(initialPoints);
  const [panOffset, setPanOffset] = useState(0);

  const zoomMin = Math.max(5, Math.floor(initialPoints / 5));
  const zoomMax = Math.min(prices.length, initialPoints * 5);
  const clamped = Math.max(zoomMin, Math.min(visiblePoints, zoomMax));
  const maxOffset = Math.max(0, prices.length - clamped);
  const safeOffset = Math.min(panOffset, maxOffset);
  const startIdx = prices.length - clamped - safeOffset;

  const visiblePrices = useMemo(
    () => prices.slice(startIdx, startIdx + clamped),
    [startIdx, clamped, prices],
  );
  const visibleTimestamps = useMemo(
    () => timestamps.slice(startIdx, startIdx + clamped),
    [startIdx, clamped, timestamps],
  );

  useEffect(() => {
    onVisibleChange?.(visiblePrices, visibleTimestamps);
  }, [startIdx, clamped]); // eslint-disable-line react-hooks/exhaustive-deps
  // ── Vertical zoom + price offset ──────────────────────────────────────────
  const [vertZoom, setVertZoom] = useState(1.0);
  const [priceOffset, setPriceOffset] = useState(0);
  // ── Price range ─────────────────────────────────────────────────────────────
  const [priceMin, priceMax] = useMemo(() => {
    if (visiblePrices.length === 0) return [0, 1];
    let mn = visiblePrices[0], mx = visiblePrices[0];
    for (let i = 1; i < visiblePrices.length; i++) {
      if (visiblePrices[i] < mn) mn = visiblePrices[i];
      if (visiblePrices[i] > mx) mx = visiblePrices[i];
    }
    const mid = (mn + mx) / 2;
    const half = Math.max((mx - mn) / 2, 0.01);
    return [mid - half / vertZoom + priceOffset, mid + half / vertZoom + priceOffset];
  }, [visiblePrices, vertZoom, priceOffset]);
  const priceRange = priceMax - priceMin || 1;

  const toY = useCallback(
    (p: number) => CH_PAD_TOP + plotH * (1 - (p - priceMin) / priceRange),
    [plotH, priceMin, priceRange],
  );
  const toX = useCallback(
    (i: number, len: number) => (i / Math.max(1, len - 1)) * CHART_PLOT_W,
    [CHART_PLOT_W],
  );

  // ── Crosshair state ─────────────────────────────────────────────────────────
  const [chState, setChState] = useState({ visible: false, x: 0, price: 0, ts: 0 });

  const dataAtX = useCallback(
    (x: number) => {
      const idx = visiblePrices.length > 1
        ? Math.max(0, Math.min(Math.round((x / CHART_PLOT_W) * (visiblePrices.length - 1)), visiblePrices.length - 1))
        : 0;
      return { price: visiblePrices[idx] ?? 0, ts: visibleTimestamps[idx] ?? 0, x: toX(idx, visiblePrices.length) };
    },
    [visiblePrices, visibleTimestamps, toX, CHART_PLOT_W],
  );

  // ── Mouse drag (pan) state ──────────────────────────────────────────────────
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; baseOffset: number; basePriceOffset: number; pricePerPx: number; pxPerPoint: number; maxOff: number }>({
    active: false, startX: 0, startY: 0, baseOffset: 0, basePriceOffset: 0, pricePerPx: 1, pxPerPoint: 1, maxOff: 0,
  });

  // ── Axis / time labels ──────────────────────────────────────────────────────
  const fmtTs = useMemo<(d: Date) => string>(() => {
    if (visibleTimestamps.length < 2) return () => '';
    const avgDiff = (visibleTimestamps[visibleTimestamps.length - 1] - visibleTimestamps[0]) / (visibleTimestamps.length - 1);
    return avgDiff > 20 * 86400
      ? (d) => d.toLocaleDateString('pt-PT', { month: 'short', year: '2-digit' })
      : avgDiff > 3600
      ? (d) => d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' })
      : (d) => d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  }, [startIdx, clamped]); // eslint-disable-line react-hooks/exhaustive-deps

  const labels = useMemo(() => {
    if (visibleTimestamps.length < 2) return [];
    const count = 5;
    return Array.from({ length: count }, (_, i) => {
      const idx = Math.round((i / (count - 1)) * (visibleTimestamps.length - 1));
      return { label: fmtTs(new Date(visibleTimestamps[idx] * 1000)), x: toX(idx, visibleTimestamps.length) };
    });
  }, [fmtTs, startIdx, clamped, toX]); // eslint-disable-line react-hooks/exhaustive-deps

  const priceAxisLabels = useMemo(() => {
    const count = 6;
    return Array.from({ length: count }, (_, i) => {
      const p = priceMax - (priceRange * i) / (count - 1);
      const y = toY(p);
      if (y < CH_PAD_TOP || y > CHART_H - CH_PAD_BOT) return null;
      return { y, label: fmtPrice(p) };
    }).filter(Boolean) as { y: number; label: string }[];
  }, [priceMax, priceRange, toY, CHART_H]);

  // Normalized overlay prices (same scale as main)
  const visibleOverlayPrices = useMemo(() => {
    if (!overlayPrices || overlayPrices.length !== prices.length || prices.length === 0) return [];
    const raw = overlayPrices.slice(startIdx, startIdx + clamped);
    if (raw.length < 2 || visiblePrices.length < 2) return raw;
    const ovStart = raw[0], portStart = visiblePrices[0];
    if (!ovStart || !portStart) return raw;
    return raw.map((v) => (v / ovStart) * portStart);
  }, [startIdx, clamped, overlayPrices, prices.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Draw main chart canvas ──────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CHART_PLOT_W * dpr;
    canvas.height = CHART_H * dpr;
    canvas.style.width = `${CHART_PLOT_W}px`;
    canvas.style.height = `${CHART_H}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, CHART_PLOT_W, CHART_H);

    if (visiblePrices.length < 2) return;

    // Grid lines
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    priceAxisLabels.forEach(({ y }) => {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CHART_PLOT_W, y);
      ctx.stroke();
    });

    // Fill area
    ctx.beginPath();
    const firstX = toX(0, visiblePrices.length);
    const lastX = toX(visiblePrices.length - 1, visiblePrices.length);
    ctx.moveTo(firstX, CHART_H - CH_PAD_BOT);
    visiblePrices.forEach((p, i) => ctx.lineTo(toX(i, visiblePrices.length), toY(p)));
    ctx.lineTo(lastX, CHART_H - CH_PAD_BOT);
    ctx.closePath();
    const areaGrad = ctx.createLinearGradient(0, CH_PAD_TOP, 0, CHART_H - CH_PAD_BOT);
    areaGrad.addColorStop(0, `${color}66`);
    areaGrad.addColorStop(1, `${color}22`);
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // Overlay line
    if (visibleOverlayPrices.length >= 2) {
      ctx.beginPath();
      visibleOverlayPrices.forEach((p, i) => {
        const x = toX(i, visibleOverlayPrices.length);
        const y = toY(p);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = 'rgba(148,163,184,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Main line
    ctx.beginPath();
    visiblePrices.forEach((p, i) => {
      const x = toX(i, visiblePrices.length);
      const y = toY(p);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Avg price dashed line
    if (avgPrice != null && avgPrice > 0) {
      const avgY = toY(avgPrice);
      if (avgY >= CH_PAD_TOP && avgY <= CHART_H - CH_PAD_BOT) {
        ctx.setLineDash([7, 4]);
        ctx.beginPath();
        ctx.moveTo(0, avgY);
        ctx.lineTo(CHART_PLOT_W, avgY);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // X axis labels
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#475569';
    ctx.textBaseline = 'bottom';
    labels.forEach(({ label, x }) => {
      const measured = ctx.measureText(label).width;
      const lx = Math.min(x, CHART_PLOT_W - measured);
      ctx.fillText(label, lx, CHART_H - 2);
    });

    // Crosshair
    if (chState.visible) {
      const chY = toY(chState.price);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chState.x, CH_PAD_TOP);
      ctx.lineTo(chState.x, CHART_H - CH_PAD_BOT);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, chY);
      ctx.lineTo(CHART_PLOT_W, chY);
      ctx.stroke();
      // Dot
      ctx.beginPath();
      ctx.arc(chState.x, chY, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(chState.x, chY, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#6366f1';
      ctx.fill();
      // Date badge at bottom of vertical line
      if (chState.ts > 0) {
        const dateStr = fmtTs(new Date(chState.ts * 1000));
        ctx.font = 'bold 11px sans-serif';
        const tw = ctx.measureText(dateStr).width;
        const padX = 6, badgeH = 16;
        const bw = tw + padX * 2;
        const bx = Math.max(0, Math.min(chState.x - bw / 2, CHART_PLOT_W - bw));
        const by = CHART_H - CH_PAD_BOT + 4;
        ctx.fillStyle = '#6366f1';
        ctx.fillRect(bx, by, bw, badgeH);
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(dateStr, bx + padX, by + badgeH / 2);
      }
    }
  }, [visiblePrices, visibleOverlayPrices, labels, priceAxisLabels, toX, toY, color, avgPrice, chState, fmtTs, CHART_PLOT_W, CHART_H]);

  // ── Draw price axis canvas ──────────────────────────────────────────────────
  useEffect(() => {
    const canvas = axisCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = PRICE_AXIS_W * dpr;
    canvas.height = CHART_H * dpr;
    canvas.style.width = `${PRICE_AXIS_W}px`;
    canvas.style.height = `${CHART_H}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, PRICE_AXIS_W, CHART_H);

    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'middle';

    // Price labels
    ctx.fillStyle = '#94a3b8';
    priceAxisLabels.forEach(({ y, label }) => ctx.fillText(label, 4, y));

    // Avg price tag
    if (avgPrice != null && avgPrice > 0) {
      const avgY = toY(avgPrice);
      if (avgY >= CH_PAD_TOP && avgY <= CHART_H - CH_PAD_BOT) {
        const label = fmtPrice(avgPrice);
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(0, avgY - 9, PRICE_AXIS_W, 18);
        ctx.fillStyle = '#0f0f0f';
        ctx.fillText(label, 4, avgY);
      }
    }

    // Crosshair price tag
    if (chState.visible) {
      const chY = toY(chState.price);
      const label = fmtPrice(chState.price);
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(0, chY - 9, PRICE_AXIS_W, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, 4, chY);
    }
  }, [priceAxisLabels, avgPrice, chState, toY, CHART_H]);

  // ── Mouse event handlers ────────────────────────────────────────────────────
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const d = dataAtX(x);
      setChState({ visible: true, x: d.x, price: d.price, ts: d.ts });
      onCrosshairChange?.(true, d.price, d.ts);
    },
    [dataAtX, onCrosshairChange],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = e.currentTarget as HTMLCanvasElement;
      dragRef.current.active = true;
      dragRef.current.startX = e.clientX;
      dragRef.current.startY = e.clientY;
      dragRef.current.baseOffset = safeOffset;
      dragRef.current.basePriceOffset = priceOffset;
      dragRef.current.pricePerPx = priceRange / plotH;
      dragRef.current.pxPerPoint = CHART_PLOT_W / Math.max(1, clamped);
      dragRef.current.maxOff = maxOffset;
      canvas.style.cursor = 'grabbing';
      const onDocMove = (ev: MouseEvent) => {
        const dx = Math.round((ev.clientX - dragRef.current.startX) / dragRef.current.pxPerPoint);
        setPanOffset(Math.max(0, Math.min(dragRef.current.baseOffset + dx, dragRef.current.maxOff)));
        const dy = ev.clientY - dragRef.current.startY;
        setPriceOffset(dragRef.current.basePriceOffset + dy * dragRef.current.pricePerPx);
      };
      const onDocUp = () => {
        dragRef.current.active = false;
        canvas.style.cursor = 'crosshair';
        document.removeEventListener('mousemove', onDocMove);
        document.removeEventListener('mouseup', onDocUp);
      };
      document.addEventListener('mousemove', onDocMove);
      document.addEventListener('mouseup', onDocUp);
    },
    [safeOffset, priceOffset, priceRange, plotH, clamped, maxOffset, CHART_PLOT_W],
  );

  const handleMouseLeave = useCallback(() => {
    if (dragRef.current.active) return;
    setChState(s => ({ ...s, visible: false }));
    onCrosshairChange?.(false, 0, 0);
  }, [onCrosshairChange]);

  // Non-passive wheel listeners — must be added via useEffect to call preventDefault
  useEffect(() => {
    const chartCanvas = canvasRef.current;
    const axisCanvas = axisCanvasRef.current;
    if (!chartCanvas || !axisCanvas) return;
    const onChartWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY > 0 ? 1.15 : 0.87;
      setVisiblePoints(v => Math.max(zoomMin, Math.min(Math.round(v * factor), zoomMax)));
    };
    const onAxisWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY > 0 ? 0.82 : 1.22;
      setVertZoom(v => Math.max(0.15, Math.min(v * factor, 30)));
    };
    chartCanvas.addEventListener('wheel', onChartWheel, { passive: false });
    axisCanvas.addEventListener('wheel', onAxisWheel, { passive: false });
    return () => {
      chartCanvas.removeEventListener('wheel', onChartWheel);
      axisCanvas.removeEventListener('wheel', onAxisWheel);
    };
  }, [zoomMin, zoomMax, loading, prices.length]);

  // ── Early returns ───────────────────────────────────────────────────────────
  if (loading) return <ActivityIndicator color="#6366f1" style={{ height: CHART_H } as any} />;
  if (visiblePrices.length < 2) {
    return (
      <View style={{ height: CHART_H, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: '#475569' }}>Sem dados</Text>
      </View>
    );
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', height: CHART_H } as any}>
        <View
          ref={containerRef as any}
          style={{ flex: 1, height: CHART_H } as any}
          onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        >
          <canvas
            ref={canvasRef}
            style={{ display: 'block', cursor: 'crosshair', userSelect: 'none' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}>
            {renderOverlay?.(visiblePrices, visibleTimestamps, plotH, CHART_PLOT_W, priceMin, priceMax)}
          </div>
        </View>
        <View style={{ width: PRICE_AXIS_W, height: CHART_H, backgroundColor: '#0f0f0f', borderLeftWidth: 1, borderLeftColor: '#1e293b' } as any}>
          <canvas ref={axisCanvasRef} style={{ display: 'block', cursor: 'ns-resize' }} />
        </View>
      </View>
      {chState.visible && renderTooltip && (
        <View
          style={{
            position: 'absolute', top: 8, left: 16,
            backgroundColor: '#1e293b', borderRadius: 8,
            paddingHorizontal: 12, paddingVertical: 6,
          } as any}
          pointerEvents="none"
        >
          {renderTooltip(chState.price, chState.ts)}
        </View>
      )}
    </View>
  );
}
