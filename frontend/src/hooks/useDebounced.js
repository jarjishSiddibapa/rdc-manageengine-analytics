import { useEffect, useState } from 'react';

// The value, but only after it has stopped changing for `delay` ms (for search boxes that query as you type).
export default function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
