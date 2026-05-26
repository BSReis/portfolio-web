'use strict';
/**
 * Web stub for react-native-gesture-handler/ReanimatedSwipeable.
 * On web, swipe-to-edit gestures are not needed; we just render the children
 * inside a plain View so the row is displayed normally.
 * This avoids the "GestureDetector got more than one view as a child" warning
 * that occurs because the real Swipeable uses Reanimated's Animated.View
 * (whose default export is undefined in the web stub).
 */
const React = require('react');
const { View } = require('react-native');

function ReanimatedSwipeable({ children, style, containerStyle }) {
  return React.createElement(View, { style: containerStyle || style }, children);
}

module.exports = ReanimatedSwipeable;
module.exports.default = ReanimatedSwipeable;
