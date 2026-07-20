import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../api/apiClient";
import type { KnowledgeItem } from "../api/apiTypes";
import { DemoNotice } from "../components/DemoNotice";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Header } from "../components/Header";
import { LoadingState } from "../components/LoadingState";

const SOURCE_LABEL: Record<KnowledgeItem["sourceType"], string> = {
  youtube: "YouTube",
  pdf: "PDF",
  note: "Note",
  website: "Website",
};

export function KnowledgePage() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    apiClient
      .getKnowledge()
      .then(setItems)
      .catch(() => setError("Ошибка загрузки знаний"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

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
        {error ? <ErrorState description={error} onRetry={load} /> : null}

        {!loading && !error && filtered.length === 0 ? (
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
