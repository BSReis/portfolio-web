import dynamic from 'next/dynamic';

// Disable SSR — React Navigation + react-native-web require a browser environment
const AppNavigator = dynamic(() => import('../src/AppNavigator'), { ssr: false });

export default function Home() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <AppNavigator />
    </div>
  );
}
