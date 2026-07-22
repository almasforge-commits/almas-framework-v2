import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../api/apiClient";
import type { IdeaItem } from "../api/apiTypes";
import { mapApiErrorToUi, type ApiErrorUi } from "../api/apiErrors";
import { DemoNotice } from "../components/DemoNotice";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Header } from "../components/Header";
import { LoadingState } from "../components/LoadingState";
import { SectionCard } from "../components/SectionCard";
import { useAuthGate } from "../telegram/useAuthGate";

/**
 * Ideas list/detail — live actor-scoped data via apiClient.
 */
export function IdeasPage() {
  const { ideaId } = useParams();
  const { authStatus, canFetch, authErrorUi } = useAuthGate();
  const [items, setItems] = useState<IdeaItem[]>([]);
  const [detail, setDetail] = useState<IdeaItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorUi, setErrorUi] = useState<ApiErrorUi | null>(null);

  const load = useCallback(() => {
    if (!canFetch) return;
    setLoading(true);
    setErrorUi(null);
    if (ideaId) {
      apiClient
        .getIdea(ideaId)
        .then((item) => {
          setDetail(item);
          setItems([]);
        })
        .catch((error: unknown) => setErrorUi(mapApiErrorToUi(error)))
        .finally(() => setLoading(false));
      return;
    }

    apiClient
      .getIdeas()
      .then((next) => {
        setItems(next);
        setDetail(null);
      })
      .catch((error: unknown) => setErrorUi(mapApiErrorToUi(error)))
      .finally(() => setLoading(false));
  }, [canFetch, ideaId]);

  useEffect(() => {
    if (authStatus === "pending") return;
    if (authStatus === "missing") {
      setErrorUi(authErrorUi);
      setLoading(false);
      return;
    }
    load();
  }, [authStatus, authErrorUi, load]);

  return (
    <div>
      <Header
        title="Идеи"
        subtitle={ideaId ? "Карточка идеи" : "Список идей"}
      />
      <div className="space-y-4 px-4 pt-4">
        <DemoNotice />
        {loading ? <LoadingState /> : null}
        {errorUi ? <ErrorState errorUi={errorUi} onRetry={load} /> : null}

        {!loading && !errorUi && ideaId && detail ? (
          <SectionCard title={detail.title || "Идея"}>
            <p className="text-sm text-tg-text whitespace-pre-wrap">
              {detail.text || detail.content}
            </p>
            <p className="mt-2 text-xs text-tg-hint">
              {detail.category ? `Категория: ${detail.category}` : null}
            </p>
            <Link
              to="/ideas"
              className="mt-3 inline-flex tap-target items-center rounded-xl bg-tg-button px-4 py-2 text-sm font-medium text-tg-button-text"
            >
              К списку
            </Link>
          </SectionCard>
        ) : null}

        {!loading && !errorUi && !ideaId && items.length === 0 ? (
          <EmptyState
            title="Пока пусто"
            description="Сохраните идею через Telegram: «У меня идея…»"
          />
        ) : null}

        {!loading && !errorUi && !ideaId && items.length > 0 ? (
          <SectionCard title={`Идеи · ${items.length}`}>
            <ul className="space-y-3">
              {items.map((item, index) => (
                <li key={item.id || `idea-${index}`}>
                  <Link
                    to={item.id ? `/ideas/${item.id}` : "/ideas"}
                    className="block border-b border-tg-secondary pb-3 text-sm text-tg-text last:border-0 last:pb-0"
                  >
                    <span className="font-medium">
                      {item.title || item.text.slice(0, 80)}
                    </span>
                    {item.category ? (
                      <span className="mt-1 block text-xs text-tg-hint">
                        {item.category}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </SectionCard>
        ) : null}
      </div>
    </div>
  );
}
