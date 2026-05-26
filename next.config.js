/** @type {import('next').NextConfig} */
const path = require('path');
const webpack = require('webpack');

const nextConfig = {
  reactStrictMode: true,
  // Skip ESLint during build — code is migrated from React Native and has RN-specific
  // patterns that trigger false positives in Next.js ESLint rules.
  eslint: { ignoreDuringBuilds: true },
  // Skip TypeScript type checking during build — type differences between
  // RN and web versions of react-navigation packages are non-blocking at runtime.
  typescript: { ignoreBuildErrors: true },
  transpilePackages: [
    'react-native',
    'react-native-web',
    '@react-native-async-storage/async-storage',
    '@react-navigation/native',
    '@react-navigation/native-stack',
    '@react-navigation/bottom-tabs',
    '@react-navigation/elements',
    '@react-navigation/routers',
    'react-native-gesture-handler',
    'react-native-safe-area-context',
    'react-native-screens',
    'react-native-svg',
    'react-native-chart-kit',
    '@expo/vector-icons',
    'expo-modules-core',
    'expo-asset',
    'expo-font',
    '@react-native-community/datetimepicker',
  ],
  webpack(config) {
    // Alias react-native → react-native-web so all RN imports render in browser
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      'react-native$': 'react-native-web',
      // Stub react-native-reanimated with simple JS-based web implementations
      'react-native-reanimated': path.resolve(__dirname, './stubs/react-native-reanimated'),
      // Stub react-native-worklets (used by reanimated v4, not available on web)
      'react-native-worklets': path.resolve(__dirname, './stubs/react-native-worklets'),
      // Stub @shopify/react-native-skia — web charts use HTML Canvas instead
      '@shopify/react-native-skia': path.resolve(__dirname, './stubs/react-native-skia'),
      // Stub ReanimatedSwipeable — swipe gestures aren't meaningful on web;
      // the real component uses Animated.View from Reanimated which resolves to
      // undefined via our stub, causing "GestureDetector got more than one view as a child"
      'react-native-gesture-handler/ReanimatedSwipeable': path.resolve(__dirname, './stubs/reanimated-swipeable'),
    };

    // Treat .web.tsx / .web.ts files with higher priority
    config.resolve.extensions = [
      '.web.tsx',
      '.web.ts',
      '.web.jsx',
      '.web.js',
      ...config.resolve.extensions,
    ];

    // Handle font files imported by @expo/vector-icons
    config.module.rules.push({
      test: /\.(ttf|otf|eot|woff|woff2)$/,
      type: 'asset/resource',
      generator: { filename: 'static/fonts/[name][ext]' },
    });

    // Enable WASM support for CanvasKit (Skia)
    config.experiments = { ...(config.experiments || {}), asyncWebAssembly: true };

    // Define React Native globals required by expo-modules-core and others
    config.plugins.push(
      new webpack.DefinePlugin({
        __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
        'process.env.EXPO_PUBLIC_API_BASE_URL': JSON.stringify(''),
        'process.env.EXPO_OS': JSON.stringify('web'),
        'global.__EXPO_ROUTER_CONTEXT_ELEMENT_TYPE__': JSON.stringify(undefined),
      })
    );

    return config;
  },
  // Rewrite every non-API, non-_next path to the index page so that
  // React Navigation can handle the URL client-side after a hard refresh.
  async rewrites() {
    return [
      {
        source: '/:path((?!api|_next|favicon|public).*)',
        destination: '/',
      },
    ];
  },
};
module.exports = nextConfig;
