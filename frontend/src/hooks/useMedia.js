import { useEffect, useState } from 'react';

// True while the media query matches (and keeps up as the window is resized or a phone is turned).
export default function useMedia(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const MOBILE_QUERY = '(max-width: 900px)';
export const useIsMobile = () => useMedia(MOBILE_QUERY);
