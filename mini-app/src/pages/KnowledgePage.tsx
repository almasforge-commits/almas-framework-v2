import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient } from "../api/apiClient";
import type { KnowledgeItem } from "../api/apiTypes";
import { mapApiErrorToUi, type ApiErrorUi } from "../api/apiErrors";
import { DemoNotice } from "../components/DemoNotice";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Header } from "../components/Header";
import { LoadingState } from "../components/LoadingState";
import { useAuthGate } from "../telegram/useAuthGate";

const SOURCE_LABEL: Record<KnowledgeItem["sourceType"], string> = {
  youtube: "YouTube",
  pdf: "PDF",
  note: "Note",
  website: "Website",
};

export function KnowledgePage() {
  const { authStatus, canFetch, authErrorUi } = useAuthGate();
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorUi, setErrorUi] = useState<ApiErrorUi | null>(null);

  const load = useCallback(() => {
    if (!canFetch) return;
    setLoading(true);
    setErrorUi(null);
    apiClient
      .getKnowledge()
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
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const haystack = [item.title, item.summary, item.sourceType, ...item.tags]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query]);

  return (
    <div>
      <Header title="Знания" subtitle="Локальный поиск по демо-данным" />
      <div className="space-y-4 px-4 pt-4">
        <DemoNotice />

        <label className="block">
          <span className="sr-only">Поиск знаний</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск…"
            className="tap-target w-full rounded-xl border border-black/10 bg-tg-secondary px-3 py-2 text-sm text-tg-text placeholder:text-tg-hint"
          />
        </label>

        {loading ? <LoadingState /> : null}
        {errorUi ? <ErrorState errorUi={errorUi} onRetry={load} /> : null}

        {!loading && !errorUi && filtered.length === 0 ? (
          <EmptyState title="Ничего не найдено" description="Измените запрос." />
        ) : null}

        <ul className="space-y-3">
          {filtered.map((item) => (
            <li key={item.id} className="app-card">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-tg-hint">{SOURCE_LABEL[item.sourceType]}</p>
                <p className="text-xs text-tg-hint">{item.createdAt}</p>
              </div>
              <h2 className="mt-1 text-sm font-semibold">{item.title}</h2>
              <p className="mt-1 text-sm text-tg-hint">{item.summary}</p>
              <p className="mt-2 text-xs text-tg-link">{item.tags.join(" · ")}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
