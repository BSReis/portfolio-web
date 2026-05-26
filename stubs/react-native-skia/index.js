// Stub for @shopify/react-native-skia on web.
// The web chart files (InteractiveChart.web.tsx, CandlestickChart.web.tsx)
// use HTML Canvas 2D instead of Skia, so this module should never be imported.
// If it IS imported (e.g. from the non-web .tsx files), return harmless no-ops.
'use strict';

const View = require('react-native').View;
const noop = () => null;
const identity = (x) => x;

// Canvas component — renders nothing on web
function Canvas({ children, style }) {
  return null;
}

// Skia path factory — stub
const Skia = {
  Path: { Make: () => ({ moveTo: noop, lineTo: noop, addRect: noop, close: noop }) },
  Paint: { Make: () => ({}) },
  Font: noop,
  Typeface: { MakeFreeTypeFaceFromData: noop },
  TypefaceFontProvider: { Make: () => ({ registerFont: noop }) },
};

module.exports = {
  Canvas,
  Path: noop,
  Line: noop,
  Circle: noop,
  Rect: noop,
  Group: noop,
  Text: noop,
  Fill: noop,
  Blur: noop,
  Skia,
  matchFont: () => null,
  useCanvasRef: () => ({ current: null }),
  useSharedValueEffect: noop,
  BlendMode: {},
  PaintStyle: {},
  StrokeCap: {},
  StrokeJoin: {},
  TileMode: {},
  default: { Canvas, Skia },
};
