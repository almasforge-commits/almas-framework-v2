import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient } from "../api/apiClient";
import type { InboxItem, InformationKind } from "../api/apiTypes";
import { mapApiErrorToUi, type ApiErrorUi } from "../api/apiErrors";
import { DemoNotice } from "../components/DemoNotice";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Header } from "../components/Header";
import { LoadingState } from "../components/LoadingState";
import { useAuthGate } from "../telegram/useAuthGate";

const FILTERS: Array<{ id: "all" | InformationKind; label: string }> = [
  { id: "all", label: "Все" },
  { id: "finance", label: "Финансы" },
  { id: "task", label: "Задачи" },
  { id: "memory", label: "Память" },
  { id: "idea", label: "Идеи" },
  { id: "health", label: "Здоровье" },
  { id: "knowledge", label: "Знания" },
  { id: "project", label: "Проекты" },
];

const SOURCE_ICON: Record<InboxItem["sourceType"], string> = {
  telegram_text: "💬",
  telegram_voice: "🎤",
  youtube: "▶️",
  note: "📝",
};

const STATUS_LABEL: Record<InboxItem["status"], string> = {
  received: "received",
  normalized: "normalized",
  analyzed: "analyzed",
  executed: "executed",
  partially_executed: "partially_executed",
  clarification_required: "clarification_required",
  failed: "failed",
  skipped: "skipped",
};

export function InboxPage() {
  const { authStatus, canFetch, authErrorUi } = useAuthGate();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [selected, setSelected] = useState<InboxItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorUi, setErrorUi] = useState<ApiErrorUi | null>(null);

  const load = useCallback(() => {
    if (!canFetch) return;
    setLoading(true);
    setErrorUi(null);
    apiClient
      .getInbox()
      .then(setItems)
      .catch((error: unknown) => setErrorUi(mapApiErrorToUi(error)))
      .finally(() => setLoading(false));
  }, [canFetch]);

  useEffect(() => {
    if (authStatus === "pending") return;
    if (authStatus === "missing") {
      setErrorUi(authErrorUi);
      setLoading(false);
      return;
    }
    load();
  }, [authStatus, authErrorUi, load]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((item) => item.informationKinds.includes(filter));
  }, [items, filter]);

  return (
    <div>
      <Header title="Inbox" subtitle="Демо-записи входящих сообщений" />
      <div className="space-y-4 px-4 pt-4">
        <DemoNotice />

        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="Фильтры Inbox"
        >
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={filter === entry.id}
              onClick={() => setFilter(entry.id)}
              className={[
                "tap-target rounded-full px-3 py-1.5 text-xs font-medium",
                filter === entry.id
                  ? "bg-tg-button text-tg-button-text"
                  : "bg-tg-secondary text-tg-hint",
              ].join(" ")}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {loading ? <LoadingState /> : null}
        {errorUi ? <ErrorState errorUi={errorUi} onRetry={load} /> : null}

        {!loading && !errorUi && filtered.length === 0 ? (
          <EmptyState title="Нет записей" description="Попробуйте другой фильтр." />
        ) : null}

        <ul className="space-y-3">
          {filtered.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelected(item)}
                className="app-card w-full text-left"
              >
                <div className="flex items-start gap-3">
                  <span aria-hidden className="text-xl">
                    {SOURCE_ICON[item.sourceType]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-tg-hint">{item.sourceType}</p>
                      <p className="text-xs text-tg-hint">{item.time}</p>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm font-medium">{item.originalText}</p>
                    <p className="mt-2 text-xs text-tg-hint">
                      {item.informationKinds.join(", ")} · {STATUS_LABEL[item.status]}
                    </p>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selected ? (
        <div
          className="fixed inset-0 z-30 flex items-end bg-black/40 p-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          role="dialog"
          aria-modal="true"
          aria-label="Детали Inbox"
        >
          <div className="max-h-[80vh] w-full overflow-y-auto rounded-2xl bg-tg-bg p-4 shadow-lg">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Запись Inbox</h2>
              <button
                type="button"
                aria-label="Закрыть"
                className="tap-target rounded-xl bg-tg-secondary px-3 text-sm"
                onClick={() => setSelected(null)}
              >
                Закрыть
              </button>
            </div>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-tg-hint">Оригинал</dt>
                <dd>{selected.originalText}</dd>
              </div>
              <div>
                <dt className="text-xs text-tg-hint">Нормализованный текст</dt>
                <dd>{selected.normalizedText}</dd>
              </div>
              <div>
                <dt className="text-xs text-tg-hint">Kinds</dt>
                <dd>{selected.informationKinds.join(", ")}</dd>
              </div>
              <div>
                <dt className="text-xs text-tg-hint">Extracted items</dt>
                <dd>
                  <ul className="mt-1 list-disc pl-4">
                    {selected.extractedItems.map((entry, index) => (
                      <li key={`${entry.kind}-${index}`}>
                        {entry.kind}: {entry.content}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-tg-hint">Entities</dt>
                <dd>
                  <pre className="mt-1 overflow-x-auto rounded-xl bg-tg-secondary p-2 text-xs">
                    {JSON.stringify(selected.entities, null, 2)}
                  </pre>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-tg-hint">Relationships</dt>
                <dd>
                  <pre className="mt-1 overflow-x-auto rounded-xl bg-tg-secondary p-2 text-xs">
                    {JSON.stringify(selected.relationships, null, 2)}
                  </pre>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-tg-hint">Execution summary</dt>
                <dd>{selected.executionSummary}</dd>
              </div>
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  );
}
