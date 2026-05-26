/**
 * CandlestickChart — web version (HTML Canvas 2D API)
 * Replaces the Skia-based version for browser rendering.
 * Webpack picks this file automatically (.web.tsx priority).
 */
import React, { ReactNode, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Dimensions, ActivityIndicator } from 'react-native';

const PAD_TOP = 16;
const PAD_BOT = 30;
const PRICE_AXIS_W = 44;

const fmtPrice = (p: number) =>
  p >= 1000
    ? p.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : p.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  tool?: 'none' | 'ruler' | 'fib';
  onCrosshairChange?: (visible: boolean, price: number, timestamp: number) => void;
  onVisibleChange?: (closes: number[], timestamps: number[]) => void;
}

export default function CandlestickChart({
  open, high, low, close, timestamps,
  initialPoints = 60,
  height = 380,
  loading = false,
  avgPrice,
  footerLegend,
  footerAccessory,
  tool = 'none',
  onCrosshairChange,
  onVisibleChange,
}: Props) {
  const CHART_H = height;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const axisCanvasRef = useRef<HTMLCanvasElement>(null);

  const [containerWidth, setContainerWidth] = useState(
    Math.max(100, Dimensions.get('window').width - PRICE_AXIS_W)
  );
  const PLOT_W = containerWidth;
  const plotH = CHART_H - PAD_TOP - PAD_BOT;

  // ── Zoom / pan ──────────────────────────────────────────────────────────────
  const [visiblePoints, setVisiblePoints] = useState(initialPoints);
  const [panOffset, setPanOffset] = useState(0);

  useEffect(() => {
    setVisiblePoints(initialPoints);
    setPanOffset(0);
  }, [initialPoints]);

  const total = close.length;
  const zoomMin = Math.max(5, Math.floor(initialPoints / 6));
  const zoomMax = Math.min(total, initialPoints * 4);
  const clamped = Math.max(zoomMin, Math.min(visiblePoints, zoomMax));
  const maxOffset = Math.max(0, total - clamped);
  const safeOffset = Math.min(panOffset, maxOffset);
  const startIdx = total - clamped - safeOffset;

  const visibleClose = useMemo(() => close.slice(startIdx, startIdx + clamped), [startIdx, clamped, close]);
  const visibleHigh = useMemo(() => high.slice(startIdx, startIdx + clamped), [startIdx, clamped, high]);
  const visibleLow = useMemo(() => low.slice(startIdx, startIdx + clamped), [startIdx, clamped, low]);
  const visibleOpen = useMemo(() => open.slice(startIdx, startIdx + clamped), [startIdx, clamped, open]);
  const visibleTs = useMemo(() => timestamps.slice(startIdx, startIdx + clamped), [startIdx, clamped, timestamps]);

  useEffect(() => {
    if (visibleClose.length > 0) onVisibleChange?.(visibleClose, visibleTs);
  }, [visibleClose, visibleTs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Vertical zoom + price offset ─────────────────────────────────────────
  const [vertZoom, setVertZoom] = useState(1.0);
  const [priceOffset, setPriceOffset] = useState(0);

  // ── Price range ──────────────────────────────────────────────────────
  const [priceMin, priceMax] = useMemo(() => {
    if (visibleHigh.length === 0) return [0, 1];
    let mn = visibleLow[0], mx = visibleHigh[0];
    for (let i = 1; i < visibleHigh.length; i++) {
      if (visibleLow[i] < mn) mn = visibleLow[i];
      if (visibleHigh[i] > mx) mx = visibleHigh[i];
    }
    const mid = (mn + mx) / 2;
    const half = Math.max((mx - mn) / 2, 0.01);
    return [mid - half / vertZoom + priceOffset, mid + half / vertZoom + priceOffset];
  }, [visibleHigh, visibleLow, vertZoom, priceOffset]);
  const priceRange = priceMax - priceMin || 1;

  const toY = useCallback(
    (p: number) => PAD_TOP + plotH * (1 - (p - priceMin) / priceRange),
    [plotH, priceMin, priceRange],
  );
  const toX = useCallback(
    (i: number) => (i / Math.max(1, clamped - 1)) * PLOT_W,
    [clamped, PLOT_W],
  );
  const candleW = useMemo(() => Math.max(1, Math.floor((PLOT_W / clamped) * 0.7)), [clamped, PLOT_W]);

  // ── Crosshair state ─────────────────────────────────────────────────────────
  const [chState, setChState] = useState({ visible: false, x: 0, price: 0, ts: 0 });

  // ── Tool state (ruler / fibonacci) ──────────────────────────────────────────
  const [toolAnchor, setToolAnchor] = useState<{ px: number; price: number } | null>(null);
  const [toolFinal, setToolFinal] = useState<{ px1: number; price1: number; px2: number; price2: number } | null>(null);
  const [toolLive, setToolLive] = useState<{ px: number; price: number } | null>(null);

  // Reset tool state whenever the active tool changes
  useEffect(() => {
    setToolAnchor(null);
    setToolFinal(null);
    setToolLive(null);
  }, [tool]);

  // Price → Y coordinate (inverse of toY)
  const yToPrice = useCallback(
    (y: number) => priceMax - ((y - PAD_TOP) / plotH) * priceRange,
    [priceMax, priceRange, plotH],
  );

  const priceLabels = useMemo(() => {
    const count = 6;
    return Array.from({ length: count }, (_, i) => {
      const p = priceMax - (priceRange * i) / (count - 1);
      const y = toY(p);
      if (y < PAD_TOP || y > CHART_H - PAD_BOT) return null;
      return { y, label: fmtPrice(p) };
    }).filter(Boolean) as { y: number; label: string }[];
  }, [priceMin, priceMax, priceRange, toY, CHART_H]);

  // X axis time labels
  const fmtTs = useMemo<(d: Date) => string>(() => {
    if (visibleTs.length < 2) return () => '';
    const avgDiff = (visibleTs[visibleTs.length - 1] - visibleTs[0]) / (visibleTs.length - 1);
    return avgDiff > 20 * 86400
      ? (d) => d.toLocaleDateString('pt-PT', { month: 'short', year: '2-digit' })
      : avgDiff > 3600
      ? (d) => d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' })
      : (d) => d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  }, [startIdx, clamped]); // eslint-disable-line react-hooks/exhaustive-deps

  const timeLabels = useMemo(() => {
    if (visibleTs.length < 2) return [];
    const count = 5;
    return Array.from({ length: count }, (_, i) => {
      const idx = Math.round((i / (count - 1)) * (visibleTs.length - 1));
      return { label: fmtTs(new Date(visibleTs[idx] * 1000)), x: toX(idx) };
    });
  }, [fmtTs, visibleTs, toX, startIdx, clamped]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Draw candlestick canvas ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || visibleClose.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = PLOT_W * dpr;
    canvas.height = CHART_H * dpr;
    canvas.style.width = `${PLOT_W}px`;
    canvas.style.height = `${CHART_H}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, PLOT_W, CHART_H);

    const halfW = candleW / 2;

    // Grid lines
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    priceLabels.forEach(({ y }) => {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PLOT_W, y); ctx.stroke();
    });

    // Candles
    visibleClose.forEach((c, i) => {
      const o = visibleOpen[i];
      const h = visibleHigh[i];
      const l = visibleLow[i];
      const cx = toX(i);
      const isBull = c >= o;
      const bullColor = '#26a69a';
      const bearColor = '#ef5350';
      const col = isBull ? bullColor : bearColor;

      // Wick
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, toY(h));
      ctx.lineTo(cx, toY(l));
      ctx.stroke();

      // Body
      const yO = toY(o);
      const yC = toY(c);
      const top = Math.min(yO, yC);
      const bodyH = Math.max(1, Math.abs(yC - yO));
      ctx.fillStyle = col;
      ctx.fillRect(cx - halfW, top, candleW, bodyH);
    });

    // Avg price dashed
    if (avgPrice != null && avgPrice > 0) {
      const avgY = toY(avgPrice);
      if (avgY >= PAD_TOP && avgY <= CHART_H - PAD_BOT) {
        ctx.setLineDash([7, 4]);
        ctx.beginPath();
        ctx.moveTo(0, avgY); ctx.lineTo(PLOT_W, avgY);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Time labels
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#475569';
    ctx.textBaseline = 'bottom';
    timeLabels.forEach(({ label, x }) => {
      const measured = ctx.measureText(label).width;
      ctx.fillText(label, Math.min(x, PLOT_W - measured), CHART_H - 2);
    });

    // Crosshair
    if (chState.visible) {
      const chY = toY(chState.price);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(chState.x, PAD_TOP); ctx.lineTo(chState.x, CHART_H - PAD_BOT); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, chY); ctx.lineTo(PLOT_W, chY); ctx.stroke();
      // Date badge at bottom of vertical line
      if (chState.ts > 0) {
        const dateStr = fmtTs(new Date(chState.ts * 1000));
        ctx.font = 'bold 11px sans-serif';
        const tw = ctx.measureText(dateStr).width;
        const padX = 6, badgeH = 16;
        const bw = tw + padX * 2;
        const bx = Math.max(0, Math.min(chState.x - bw / 2, PLOT_W - bw));
        const by = CHART_H - PAD_BOT + 4;
        ctx.fillStyle = '#6366f1';
        ctx.fillRect(bx, by, bw, badgeH);
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(dateStr, bx + padX, by + badgeH / 2);
      }
    }

    // ── Tool overlays (ruler / fibonacci) ──────────────────────────────────
    if (tool !== 'none') {
      const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
      const FIB_COLORS = ['#64748b', '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#22c55e', '#64748b'];

      const drawRuler = (px1: number, pr1: number, px2: number, pr2: number, draft: boolean) => {
        const y1 = toY(pr1);
        const y2 = toY(pr2);
        const lx = Math.min(px1, px2);
        const rx = Math.max(px1, px2);
        const ty = Math.min(y1, y2);
        const by2 = Math.max(y1, y2);
        const isUp = pr2 > pr1;
        const col = isUp ? '#22c55e' : '#ef4444';
        ctx.fillStyle = isUp ? `rgba(34,197,94,${draft ? 0.07 : 0.12})` : `rgba(239,68,68,${draft ? 0.07 : 0.12})`;
        ctx.fillRect(lx, ty, rx - lx, by2 - ty);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.setLineDash(draft ? [4, 3] : []);
        ctx.strokeRect(lx, ty, rx - lx, by2 - ty);
        ctx.setLineDash([]);
        if (!draft && rx - lx > 4) {
          const priceDiff = pr2 - pr1;
          const pricePct = Math.abs(pr1) > 0 ? (priceDiff / pr1) * 100 : 0;
          const sign = priceDiff >= 0 ? '+' : '';
          const lbl = `${sign}${Math.abs(priceDiff).toFixed(2)} (${sign}${pricePct.toFixed(2)}%)`;
          ctx.font = 'bold 11px sans-serif';
          const tw2 = ctx.measureText(lbl).width;
          const midX = (lx + rx) / 2;
          const midY = (ty + by2) / 2;
          ctx.fillStyle = 'rgba(15,15,15,0.8)';
          ctx.fillRect(midX - tw2 / 2 - 4, midY - 9, tw2 + 8, 18);
          ctx.fillStyle = col;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'center';
          ctx.fillText(lbl, midX, midY);
          ctx.textAlign = 'left';
        }
      };

      const drawFib = (px1: number, pr1: number, px2: number, pr2: number, draft: boolean) => {
        const high = Math.max(pr1, pr2);
        const low = Math.min(pr1, pr2);
        const range = high - low;
        if (range <= 0) return;
        FIB_LEVELS.forEach((level, i) => {
          const price = high - level * range;
          const y = toY(price);
          if (y < PAD_TOP - 4 || y > CHART_H - PAD_BOT + 4) return;
          ctx.strokeStyle = FIB_COLORS[i];
          ctx.lineWidth = draft ? 0.8 : 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(PLOT_W, y);
          ctx.stroke();
          ctx.setLineDash([]);
          if (!draft) {
            const lbl = `${(level * 100).toFixed(1)}%  ${fmtPrice(price)}`;
            ctx.font = '10px sans-serif';
            ctx.fillStyle = FIB_COLORS[i];
            ctx.textBaseline = 'bottom';
            ctx.fillText(lbl, 4, y - 1);
          }
        });
      };

      if (tool === 'ruler') {
        if (toolFinal) {
          drawRuler(toolFinal.px1, toolFinal.price1, toolFinal.px2, toolFinal.price2, false);
        } else if (toolAnchor && toolLive) {
          drawRuler(toolAnchor.px, toolAnchor.price, toolLive.px, toolLive.price, true);
        }
        if (toolAnchor) {
          ctx.fillStyle = '#94a3b8';
          ctx.beginPath();
          ctx.arc(toolAnchor.px, toY(toolAnchor.price), 4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (tool === 'fib') {
        if (toolFinal) {
          drawFib(toolFinal.px1, toolFinal.price1, toolFinal.px2, toolFinal.price2, false);
        } else if (toolAnchor && toolLive) {
          drawFib(toolAnchor.px, toolAnchor.price, toolLive.px, toolLive.price, true);
        }
        if (toolAnchor) {
          ctx.fillStyle = '#94a3b8';
          ctx.beginPath();
          ctx.arc(toolAnchor.px, toY(toolAnchor.price), 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }, [visibleClose, visibleOpen, visibleHigh, visibleLow, priceLabels, timeLabels, toX, toY, candleW, avgPrice, chState, fmtTs, PLOT_W, CHART_H, tool, toolAnchor, toolFinal, toolLive]);

  // ── Draw axis canvas ────────────────────────────────────────────────────────
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
    ctx.fillStyle = '#94a3b8';
    priceLabels.forEach(({ y, label }) => ctx.fillText(label, 4, y));

    if (avgPrice != null && avgPrice > 0) {
      const avgY = toY(avgPrice);
      if (avgY >= PAD_TOP && avgY <= CHART_H - PAD_BOT) {
        const label = fmtPrice(avgPrice);
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(0, avgY - 9, PRICE_AXIS_W, 18);
        ctx.fillStyle = '#0f0f0f';
        ctx.fillText(label, 4, avgY);
      }
    }
    if (chState.visible) {
      const chY = toY(chState.price);
      const label = fmtPrice(chState.price);
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(0, chY - 9, PRICE_AXIS_W, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, 4, chY);
    }
  }, [priceLabels, avgPrice, chState, toY, CHART_H]);

  // ── Mouse drag state ────────────────────────────────────────────────────────
  const drag = useRef<{ active: boolean; startX: number; startY: number; baseOffset: number; basePriceOffset: number; pricePerPx: number; pxPerPoint: number; maxOff: number }>({
    active: false, startX: 0, startY: 0, baseOffset: 0, basePriceOffset: 0, pricePerPx: 1, pxPerPoint: 1, maxOff: 0,
  });

  const dataAtX = useCallback((x: number) => {
    const idx = visibleClose.length > 1
      ? Math.max(0, Math.min(Math.round((x / PLOT_W) * (visibleClose.length - 1)), visibleClose.length - 1))
      : 0;
    return { price: (visibleOpen[idx] + visibleClose[idx]) / 2 || 0, ts: visibleTs[idx] ?? 0, x: toX(idx) };
  }, [visibleClose, visibleOpen, visibleTs, toX, PLOT_W]);

  // Hover: crosshair appears immediately
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (tool !== 'none') {
      // In tool mode: update live preview position and crosshair
      if (toolAnchor) setToolLive({ px: mx, price: yToPrice(my) });
      const d = dataAtX(mx);
      setChState({ visible: true, x: d.x, price: d.price, ts: d.ts });
      onCrosshairChange?.(true, d.price, d.ts);
      return;
    }
    const d = dataAtX(mx);
    setChState({ visible: true, x: d.x, price: d.price, ts: d.ts });
    onCrosshairChange?.(true, d.price, d.ts);
  }, [dataAtX, onCrosshairChange, tool, toolAnchor, yToPrice]);

  // Click handler for tool mode
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool === 'none') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const price = yToPrice(my);
    if (!toolAnchor) {
      setToolAnchor({ px: mx, price });
      setToolFinal(null);
      setToolLive({ px: mx, price });
    } else {
      setToolFinal({ px1: toolAnchor.px, price1: toolAnchor.price, px2: mx, price2: price });
      setToolAnchor(null);
      setToolLive(null);
    }
  }, [tool, toolAnchor, yToPrice]);

  // Drag: document-level so pan works even when mouse exits canvas
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== 'none') return; // disable drag in tool mode
    const canvas = e.currentTarget as HTMLCanvasElement;
    drag.current.active = true;
    drag.current.startX = e.clientX;
    drag.current.startY = e.clientY;
    drag.current.baseOffset = safeOffset;
    drag.current.basePriceOffset = priceOffset;
    drag.current.pricePerPx = priceRange / plotH;
    drag.current.pxPerPoint = PLOT_W / Math.max(1, clamped);
    drag.current.maxOff = maxOffset;
    canvas.style.cursor = 'grabbing';
    const onDocMove = (ev: MouseEvent) => {
      const dx = Math.round((ev.clientX - drag.current.startX) / drag.current.pxPerPoint);
      setPanOffset(Math.max(0, Math.min(drag.current.baseOffset + dx, drag.current.maxOff)));
      const dy = ev.clientY - drag.current.startY;
      setPriceOffset(drag.current.basePriceOffset + dy * drag.current.pricePerPx);
    };
    const onDocUp = () => {
      drag.current.active = false;
      canvas.style.cursor = 'crosshair';
      document.removeEventListener('mousemove', onDocMove);
      document.removeEventListener('mouseup', onDocUp);
    };
    document.addEventListener('mousemove', onDocMove);
    document.addEventListener('mouseup', onDocUp);
  }, [safeOffset, priceOffset, priceRange, plotH, clamped, maxOffset, PLOT_W, tool]);

  const handleMouseLeave = useCallback(() => {
    if (drag.current.active) return;
    setChState(s => ({ ...s, visible: false }));
    onCrosshairChange?.(false, 0, 0);
  }, [onCrosshairChange]);

  // Non-passive wheel: chart = horizontal zoom, axis = vertical zoom
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
  }, [zoomMin, zoomMax, loading, close.length]);

  if (loading) return <ActivityIndicator color="#6366f1" style={{ height: CHART_H } as any} />;
  if (visibleClose.length < 2) {
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
          style={{ flex: 1, height: CHART_H } as any}
          onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        >
          <canvas
            ref={canvasRef}
            style={{ display: 'block', cursor: 'crosshair', userSelect: 'none' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
          />
        </View>
        <View style={{ width: PRICE_AXIS_W, height: CHART_H, backgroundColor: '#0f0f0f', borderLeftWidth: 1, borderLeftColor: '#1e293b' } as any}>
          <canvas ref={axisCanvasRef} style={{ display: 'block', cursor: 'ns-resize' }} />
        </View>
      </View>
      {(footerLegend || footerAccessory) && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8, paddingTop: 4 } as any}>
          {footerLegend}
          {footerAccessory}
        </View>
      )}
    </View>
  );
}
