// Stub for react-native-worklets on web.
// react-native-reanimated v4 requires this package for native animations.
// On web, Reanimated uses its own JS runtime and these are no-ops.

module.exports = {
  WorkletsModule: {},
  createWorklet: () => () => {},
  executeOnUIRuntimeSync: (fn) => fn,
  makeShareableCloneRecursive: (v) => v,
  makeShareableCloneOnUIRecursive: (v) => v,
  runOnUI: (fn) => (...args) => fn(...args),
  runOnJS: (fn) => fn,
  isWorklet: () => false,
  WorkletEventHandler: class { register() {} unregister() {} },
  registerEventHandler: () => () => {},
  unregisterEventHandler: () => {},
  getViewProp: async () => null,
  measure: () => null,
};
