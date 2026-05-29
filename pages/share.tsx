import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';

// SharedPortfolioScreen uses React Navigation / RN components — disable SSR
const ShareView = dynamic(() => import('../src/screens/SharePageView'), { ssr: false });

export default function SharePage() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <ShareView />
    </div>
  );
}
