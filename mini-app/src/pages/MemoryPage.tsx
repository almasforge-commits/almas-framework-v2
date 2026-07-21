import { useEffect, useState } from "react";
import { apiClient } from "../api/apiClient";
import type { MemoryItem } from "../api/apiTypes";
import { mapApiErrorToUi, type ApiErrorUi } from "../api/apiErrors";
import { DemoNotice } from "../components/DemoNotice";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Header } from "../components/Header";
import { LoadingState } from "../components/LoadingState";
import { SectionCard } from "../components/SectionCard";

export function MemoryPage() {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorUi, setErrorUi] = useState<ApiErrorUi | null>(null);

  const load = () => {
    setLoading(true);
    setErrorUi(null);
    apiClient
      .getMemory()
      .then(setItems)
      .catch((error: unknown) => setErrorUi(mapApiErrorToUi(error)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <div>
      <Header title="Память" subtitle="Факты о вас" />
      <div className="space-y-4 px-4 pt-4">
        <DemoNotice />
        {loading ? <LoadingState /> : null}
        {errorUi ? <ErrorState errorUi={errorUi} onRetry={load} /> : null}
        {!loading && !errorUi && items.length === 0 ? (
          <EmptyState
            title="Пока пусто"
            description="Сохраните факт через Telegram: «Запомни, что…»"
          />
        ) : null}
        {!loading && !errorUi && items.length > 0 ? (
          <SectionCard title={`Записи · ${items.length}`}>
            <ul className="space-y-3">
              {items.map((item, index) => (
                <li
                  key={item.id || `m-${index}`}
                  className="border-b border-tg-secondary pb-3 text-sm text-tg-text last:border-0 last:pb-0"
                >
                  {item.content}
                </li>
              ))}
            </ul>
          </SectionCard>
        ) : null}
      </div>
    </div>
  );
}
