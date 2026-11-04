import { useEffect } from 'react';

export default function SharePageView() {
  useEffect(() => {
    window.location.replace(`/share.html${window.location.hash}`);
  }, []);
  return null;
}
