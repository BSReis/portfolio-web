import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import Svg, { Defs, Line, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';

type ChartType = 'line' | 'candle';

type Props = {
  value: ChartType;
  onChange: (next: ChartType) => void;
  size?: number;
};

function ChartTypeGlyph({ value, size }: { value: ChartType; size: number }) {
  const lineColor = value === 'line' ? '#f8fafc' : '#64748b';
  const candleColor = value === 'candle' ? '#f8fafc' : '#64748b';
  const glyphSize = Math.max(14, size - 16);

  return (
    <Svg width={glyphSize} height={glyphSize} viewBox="0 0 28 28" fill="none">
      <Line x1="5" y1="19" x2="10" y2="14" stroke={lineColor} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="10" y1="14" x2="15" y2="18" stroke={lineColor} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="15" y1="18" x2="23" y2="9" stroke={lineColor} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />

      <Line x1="8" y1="19" x2="8" y2="24" stroke={candleColor} strokeWidth="1.5" strokeLinecap="round" />
      <Rect x="6.3" y="20" width="3.4" height="4" rx="0.9" fill={candleColor} />

      <Line x1="13.8" y1="16" x2="13.8" y2="24" stroke={candleColor} strokeWidth="1.5" strokeLinecap="round" />
      <Rect x="12.1" y="17.2" width="3.4" height="6.2" rx="0.9" fill={candleColor} />

      <Line x1="19.6" y1="12.5" x2="19.6" y2="24" stroke={candleColor} strokeWidth="1.5" strokeLinecap="round" />
      <Rect x="17.9" y="14.2" width="3.4" height="8.3" rx="0.9" fill={candleColor} />
    </Svg>
  );
}

export default function ChartTypeToggleButton({ value, onChange, size = 36 }: Props) {
  const nextValue = value === 'line' ? 'candle' : 'line';
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(1)).current;
  const radius = size / 2;

  const animateTo = (toValue: number) => {
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue,
        duration: toValue ? 180 : 240,
        useNativeDriver: true,
      }),
      Animated.spring(iconScale, {
        toValue: toValue ? 0.94 : 1,
        tension: 220,
        friction: 18,
        useNativeDriver: true,
      }),
    ]).start();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value === 'line' ? 'Switch to candlestick chart' : 'Switch to line chart'}
      onPress={() => onChange(nextValue)}
      onPressIn={() => animateTo(1)}
      onPressOut={() => animateTo(0)}
      style={({ pressed }) => [styles.button, { width: size, height: size, borderRadius: radius }, pressed && styles.buttonPressed]}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, styles.overlay, { opacity: overlayOpacity }]}>
        <Svg width="100%" height="100%">
          <Defs>
            <SvgLinearGradient id="chartTypeToggleGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0" stopColor="#243b55" />
              <Stop offset="0.55" stopColor="#3b82f6" />
              <Stop offset="1" stopColor="#8b5cf6" />
            </SvgLinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" rx={radius} fill="url(#chartTypeToggleGradient)" />
        </Svg>
      </Animated.View>
      <Animated.View style={{ transform: [{ scale: iconScale }] }}>
        <ChartTypeGlyph value={value} size={size} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#162033',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.14)',
    shadowColor: '#020617',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 7,
  },
  buttonPressed: {
    borderColor: 'rgba(191, 219, 254, 0.42)',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.42,
    shadowRadius: 16,
    elevation: 11,
  },
  overlay: {
    borderRadius: 999,
    overflow: 'hidden',
  },
});