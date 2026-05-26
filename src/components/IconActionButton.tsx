import React, { useRef } from 'react';
import { Animated, Pressable, StyleProp, StyleSheet, Text, TextStyle, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';

type IconActionButtonProps = {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  label?: string;
  onPress: () => void;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  hitSlop?: number;
  variant?: 'round' | 'pill';
};

export default function IconActionButton({
  icon,
  label,
  onPress,
  color = '#94a3b8',
  size = 19,
  style,
  textStyle,
  hitSlop = 8,
  variant = 'round',
}: IconActionButtonProps) {
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(1)).current;
  const isPill = variant === 'pill';

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
      onPress={onPress}
      onPressIn={() => animateTo(1)}
      onPressOut={() => animateTo(0)}
      hitSlop={hitSlop}
      style={({ pressed }) => [styles.button, isPill && styles.buttonPill, pressed && styles.buttonPressed, style]}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, styles.overlay, isPill && styles.overlayPill, { opacity: overlayOpacity }]}> 
        <Svg width="100%" height="100%">
          <Defs>
            <SvgLinearGradient id="iconButtonGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0" stopColor="#243b55" />
              <Stop offset="0.55" stopColor="#3b82f6" />
              <Stop offset="1" stopColor="#8b5cf6" />
            </SvgLinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" rx={isPill ? 16 : 18} fill="url(#iconButtonGradient)" />
        </Svg>
      </Animated.View>
      <Animated.View style={{ transform: [{ scale: iconScale }] }}>
        {label ? (
          <Text style={[styles.label, isPill && styles.labelPill, { color }, textStyle]}>{label}</Text>
        ) : icon ? (
          <Ionicons name={icon} size={size} color={color} />
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
  buttonPill: {
    width: undefined,
    minWidth: 88,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
  },
  buttonPressed: {
    borderColor: 'rgba(191, 219, 254, 0.42)',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.42,
    shadowRadius: 16,
    elevation: 11,
  },
  overlay: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  overlayPill: {
    borderRadius: 18,
  },
  label: {
    fontWeight: '600',
    fontSize: 13,
  },
  labelPill: {
    letterSpacing: 0.1,
  },
});