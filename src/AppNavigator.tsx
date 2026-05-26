import React, { useEffect, useRef, useState } from 'react';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { BottomTabBarProps, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  ActivityIndicator, Animated, Image, Pressable, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { searchStocks, getStockQuote, effectivePrice, StockSearchResult } from './services/api';

import { PortfolioProvider } from './context/PortfolioContext';
import { SettingsProvider, useSettings } from './context/SettingsContext';
import PortfolioScreen from './screens/PortfolioScreen';
import SearchScreen from './screens/SearchScreen';
import DividendsScreen from './screens/DividendsScreen';
import StockDetailScreen from './screens/StockDetailScreen';
import PortfolioChartsScreen from './screens/PortfolioChartsScreen';
import PortfolioPerformanceScreen from './screens/PortfolioPerformanceScreen';
import SettingsScreen from './screens/SettingsScreen';
import TrumpFeedScreen from './screens/TrumpFeedScreen';
import FearGreedIndexScreen from './screens/FearGreedIndexScreen';
import PortfolioChatScreen from './screens/PortfolioChatScreen';
import DividendCalendarScreen from './screens/DividendCalendarScreen';
import FinancialChartsScreen from './screens/FinancialChartsScreen';
import DynamicChartsScreen from './screens/DynamicChartsScreen';
import PortfoliosManagerScreen from './screens/PortfoliosManagerScreen';
import StockDividendHistoryScreen from './screens/StockDividendHistoryScreen';
import WatchlistScreen from './screens/WatchlistScreen';
import FinancialCalendarScreen from './screens/FinancialCalendarScreen';
import IconActionButton from './components/IconActionButton';
import AddTransactionModal from './components/AddTransactionModal';

export type RootStackParamList = {
  Tabs: undefined;
  StockDetail: { symbol: string; name: string; shares: number; avgPrice: number };
  PortfolioCharts: undefined;
  PortfolioPerformance: undefined;
  PortfolioChat: undefined;
  Settings: undefined;
  TrumpFeed: undefined;
  FearGreedIndexScreen: undefined;
  DividendCalendar: {
    entries: Array<{
      symbol: string; name: string; total: number; shares: number; amount: number;
      timestamp: number; payDate: number | null; year: number;
      status: 'paid' | 'forecasted' | 'declared'; yoyGrowth?: number | null;
    }>;
    currencySymbol: string;
  };
  FinancialCharts: {
    data: import('./services/api').FinancialPeriod[];
    freq: 'quarterly' | 'annual';
    symbol: string;
  };
  DynamicCharts: {
    data: import('./services/api').FinancialPeriod[];
    freq: 'quarterly' | 'annual';
    symbol: string;
  };
  PortfoliosManager: undefined;
  StockDividendHistory: { symbol: string; name: string; currency: string; currentPrice: number };
  Watchlist: undefined;
  FinancialCalendar: undefined;
};

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator<RootStackParamList>();

const BREAKPOINT = 768;
const MAX_CONTENT_WIDTH = 1280;
const WEB_TOP_BAR_HEIGHT = 56;

// ─── Inline search bar (shown inside the web top bar) ───────────────────────

function WebSearchBar({ navigation }: { navigation: any }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { getRateFor } = useSettings();
  const [addStock, setAddStock] = useState<StockSearchResult | null>(null);
  const [addStockPrice, setAddStockPrice] = useState<string>('');

  const doSearch = async (text: string) => {
    if (!text.trim()) { setResults([]); return; }
    setLoading(true);
    try { setResults((await searchStocks(text)).slice(0, 8)); }
    catch { setResults([]); }
    finally { setLoading(false); }
  };

  const onChangeText = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(text), 350);
  };

  return (
    <View style={webStyles.searchWrapper}>
      <View style={[webStyles.searchInputRow, focused && webStyles.searchInputRowFocused]}>
        <Ionicons name="search" size={15} color="#64748b" style={{ marginLeft: 10, marginRight: 6 }} />
        <TextInput
          style={webStyles.searchInput}
          placeholder="Search stocks…"
          placeholderTextColor="#475569"
          value={query}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
        />
        {loading
          ? <ActivityIndicator size="small" color="#6366f1" style={{ marginRight: 8 }} />
          : query.length > 0
            ? <Pressable onPress={() => { setQuery(''); setResults([]); }} hitSlop={8} style={{ marginRight: 8 }}>
                <Ionicons name="close-circle" size={15} color="#475569" />
              </Pressable>
            : null}
      </View>

      {addStock && (
        <AddTransactionModal
          symbol={addStock.symbol}
          name={addStock.description}
          initialPrice={addStockPrice}
          onClose={() => { setAddStock(null); setAddStockPrice(''); }}
        />
      )}
      {focused && query.length > 0 && (
        <View style={webStyles.searchDropdown}>
          {!loading && results.length === 0 && (
            <Text style={webStyles.searchEmpty}>No results</Text>
          )}
          {results.map((item) => (
            <View key={item.symbol} style={webStyles.searchDropdownItem}>
              <TouchableOpacity
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
                onPress={() => {
                  navigation.navigate('StockDetail', { symbol: item.symbol, name: item.description, shares: 0, avgPrice: 0 });
                  setQuery(''); setResults([]); setFocused(false);
                }}
              >
                <Text style={webStyles.dropdownSymbol}>{item.symbol}</Text>
                <Text style={webStyles.dropdownName} numberOfLines={1}>{item.description}</Text>
                {item.exchange ? <Text style={webStyles.dropdownBadge}>{item.exchange}</Text> : null}
              </TouchableOpacity>
              <TouchableOpacity
                style={webStyles.dropdownAddBtn}
                onPress={() => {
                  setAddStock(item);
                  setAddStockPrice('');
                  setFocused(false);
                  getStockQuote(item.symbol).then((q) => {
                    if (q) {
                      const native = effectivePrice(q);
                      const converted = native * getRateFor(q.currency);
                      if (converted > 0) setAddStockPrice(converted.toFixed(2));
                    }
                  }).catch(() => {});
                }}
              >
                <Text style={webStyles.dropdownAddBtnText}>+ Add</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Web top navigation bar (wide screens only) ──────────────────────────────

function WebTopBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { width } = useWindowDimensions();
  if (width < BREAKPOINT) return null;

  const focusedOptions = descriptors[state.routes[state.index]?.key]?.options;
  const focusedTabBarStyle = focusedOptions?.tabBarStyle;
  const shouldHide = Array.isArray(focusedTabBarStyle)
    ? focusedTabBarStyle.some((s) => s && typeof s === 'object' && (s as any).display === 'none')
    : !!focusedTabBarStyle && typeof focusedTabBarStyle === 'object' && (focusedTabBarStyle as any).display === 'none';
  if (shouldHide) return null;

  return (
    <View style={webStyles.topBar}>
      <View style={webStyles.topBarInner}>
        {/* LEFT: Logo + Tabs */}
        <View style={webStyles.topBarLeft}>
          <Image source={{ uri: '/logo.png' }} style={webStyles.topBarLogoImg} />
          <View style={webStyles.topBarTabs}>
            {state.routes.map((route, index) => {
              if (route.name === 'Pesquisar') return null;
              const isFocused = state.index === index;
              const descriptor = descriptors[route.key];
              const label =
                typeof descriptor.options.tabBarLabel === 'string' ? descriptor.options.tabBarLabel
                : typeof descriptor.options.title === 'string' ? descriptor.options.title
                : route.name;
              const icon = descriptor.options.tabBarIcon?.({
                focused: isFocused, color: isFocused ? '#f8fafc' : '#64748b', size: 16,
              });
              const onPress = () => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name, route.params as any);
              };
              return (
                <Pressable key={route.key} style={[webStyles.topBarTab, isFocused && webStyles.topBarTabActive]} onPress={onPress}>
                  {icon}
                  <Text style={[webStyles.topBarTabLabel, isFocused && webStyles.topBarTabLabelActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* CENTER: Search */}
        <View style={webStyles.topBarCenter}>
          <WebSearchBar navigation={navigation} />
        </View>

        {/* RIGHT: Action icon buttons */}
        <View style={webStyles.topBarRight}>
          {([
            ['calendar-outline',    'FinancialCalendar'],
            ['stats-chart-outline', 'FearGreedIndexScreen'],
            ['megaphone-outline',   'TrumpFeed'],
            ['settings-outline',    'Settings'],
          ] as const).map(([icon, screen]) => (
            <Pressable key={screen} style={webStyles.topBarBtn} onPress={() => navigation.navigate(screen as any)}>
              <Ionicons name={icon} size={19} color="#94a3b8" />
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

// ─── Mobile floating bottom tab bar (narrow screens only) ────────────────────

type FloatingTabBarItemProps = {
  label: string; isFocused: boolean; color: string;
  onPress: () => void; onLongPress: () => void;
  accessibilityLabel?: string; testID?: string;
  icon?: ReturnType<NonNullable<BottomTabBarProps['descriptors'][string]['options']['tabBarIcon']>>;
};

function FloatingTabBarItem({ label, isFocused, color, onPress, onLongPress, accessibilityLabel, testID, icon }: FloatingTabBarItemProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const animateTo = (v: number) => Animated.spring(scale, { toValue: v, tension: 220, friction: 16, useNativeDriver: true }).start();
  return (
    <Pressable style={styles.tabPressable} accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      accessibilityLabel={accessibilityLabel} testID={testID}
      onPress={onPress} onLongPress={onLongPress}
      onPressIn={() => animateTo(0.94)} onPressOut={() => animateTo(1)}
    >
      <Animated.View style={[styles.tabItem, isFocused && styles.tabItemActive, { transform: [{ scale }] }]}>
        {icon}
        <Text style={[styles.tabLabel, isFocused && styles.tabLabelActive]} numberOfLines={1}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

function FloatingTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { width } = useWindowDimensions();
  if (width >= BREAKPOINT) return null;

  const focusedOptions = descriptors[state.routes[state.index]?.key]?.options;
  const focusedTabBarStyle = focusedOptions?.tabBarStyle;
  const shouldHide = Array.isArray(focusedTabBarStyle)
    ? focusedTabBarStyle.some((s) => s && typeof s === 'object' && (s as any).display === 'none')
    : !!focusedTabBarStyle && typeof focusedTabBarStyle === 'object' && (focusedTabBarStyle as any).display === 'none';
  if (shouldHide) return null;

  return (
    <View style={[styles.tabBarShell, { paddingBottom: Math.max(insets.bottom, 14) }]}>
      <View style={styles.tabBarFloat}>
        {state.routes.map((route, index) => {
          const descriptor = descriptors[route.key];
          const options = descriptor.options;
          const isFocused = state.index === index;
          const color = isFocused ? '#f8fafc' : '#a1a1aa';
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel
            : typeof options.title === 'string' ? options.title : route.name;
          return (
            <FloatingTabBarItem key={route.key} label={label} isFocused={isFocused} color={color}
              onPress={onPress} onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              accessibilityLabel={options.tabBarAccessibilityLabel} testID={options.tabBarButtonTestID}
              icon={options.tabBarIcon?.({ focused: isFocused, color, size: 22 })}
            />
          );
        })}
      </View>
    </View>
  );
}

// ─── Adaptive tab bar — picks the right one based on screen width ─────────────

function AdaptiveTabBar(props: BottomTabBarProps) {
  return (
    <>
      <WebTopBar {...props} />
      <FloatingTabBar {...props} />
    </>
  );
}

// ─── Standalone top bar for stack screens (Settings, TrumpFeed, etc.) ─────────

const WEB_TAB_DEFS = [
  { name: 'Watchlist', label: 'Watchlist', icon: 'bookmark-outline' as const },
  { name: 'Portfólio', label: 'Portfolio', icon: 'pie-chart' as const },
  { name: 'Dividendos', label: 'Dividends', icon: 'cash-outline' as const },
];

function WebTopBarNav() {
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  if (width < BREAKPOINT) return null;

  return (
    <View style={webStyles.topBar}>
      <View style={webStyles.topBarInner}>
        {/* LEFT: Logo + Tabs */}
        <View style={webStyles.topBarLeft}>
          <Image source={{ uri: '/logo.png' }} style={webStyles.topBarLogoImg} />
          <View style={webStyles.topBarTabs}>
            {WEB_TAB_DEFS.map((tab) => {
              const isFocused = false; // never highlight a tab when on a stack screen
              return (
                <Pressable
                  key={tab.name}
                  style={[webStyles.topBarTab, isFocused && webStyles.topBarTabActive]}
                  onPress={() => navigation.navigate('Tabs', { screen: tab.name })}
                >
                  <Ionicons name={tab.icon} size={16} color={isFocused ? '#f8fafc' : '#64748b'} />
                  <Text style={[webStyles.topBarTabLabel, isFocused && webStyles.topBarTabLabelActive]}>{tab.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* CENTER: Search */}
        <View style={webStyles.topBarCenter}>
          <WebSearchBar navigation={navigation} />
        </View>

        {/* RIGHT: Action icons */}
        <View style={webStyles.topBarRight}>
          {([
            ['calendar-outline',    'FinancialCalendar'],
            ['stats-chart-outline', 'FearGreedIndexScreen'],
            ['megaphone-outline',   'TrumpFeed'],
            ['settings-outline',    'Settings'],
          ] as const).map(([icon, screen]) => (
            <Pressable key={screen} style={webStyles.topBarBtn} onPress={() => navigation.navigate(screen)}>
              <Ionicons name={icon} size={19} color="#94a3b8" />
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

// ─── Wrapper for stack screens: adds top bar + max-width on wide screens ──────

function WebStackLayout({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  if (width < BREAKPOINT) return <>{children}</>;
  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <WebTopBarNav />
      <View style={{ flex: 1, paddingTop: WEB_TOP_BAR_HEIGHT, alignItems: 'center' }}>
        <View style={{ flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH }}>
          {children}
        </View>
      </View>
    </View>
  );
}

// ─── Max-width content wrapper (web wide screens) ────────────────────────────

function WebContent({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  if (width < BREAKPOINT) return <>{children}</>;
  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', paddingTop: WEB_TOP_BAR_HEIGHT }}>
      <View style={{ flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH }}>
        {children}
      </View>
    </View>
  );
}

function PortfolioWebLayout({ portfolioProps }: { portfolioProps: any }) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT;
  if (!isDesktop) return <PortfolioScreen {...portfolioProps} />;
  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0a', paddingTop: WEB_TOP_BAR_HEIGHT }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', flexDirection: 'row', alignItems: 'flex-start' }}
      >
        <View style={{ flex: 1 }}>
          <PortfolioScreen {...portfolioProps} scrollEnabled={false} />
        </View>
        <View style={{ width: 320, flexShrink: 0 }}>
          <PortfolioPerformanceScreen scrollEnabled={false} />
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Tab navigator ────────────────────────────────────────────────────────────

function TabsNavigator() {
  const { width } = useWindowDimensions();
  const isWide = width >= BREAKPOINT;
  return (
    <Tab.Navigator
      id={undefined}
      tabBar={(props) => <AdaptiveTabBar {...props} />}
      screenOptions={({ navigation }) => ({
        headerShown: !isWide,
        headerStyle: { backgroundColor: '#0f0f0f' },
        headerTintColor: '#f8fafc',
        tabBarActiveTintColor: '#6366f1',
        tabBarInactiveTintColor: '#64748b',
        headerRight: () => (
          <>
            <IconActionButton icon="calendar-outline" size={20} onPress={() => navigation.navigate('FinancialCalendar')} style={{ marginRight: 10 }} />
            <IconActionButton icon="stats-chart-outline" size={20} onPress={() => navigation.navigate('FearGreedIndexScreen')} style={{ marginRight: 10 }} />
            <IconActionButton icon="megaphone-outline" size={20} onPress={() => navigation.navigate('TrumpFeed')} style={{ marginRight: 10 }} />
            <IconActionButton icon="settings-outline" size={20} onPress={() => navigation.navigate('Settings')} style={{ marginRight: 16 }} />
          </>
        ),
      })}
    >
      <Tab.Screen name="Watchlist" options={{ title: 'Watchlist', tabBarLabel: 'Watchlist', tabBarIcon: ({ color, size }) => <Ionicons name="bookmark-outline" size={size} color={color} /> }}>
        {(props) => <WebContent><WatchlistScreen {...(props as any)} /></WebContent>}
      </Tab.Screen>
      <Tab.Screen name="Portfólio" options={{ title: 'Portfolio', tabBarLabel: 'Portfolio', tabBarIcon: ({ color, size }) => <Ionicons name="pie-chart" size={size} color={color} /> }}>
        {(props) => <PortfolioWebLayout portfolioProps={props} />}
      </Tab.Screen>
      <Tab.Screen name="Pesquisar" options={{ title: 'Search', tabBarLabel: 'Search', tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} /> }}>
        {(props) => <WebContent><SearchScreen {...(props as any)} /></WebContent>}
      </Tab.Screen>
      <Tab.Screen name="Dividendos" options={{ title: 'Dividends', tabBarLabel: 'Dividends', tabBarIcon: ({ color, size }) => <Ionicons name="cash-outline" size={size} color={color} /> }}>
        {(props) => <WebContent><DividendsScreen {...(props as any)} /></WebContent>}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

// ─── Root stack navigator ─────────────────────────────────────────────────────

function MainNavigator() {
  const { width } = useWindowDimensions();
  const isWide = width >= BREAKPOINT;

  // Forward wheel events from non-scrollable side margins to the active scroll container
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cached: HTMLElement | null = null;

    const findScroller = (): HTMLElement | null => {
      let best: HTMLElement | null = null;
      let maxScrollable = 0;
      document.querySelectorAll('div').forEach((el) => {
        const ov = window.getComputedStyle(el).overflowY;
        if (ov !== 'scroll' && ov !== 'auto') return;
        const scrollable = el.scrollHeight - el.clientHeight;
        if (scrollable > maxScrollable) { maxScrollable = scrollable; best = el as HTMLElement; }
      });
      return maxScrollable > 10 ? best : null;
    };

    const onWheel = (e: WheelEvent) => {
      for (const el of e.composedPath() as HTMLElement[]) {
        if (!el.style) break;
        const ov = window.getComputedStyle(el).overflowY;
        if ((ov === 'scroll' || ov === 'auto') && el.scrollHeight > el.clientHeight) return;
      }
      if (!cached || cached.scrollHeight <= cached.clientHeight + 10) cached = findScroller();
      if (cached) cached.scrollTop += e.deltaY;
    };

    document.addEventListener('wheel', onWheel, { passive: true });
    return () => document.removeEventListener('wheel', onWheel);
  }, []);
  const stackScreenOpts = {
    headerStyle: { backgroundColor: '#0f0f0f' },
    headerTintColor: '#f8fafc',
    headerBackTitle: '',
    headerShown: !isWide,
  };
  return (
    <RootStack.Navigator
      screenOptions={({ navigation }) => ({
        headerBackTitle: '',
        headerBackVisible: false,
        headerLeft: ({ canGoBack }) => canGoBack ? (
          <IconActionButton icon="chevron-back" color="#f8fafc" size={18} onPress={() => navigation.goBack()} style={styles.headerBackButton} />
        ) : null,
      })}
    >
      <RootStack.Screen name="Tabs" component={TabsNavigator} options={{ headerShown: false }} />
      <RootStack.Screen name="StockDetail" options={({ route }) => ({ ...stackScreenOpts, title: route.params.symbol })}>
        {(props) => <WebStackLayout><StockDetailScreen {...(props as any)} /></WebStackLayout>}
      </RootStack.Screen>
      <RootStack.Screen name="PortfolioCharts" options={{ ...stackScreenOpts, title: 'Portfolio Analysis' }}>
        {(props) => <WebStackLayout><PortfolioChartsScreen {...(props as any)} /></WebStackLayout>}
      </RootStack.Screen>
      <RootStack.Screen name="PortfolioPerformance" options={{ ...stackScreenOpts, title: 'Performance' }}>
        {(props) => <WebStackLayout><PortfolioPerformanceScreen {...(props as any)} /></WebStackLayout>}
      </RootStack.Screen>
      <RootStack.Screen name="Settings" options={{ ...stackScreenOpts, title: 'Settings' }}>
        {(props) => <WebStackLayout><SettingsScreen {...(props as any)} /></WebStackLayout>}
      </RootStack.Screen>
      <RootStack.Screen name="PortfolioChat" options={{ ...stackScreenOpts, title: 'AI Assistant' }}>
        {(props) => <WebStackLayout><PortfolioChatScreen {...(props as any)} /></WebStackLayout>}
      </RootStack.Screen>
      <RootStack.Screen name="TrumpFeed" options={{ ...stackScreenOpts, title: 'Trump Feed' }}>
        {(props) => <WebStackLayout><TrumpFeedScreen {...(props as any)} /></WebStackLayout>}
      </RootStack.Screen>
      <RootStack.Screen name="DividendCalendar" options={{ ...stackScreenOpts, title: 'Dividend Calendar' }}>
        {(props) => <WebStackLayout><DividendCalendarScreen {...(props as any)} /></WebStackLayout>}
      </RootStack.Screen>
      <RootStack.Screen name="FinancialCharts" options={({ route }) => ({ ...stackScreenOpts, title: `${route.params.symbol} — Financial Charts` })}>
        {(props) => <WebStackLayout><FinancialChartsScreen {...(props as any)} /></WebStackLayout>}
      </RootStack.Screen>
      <RootStack.Screen name="DynamicCharts" options={({ route }) => ({ ...stackScreenOpts, title: `${route.params.symbol} — Dynamic Charts` })}>
        {(props) => <WebStackLayout><DynamicChartsScreen {...(props as any)} /></WebStackLayout>}
      </RootStack.Screen>
      <RootStack.Screen name="FearGreedIndexScreen" options={{ ...stackScreenOpts, title: 'Fear & Greed Index' }}>
        {(props) => <WebStackLayout><FearGreedIndexScreen {...(props as any)} /></WebStackLayout>}
      </RootStack.Screen>
      <RootStack.Screen name="PortfoliosManager" options={{ ...stackScreenOpts, title: 'Portfolios' }}>
        {(props) => <WebStackLayout><PortfoliosManagerScreen {...(props as any)} /></WebStackLayout>}
      </RootStack.Screen>
      <RootStack.Screen name="StockDividendHistory" options={({ route }) => ({ ...stackScreenOpts, title: `${route.params.symbol} · Dividends` })}>
        {(props) => <WebStackLayout><StockDividendHistoryScreen {...(props as any)} /></WebStackLayout>}
      </RootStack.Screen>
      <RootStack.Screen name="FinancialCalendar" options={{ ...stackScreenOpts, title: 'Financial Calendar' }}>
        {(props) => <WebStackLayout><FinancialCalendarScreen {...(props as any)} /></WebStackLayout>}
      </RootStack.Screen>
    </RootStack.Navigator>
  );
}

const linking = {
  prefixes: [],
  config: {
    screens: {
      Tabs: {
        path: '',
        screens: {
          'Watchlist':  'watchlist',
          'Portfólio':  'portfolio',
          'Pesquisar':  'search',
          'Dividendos': 'dividends',
        },
      },
      StockDetail:          'stock/:symbol',
      PortfolioCharts:      'portfolio-charts',
      PortfolioPerformance: 'portfolio-performance',
      Settings:             'settings',
      PortfolioChat:        'portfolio-chat',
      TrumpFeed:            'trump-feed',
      FearGreedIndexScreen: 'fear-greed',
      PortfoliosManager:    'portfolios',
      StockDividendHistory: 'stock-dividends/:symbol',
      FinancialCalendar:    'financial-calendar',
      // DividendCalendar, FinancialCharts, DynamicCharts have unserialisable array
      // params — refresh on those falls back to the initial tab (acceptable).
    },
  },
};

export default function AppNavigator() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SettingsProvider>
          <PortfolioProvider>
            <NavigationContainer linking={linking}>
              <MainNavigator />
            </NavigationContainer>
          </PortfolioProvider>
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Mobile bottom tab bar
  tabBarShell: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'transparent', paddingTop: 12, alignItems: 'center' },
  tabBarFloat: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '88%', maxWidth: 420, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 34, backgroundColor: '#050505', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', shadowColor: '#0f0f0f', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.42, shadowRadius: 26, elevation: 22 },
  tabPressable: { flex: 1 },
  tabItem: { flex: 1, minHeight: 58, borderRadius: 28, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 8 },
  tabItemActive: { backgroundColor: '#242424', shadowColor: '#0f0f0f', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.22, shadowRadius: 10, elevation: 8 },
  tabLabel: { color: '#a1a1aa', fontSize: 12, fontWeight: '600' },
  tabLabelActive: { color: '#f8fafc' },
  headerBackButton: { marginLeft: 8, marginRight: 10 },
});

const webStyles = StyleSheet.create({
  // Fixed top bar
  topBar: {
    position: 'fixed' as any,
    top: 0, left: 0, right: 0,
    height: WEB_TOP_BAR_HEIGHT,
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
    zIndex: 1000,
    justifyContent: 'center',
  },
  topBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: MAX_CONTENT_WIDTH,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 20,
  },
  // Left: takes natural size, never shrinks (tabs always fully visible)
  topBarLeft: {
    flexShrink: 0,
    flexGrow: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Center: fills ALL remaining space between left and right — can never overlap
  topBarCenter: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
  },
  // Right: takes natural size, never shrinks (icons always visible)
  topBarRight: {
    flexShrink: 0,
    flexGrow: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  topBarLogo: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
    marginRight: 12,
    flexShrink: 0,
    whiteSpace: 'nowrap' as any,
  },
  topBarLogoImg: {
    width: 30,
    height: 30,
    borderRadius: 8,
    marginRight: 10,
    flexShrink: 0,
  },
  // Tab items in top bar
  topBarTabs: { flexDirection: 'row', gap: 2, flexShrink: 1, minWidth: 0 },
  topBarTab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    flexShrink: 0,
  },
  topBarTabActive: { backgroundColor: '#1a1a2e' },
  topBarTabLabel: { color: '#64748b', fontSize: 14, fontWeight: '500', flexShrink: 1 },
  topBarTabLabelActive: { color: '#f8fafc' },
  // Action icon buttons
  topBarActions: { flexDirection: 'row' },
  topBarBtn: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  // Inline search — minWidth:0 on every node so the chain can shrink
  searchWrapper: {
    minWidth: 0,
    width: '100%',
    position: 'relative' as any,
    zIndex: 100,
  },
  searchInputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a2e', borderRadius: 8, height: 36,
    borderWidth: 1, borderColor: 'transparent',
    minWidth: 0,
  },
  searchInputRowFocused: { borderColor: '#6366f1' },
  searchInput: {
    flex: 1, color: '#f8fafc', fontSize: 14,
    paddingVertical: 0, height: 36,
  },
  // Dropdown
  searchDropdown: {
    position: 'absolute' as any,
    top: 40, left: 0, right: 0,
    backgroundColor: '#111827',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 20,
    zIndex: 9999,
    overflow: 'visible',
  },
  searchEmpty: { color: '#64748b', padding: 16, textAlign: 'center', fontSize: 14 },
  searchDropdownItem: {
    flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  dropdownSymbol: { color: '#f8fafc', fontWeight: '700', fontSize: 14, width: 70 },
  dropdownName: { color: '#94a3b8', fontSize: 13, flex: 1 },
  dropdownBadge: {
    color: '#475569', fontSize: 11,
    backgroundColor: '#0f172a',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  dropdownAddBtn: {
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: '#1e3a5f', borderRadius: 6, marginLeft: 6, flexShrink: 0,
  },
  dropdownAddBtnText: { color: '#6366f1', fontWeight: '600', fontSize: 12 },
});
