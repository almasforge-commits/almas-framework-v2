/** Cross-page refresh bus so Dashboard updates immediately after Complete. */

type Listener = () => void;

const listeners = new Set<Listener>();
const STALE_KEY = "almas.dashboard.stale";

export function requestDashboardRefresh(): void {
  try {
    sessionStorage.setItem(STALE_KEY, String(Date.now()));
  } catch {
    // ignore quota / private mode
  }
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}

export function consumeDashboardStaleFlag(): boolean {
  try {
    const value = sessionStorage.getItem(STALE_KEY);
    if (!value) return false;
    sessionStorage.removeItem(STALE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function onDashboardRefresh(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
