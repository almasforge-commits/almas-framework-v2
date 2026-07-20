import { useCallback, useRef, useState } from "react";

const PULL_THRESHOLD = 64;

/**
 * Lightweight pull-to-refresh for Telegram / touch browsers.
 */
export function usePullToRefresh(onRefresh: () => void | Promise<void>) {
  const startY = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onTouchStart = useCallback((event: React.TouchEvent) => {
    if (window.scrollY > 0 || refreshing) return;
    startY.current = event.touches[0]?.clientY ?? null;
  }, [refreshing]);

  const onTouchMove = useCallback(
    (event: React.TouchEvent) => {
      if (startY.current == null || refreshing) return;
      const currentY = event.touches[0]?.clientY ?? startY.current;
      const delta = Math.max(0, currentY - startY.current);
      if (delta > 0 && window.scrollY <= 0) {
        setPullDistance(Math.min(delta * 0.45, 88));
      }
    },
    [refreshing]
  );

  const onTouchEnd = useCallback(async () => {
    if (startY.current == null) return;
    const shouldRefresh = pullDistance >= PULL_THRESHOLD && !refreshing;
    startY.current = null;
    setPullDistance(0);
    if (!shouldRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh, pullDistance, refreshing]);

  return {
    pullDistance,
    refreshing,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
  };
}
