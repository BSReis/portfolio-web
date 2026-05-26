'use strict';
// Web stub for react-native-reanimated v4
// Does NOT import from react-native (avoids SSR module resolution issues)
const React = require('react');

function useSharedValue(initial) {
  const ref = React.useRef(initial);
  return React.useMemo(function() {
    return {
      get value() { return ref.current; },
      set value(v) { ref.current = v; },
      modify: function(fn) { ref.current = fn(ref.current); },
      addListener: function() {},
      removeListener: function() {},
    };
  }, []);
}
function useDerivedValue(fn) { return useSharedValue(fn()); }
function useAnimatedStyle(fn) { return fn(); }
function useAnimatedScrollHandler() { return {}; }
function useAnimatedGestureHandler() { return {}; }
function useAnimatedRef() { return React.createRef(); }
function useAnimatedReaction() {}
function useScrollViewOffset() { return useSharedValue(0); }
function runOnJS(fn) { return fn; }
function runOnUI(fn) { return function() { return fn.apply(this, arguments); }; }
function withTiming(value) { return value; }
function withSpring(value) { return value; }
function withDelay(_, a) { return a; }
function withRepeat(a) { return a; }
function withSequence() { var args = Array.prototype.slice.call(arguments); return args[args.length - 1]; }
function withDecay() { return 0; }
function cancelAnimation() {}
function interpolate(value, inputRange, outputRange) {
  if (inputRange.length < 2) return outputRange[0] || 0;
  var ratio = (value - inputRange[0]) / (inputRange[1] - inputRange[0]);
  return (outputRange[0] || 0) + ratio * ((outputRange[1] || 0) - (outputRange[0] || 0));
}
function interpolateColor(value, inputRange, outputRange) { return outputRange[0]; }
function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }
function scrollTo() {}
function measure() { return { x: 0, y: 0, width: 0, height: 0, pageX: 0, pageY: 0 }; }
function setNativeProps() {}
function createAnimatedComponent(Component) { return Component; }

var Easing = {
  linear: function(t) { return t; },
  ease: function(t) { return t; },
  quad: function(t) { return t * t; },
  cubic: function(t) { return t * t * t; },
  poly: function(n) { return function(t) { return Math.pow(t, n); }; },
  sin: function(t) { return 1 - Math.cos(t * Math.PI / 2); },
  circle: function(t) { return 1 - Math.sqrt(1 - t * t); },
  exp: function(t) { return Math.pow(2, 10 * (t - 1)); },
  elastic: function() { return function(t) { return t; }; },
  back: function() { return function(t) { return t; }; },
  bounce: function(t) { return t; },
  bezier: function() { return function(t) { return t; }; },
  in: function(fn) { return fn; },
  out: function(fn) { return function(t) { return 1 - fn(1 - t); }; },
  inOut: function(fn) { return fn; },
};

var Animated = {
  View: 'div',
  Text: 'span',
  ScrollView: 'div',
  FlatList: 'div',
  Image: 'img',
  createAnimatedComponent: createAnimatedComponent,
};

module.exports = {
  useSharedValue: useSharedValue,
  useDerivedValue: useDerivedValue,
  useAnimatedStyle: useAnimatedStyle,
  useAnimatedScrollHandler: useAnimatedScrollHandler,
  useAnimatedGestureHandler: useAnimatedGestureHandler,
  useAnimatedRef: useAnimatedRef,
  useAnimatedReaction: useAnimatedReaction,
  useScrollViewOffset: useScrollViewOffset,
  runOnJS: runOnJS,
  runOnUI: runOnUI,
  withTiming: withTiming,
  withSpring: withSpring,
  withDelay: withDelay,
  withRepeat: withRepeat,
  withSequence: withSequence,
  withDecay: withDecay,
  cancelAnimation: cancelAnimation,
  interpolate: interpolate,
  interpolateColor: interpolateColor,
  clamp: clamp,
  Easing: Easing,
  Animated: Animated,
  createAnimatedComponent: createAnimatedComponent,
  scrollTo: scrollTo,
  measure: measure,
  setNativeProps: setNativeProps,
  useEvent: function() { return {}; },
  useHandler: function() { return {}; },
};
