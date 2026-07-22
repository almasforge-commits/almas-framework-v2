import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../api/apiClient";
import type { CaptureAction, CaptureSessionDetail } from "../api/apiTypes";
import { mapApiErrorToUi, type ApiErrorUi } from "../api/apiErrors";
import { ErrorState } from "../components/ErrorState";
import { Header } from "../components/Header";
import { LoadingState } from "../components/LoadingState";
import { SectionCard } from "../components/SectionCard";

const CURRENCIES = ["VND", "USD", "EUR", "RUB", "KZT"];

function actionLabel(action: CaptureAction): string {
  const payload = (action.payload || {}) as Record<string, unknown>;
  return (
    String(
      payload.description ||
        payload.content ||
        payload.text ||
        payload.title ||
        action.type ||
        "item"
    ).trim() || "item"
  );
}

export function CaptureSessionPage() {
  const { sessionId = "" } = useParams();
  const [session, setSession] = useState<CaptureSessionDetail | null>(null);
  const [actions, setActions] = useState<CaptureAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorUi, setErrorUi] = useState<ApiErrorUi | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const editable = session?.status === "pending" || session?.status === "editing";

  const load = () => {
    if (!sessionId) {
      setErrorUi({
        code: "bad_request",
        title: "Нет сессии",
        description: "В ссылке отсутствует session id.",
        retryable: false,
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorUi(null);
    apiClient
      .getCaptureSession(sessionId)
      .then((next) => {
        setSession(next);
        setActions(next.actions.map((a) => ({ ...a, payload: { ...(a.payload || {}) } })));
      })
      .catch((error: unknown) => setErrorUi(mapApiErrorToUi(error)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [sessionId]);

  const counts = useMemo(() => {
    const c = {
      expenses: 0,
      income: 0,
      ideas: 0,
      tasks: 0,
      memory: 0,
      knowledge: 0,
    };
    for (const a of actions) {
      if (a.type === "finance_expense") c.expenses += 1;
      else if (a.type === "finance_income") c.income += 1;
      else if (a.type === "idea_create") c.ideas += 1;
      else if (a.type === "task_create" || a.type === "reminder") c.tasks += 1;
      else if (a.type === "memory_save" || a.type === "preference") c.memory += 1;
      else if (a.type === "knowledge_candidate") c.knowledge += 1;
    }
    return c;
  }, [actions]);

  const updateAction = (index: number, patch: Partial<CaptureAction>) => {
    setActions((prev) =>
      prev.map((a, i) => (i === index ? { ...a, ...patch } : a))
    );
  };

  const updatePayload = (index: number, key: string, value: unknown) => {
    setActions((prev) =>
      prev.map((a, i) => {
        if (i !== index) return a;
        return {
          ...a,
          payload: { ...(a.payload || {}), [key]: value },
        };
      })
    );
  };

  const deleteAction = (index: number) => {
    setActions((prev) => prev.filter((_, i) => i !== index));
  };

  const mergeWithNext = (index: number) => {
    setActions((prev) => {
      if (index < 0 || index >= prev.length - 1) return prev;
      const a = prev[index];
      const b = prev[index + 1];
      if (a.type !== b.type) return prev;
      const ap = (a.payload || {}) as Record<string, unknown>;
      const bp = (b.payload || {}) as Record<string, unknown>;
      const merged: CaptureAction = {
        ...a,
        payload: {
          ...ap,
          ...bp,
          description: [ap.description, bp.description]
            .filter(Boolean)
            .join(" + "),
          content: [ap.content, bp.content].filter(Boolean).join(" + "),
          amount:
            typeof ap.amount === "number" && typeof bp.amount === "number"
              ? Number(ap.amount) + Number(bp.amount)
              : ap.amount ?? bp.amount,
        },
      };
      return [...prev.slice(0, index), merged, ...prev.slice(index + 2)];
    });
  };

  const persistDraft = async () => {
    if (!sessionId) return;
    setSaving(true);
    setErrorUi(null);
    try {
      const next = await apiClient.patchCaptureSession(sessionId, { actions });
      setSession(next);
      setActions(next.actions.map((a) => ({ ...a, payload: { ...(a.payload || {}) } })));
      setStatusNote("Draft saved.");
    } catch (error: unknown) {
      setErrorUi(mapApiErrorToUi(error));
    } finally {
      setSaving(false);
    }
  };

  const confirmBatch = async () => {
    if (!sessionId) return;
    setSaving(true);
    setErrorUi(null);
    try {
      await apiClient.patchCaptureSession(sessionId, { actions });
      const result = await apiClient.confirmCaptureSession(sessionId);
      if (!result.confirmed || !result.executedCount) {
        setStatusNote("Nothing saved — check Finance/Ideas and retry.");
        setErrorUi({
          code: "unavailable",
          title: "Сохранение не выполнено",
          description:
            "Confirm не записал данные. Проверьте соединение и повторите.",
          retryable: true,
        });
        return;
      }
      setStatusNote(`Saved ×${result.executedCount}.`);
      setSession((prev) => (prev ? { ...prev, status: "confirmed" } : prev));
    } catch (error: unknown) {
      setErrorUi(mapApiErrorToUi(error));
    } finally {
      setSaving(false);
    }
  };

  const cancelBatch = async () => {
    if (!sessionId) return;
    setSaving(true);
    try {
      await apiClient.cancelCaptureSession(sessionId);
      setStatusNote("Cancelled.");
      setSession((prev) => (prev ? { ...prev, status: "cancelled" } : prev));
    } catch (error: unknown) {
      setErrorUi(mapApiErrorToUi(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Header title="Capture Review" subtitle="Edit before save" />
      <div className="space-y-4 px-4 pt-4 pb-8">
        {loading ? <LoadingState /> : null}
        {errorUi ? <ErrorState errorUi={errorUi} onRetry={load} /> : null}
        {statusNote ? (
          <p className="text-sm text-tg-hint" role="status">
            {statusNote}
          </p>
        ) : null}

        {session && !loading && !errorUi ? (
          <>
            <SectionCard title="Summary">
              <p className="text-sm text-tg-text">
                {session.status === "pending" ? "Ready to save" : String(session.status)}
              </p>
              <ul className="mt-2 space-y-1 text-sm text-tg-hint">
                {counts.expenses ? <li>• Expenses ×{counts.expenses}</li> : null}
                {counts.income ? <li>• Income ×{counts.income}</li> : null}
                {counts.ideas ? <li>• Idea ×{counts.ideas}</li> : null}
                {counts.tasks ? <li>• Task ×{counts.tasks}</li> : null}
                {counts.memory ? <li>• Memory ×{counts.memory}</li> : null}
                {counts.knowledge ? <li>• Knowledge ×{counts.knowledge}</li> : null}
              </ul>
            </SectionCard>

            {session.originalText ? (
              <SectionCard title="Original">
                <p className="whitespace-pre-wrap text-sm text-tg-text">
                  {session.originalText}
                </p>
              </SectionCard>
            ) : null}

            {actions.map((action, index) => {
              const payload = (action.payload || {}) as Record<string, unknown>;
              const isFinance =
                action.type === "finance_expense" ||
                action.type === "finance_income";
              return (
                <SectionCard
                  key={`${action.type}-${index}`}
                  title={`${action.type} · #${index + 1}`}
                  action={
                    editable ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="text-xs text-tg-link"
                          onClick={() => mergeWithNext(index)}
                        >
                          Merge↓
                        </button>
                        <button
                          type="button"
                          className="text-xs text-red-500"
                          onClick={() => deleteAction(index)}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null
                  }
                >
                  <div className="space-y-2">
                    <label className="block text-xs text-tg-hint">
                      Label
                      <input
                        className="mt-1 w-full rounded-lg bg-tg-secondary px-3 py-2 text-sm text-tg-text"
                        disabled={!editable}
                        value={actionLabel(action)}
                        onChange={(e) => {
                          const key = isFinance ? "description" : "content";
                          updatePayload(index, key, e.target.value);
                        }}
                      />
                    </label>

                    {isFinance ? (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs text-tg-hint">
                          Amount
                          <input
                            type="number"
                            className="mt-1 w-full rounded-lg bg-tg-secondary px-3 py-2 text-sm text-tg-text"
                            disabled={!editable}
                            value={Number(payload.amount ?? 0)}
                            onChange={(e) =>
                              updatePayload(index, "amount", Number(e.target.value))
                            }
                          />
                        </label>
                        <label className="block text-xs text-tg-hint">
                          Currency
                          <select
                            className="mt-1 w-full rounded-lg bg-tg-secondary px-3 py-2 text-sm text-tg-text"
                            disabled={!editable}
                            value={String(payload.currency || "VND")}
                            onChange={(e) =>
                              updatePayload(index, "currency", e.target.value)
                            }
                          >
                            {CURRENCIES.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="col-span-2 block text-xs text-tg-hint">
                          Category
                          <input
                            className="mt-1 w-full rounded-lg bg-tg-secondary px-3 py-2 text-sm text-tg-text"
                            disabled={!editable}
                            value={String(payload.category || "")}
                            onChange={(e) =>
                              updatePayload(index, "category", e.target.value)
                            }
                          />
                        </label>
                      </div>
                    ) : null}

                    {action.type === "idea_create" ? (
                      <label className="block text-xs text-tg-hint">
                        Category
                        <select
                          className="mt-1 w-full rounded-lg bg-tg-secondary px-3 py-2 text-sm text-tg-text"
                          disabled={!editable}
                          value={String(payload.category || "other")}
                          onChange={(e) =>
                            updatePayload(index, "category", e.target.value)
                          }
                        >
                          {[
                            "content",
                            "business",
                            "project",
                            "life",
                            "sport",
                            "other",
                          ].map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    <label className="block text-xs text-tg-hint">
                      Type
                      <select
                        className="mt-1 w-full rounded-lg bg-tg-secondary px-3 py-2 text-sm text-tg-text"
                        disabled={!editable}
                        value={action.type}
                        onChange={(e) =>
                          updateAction(index, { type: e.target.value })
                        }
                      >
                        {[
                          "finance_expense",
                          "finance_income",
                          "idea_create",
                          "task_create",
                          "memory_save",
                          "preference",
                          "knowledge_candidate",
                        ].map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </SectionCard>
              );
            })}

            {editable ? (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={persistDraft}
                  className="tap-target rounded-xl bg-tg-secondary px-4 py-3 text-sm font-medium text-tg-text"
                >
                  Save draft
                </button>
                <button
                  type="button"
                  disabled={saving || actions.length === 0}
                  onClick={confirmBatch}
                  className="tap-target rounded-xl bg-tg-button px-4 py-3 text-sm font-medium text-tg-button-text"
                >
                  Confirm → Save all
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={cancelBatch}
                  className="tap-target rounded-xl px-4 py-3 text-sm font-medium text-tg-hint"
                >
                  Cancel session
                </button>
              </div>
            ) : (
              <p className="text-center text-xs text-tg-hint">
                Session is closed.{" "}
                <Link to="/inbox" className="text-tg-link underline">
                  Inbox
                </Link>
              </p>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
