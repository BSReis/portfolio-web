import React from 'react';
import { View, ViewStyle, Platform } from 'react-native';

const TINT_COLOR: Record<'neutral' | 'green' | 'red', string> = {
  neutral: 'rgba(71,85,105,0.85)',  // slate-600
  green:   'rgba(22,101,52,0.82)',  // green-800
  red:     'rgba(153,27,27,0.82)',  // red-800
};

export function BlurValue({
  hidden,
  children,
  style,
  tint = 'neutral',
}: {
  hidden: boolean;
  children: React.ReactNode;
  style?: ViewStyle;
  tint?: 'neutral' | 'green' | 'red';
}) {
  if (!hidden) return <>{children}</>;

  if (Platform.OS === 'web') {
    // Apply blur to the pill directly — no overflow:hidden so the Gaussian blur
    // fades out naturally at the edges instead of being hard-clipped.
    return (
      <div style={{ display: 'inline-flex' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            background: TINT_COLOR[tint],
            borderRadius: '9999px',
            filter: 'blur(9px)',
            padding: '1px 6px',
          }}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <View style={[{ overflow: 'hidden', borderRadius: 50 }, style]}>
      <View style={{ backgroundColor: TINT_COLOR[tint], borderRadius: 50, filter: [{ blur: 8 }] } as unknown as ViewStyle}>
        {children}
      </View>
    </View>
  );
}
