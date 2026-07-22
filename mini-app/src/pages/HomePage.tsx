import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { apiClient } from "../api/apiClient";
import type { HomePayload } from "../api/apiTypes";
import { mapApiErrorToUi, ApiError, type ApiErrorUi } from "../api/apiErrors";
import { DemoNotice } from "../components/DemoNotice";
import { ActivityItemView } from "../components/dashboard/ActivityItem";
import { DashboardEmpty } from "../components/dashboard/DashboardEmpty";
import { DashboardError } from "../components/dashboard/DashboardError";
import { DashboardSkeleton } from "../components/dashboard/DashboardSkeleton";
import { SectionTitle } from "../components/dashboard/SectionTitle";
import { StatsGrid } from "../components/dashboard/StatsGrid";
import { WhatsNew } from "../components/dashboard/WhatsNew";
import {
  buildGreetingLine,
  formatDashboardDate,
} from "../components/dashboard/greeting";
import { usePullToRefresh } from "../components/dashboard/usePullToRefresh";
import { useTelegram } from "../telegram/TelegramProvider";
import {
  consumeDashboardStaleFlag,
  onDashboardRefresh,
} from "../app/dashboardRefresh";

function isDashboardEmpty(data: HomePayload): boolean {
  const { summary, todayActivity, recentActions } = data;
  return (
    Number(summary.expensesToday || 0) === 0 &&
    Number(summary.incomeToday || 0) === 0 &&
    Number(summary.balanceToday || 0) === 0 &&
    summary.activeTasks === 0 &&
    summary.newKnowledge === 0 &&
    summary.inboxToday === 0 &&
    todayActivity.length === 0 &&
    recentActions.length === 0
  );
}

export function HomePage() {
  const { user, browserPreview, authStatus } = useTelegram();
  const location = useLocation();
  const [data, setData] = useState<HomePayload | null>(null);
  const [errorUi, setErrorUi] = useState<ApiErrorUi | null>(null);
  const [loading, setLoading] = useState(true);
  const skipNextLocationRefresh = useRef(true);

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (authStatus === "pending") return;
      if (authStatus === "missing") {
        setErrorUi(
          mapApiErrorToUi(
            new ApiError("auth_required", "Telegram initData is required", {
              status: 401,
              retryable: false,
            })
          )
        );
        setLoading(false);
        return;
      }
      if (!opts.silent) {
        setLoading(true);
      }
      setErrorUi(null);
      try {
        const payload = await apiClient.getDashboard(user.first_name || null);
        setData(payload);
      } catch (error: unknown) {
        setErrorUi(mapApiErrorToUi(error));
      } finally {
        setLoading(false);
      }
    },
    [user.first_name, authStatus]
  );

  useEffect(() => {
    if (authStatus === "pending") return;
    void load();
  }, [load, authStatus]);

  // Immediate refresh after Tasks Complete (even if Home was unmounted).
  useEffect(() => {
    if (authStatus !== "ready") return;
    if (consumeDashboardStaleFlag()) {
      void load({ silent: true });
    }
    return onDashboardRefresh(() => {
      if (authStatus !== "ready") return;
      void load({ silent: true });
    });
  }, [load, authStatus]);

  useEffect(() => {
    if (location.pathname !== "/") return;
    if (authStatus !== "ready") return;
    if (skipNextLocationRefresh.current) {
      skipNextLocationRefresh.current = false;
      return;
    }
    void load({ silent: true });
  }, [location.key, location.pathname, load, authStatus]);

  useEffect(() => {
    const onFocus = () => {
      if (authStatus !== "ready") return;
      if (document.visibilityState === "visible") {
        void load({ silent: true });
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load, authStatus]);

  const refresh = useCallback(() => load({ silent: true }), [load]);
  const { pullDistance, refreshing, handlers } = usePullToRefresh(refresh);

  const greeting = useMemo(
    () => buildGreetingLine(user.first_name),
    [user.first_name]
  );
  const dateLabel = useMemo(() => formatDashboardDate(), []);

  const activityItems = useMemo(() => {
    if (!data) return [];
    const merged = [...data.todayActivity, ...data.recentActions];
    const seen = new Set<string>();
    const unique = [];
    for (const item of merged) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      unique.push(item);
      if (unique.length >= 5) break;
    }
    return unique;
  }, [data]);

  const showEmpty = Boolean(
    data && !loading && !errorUi && isDashboardEmpty(data)
  );
  const showContent = Boolean(data && !loading && !errorUi && !showEmpty);

  return (
    <div
      className="dashboard-page min-h-full"
      data-testid="home-dashboard"
      {...handlers}
    >
      {(pullDistance > 0 || refreshing) && (
        <div
          className="flex items-center justify-center text-xs text-tg-hint transition-[height] duration-150"
          style={{ height: refreshing ? 36 : pullDistance }}
          aria-live="polite"
        >
          {refreshing
            ? "Обновление…"
            : pullDistance >= 64
              ? "Отпустите"
              : "Потяните"}
        </div>
      )}

      <header className="sticky top-0 z-10 border-b border-black/5 bg-tg-bg/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-tg-hint">
              ALMAS
            </p>
            <h1
              className="mt-1 text-xl font-semibold tracking-tight text-tg-text"
              data-testid="dashboard-greeting"
            >
              {greeting}
            </h1>
            <p className="mt-0.5 text-sm capitalize text-tg-hint">{dateLabel}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="tap-target inline-flex items-center justify-center rounded-xl bg-tg-secondary px-3 text-sm font-medium text-tg-link transition-transform duration-200 active:scale-95"
              aria-label="Обновить дашборд"
              disabled={loading || refreshing}
            >
              Обновить
            </button>
            <span className="inline-flex items-center gap-1 rounded-full bg-tg-secondary px-2 py-1 text-[11px] text-tg-hint">
              <span
                className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                aria-hidden
              />
              {data?.summary.statusLabel ?? "ALMAS"}
            </span>
            {browserPreview ? (
              <p
                className="text-[10px] text-tg-hint"
                data-testid="browser-preview"
              >
                Browser preview
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <div className="space-y-5 px-4 pb-4 pt-4">
        <DemoNotice />

        {loading && !data ? <DashboardSkeleton /> : null}

        {errorUi ? (
          <DashboardError errorUi={errorUi} onRetry={() => void load()} />
        ) : null}

        {showEmpty ? <DashboardEmpty /> : null}

        {showContent && data ? (
          <div className="dashboard-fade space-y-5">
            <StatsGrid summary={data.summary} />

            <section aria-labelledby="recent-activity-title">
              <div id="recent-activity-title">
                <SectionTitle title="Недавние действия" />
              </div>
              {activityItems.length === 0 ? (
                <p className="app-card text-sm text-tg-hint">
                  Пока нет действий.
                </p>
              ) : (
                <ul className="app-card divide-y divide-black/5">
                  {activityItems.map((item) => (
                    <ActivityItemView key={item.id} item={item} />
                  ))}
                </ul>
              )}
            </section>

            <WhatsNew summary={data.summary} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
