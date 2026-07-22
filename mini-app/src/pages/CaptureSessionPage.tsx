import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../api/apiClient";
import type { CaptureAction, CaptureSessionDetail } from "../api/apiTypes";
import { mapApiErrorToUi, type ApiErrorUi } from "../api/apiErrors";
import { ErrorState } from "../components/ErrorState";
import { Header } from "../components/Header";
import { LoadingState } from "../components/LoadingState";
import { SectionCard } from "../components/SectionCard";
import { useAuthGate } from "../telegram/useAuthGate";

const CURRENCIES = ["VND", "USD", "EUR", "RUB", "KZT"];

const TYPE_LABELS: Record<string, string> = {
  finance_expense: "Расход",
  finance_income: "Доход",
  idea_create: "Идея",
  task_create: "Задача",
  reminder: "Задача",
  memory_save: "Память",
  preference: "Память",
  knowledge_candidate: "Знания",
};

const CATEGORY_OPTIONS = [
  "",
  "Напитки",
  "Кафе",
  "Продукты",
  "Транспорт",
  "Развлечения",
  "Здоровье",
  "Одежда",
  "Подписки",
  "Техника",
  "Доход",
  "other",
];

function formatAmount(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("ru-RU");
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] || "Запись";
}

function isFinanceType(type: string): boolean {
  return type === "finance_expense" || type === "finance_income";
}

function localValidationErrors(actions: CaptureAction[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  actions.forEach((action, index) => {
    if (!isFinanceType(action.type)) return;
    const payload = (action.payload || {}) as Record<string, unknown>;
    const amount = Number(payload.amount);
    const currency = String(payload.currency || "").trim();
    const description = String(
      payload.description || action.content || ""
    ).trim();
    const n = index + 1;
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push(`Пункт ${n}: сумма должна быть больше 0`);
    }
    if (!currency) errors.push(`Пункт ${n}: укажите валюту`);
    if (/^finance_(expense|income)$/i.test(description)) {
      errors.push(`Пункт ${n}: заполните описание`);
    }
    const key = `${action.type}|${amount}|${currency}|${description.toLowerCase()}`;
    if (seen.has(key)) {
      errors.push("Есть дубликаты расходов/доходов — удалите лишние");
    }
    seen.add(key);
  });
  return errors;
}

export function CaptureSessionPage() {
  const { sessionId = "" } = useParams();
  const { authStatus, canFetch, authErrorUi } = useAuthGate();
  const [session, setSession] = useState<CaptureSessionDetail | null>(null);
  const [actions, setActions] = useState<CaptureAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorUi, setErrorUi] = useState<ApiErrorUi | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [validationNote, setValidationNote] = useState<string | null>(null);

  const editable = session?.status === "pending" || session?.status === "editing";

  const load = useCallback(() => {
    if (!canFetch) return;
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
        setActions(
          next.actions.map((a) => ({ ...a, payload: { ...(a.payload || {}) } }))
        );
      })
      .catch((error: unknown) => setErrorUi(mapApiErrorToUi(error)))
      .finally(() => setLoading(false));
  }, [canFetch, sessionId]);

  useEffect(() => {
    if (authStatus === "pending") return;
    if (authStatus === "missing") {
      setErrorUi(authErrorUi);
      setLoading(false);
      return;
    }
    load();
  }, [authStatus, authErrorUi, load]);

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

  const updatePayload = (index: number, key: string, value: unknown) => {
    setActions((prev) =>
      prev.map((a, i) => {
        if (i !== index) return a;
        const nextPayload = { ...(a.payload || {}), [key]: value };
        const content =
          key === "description" || key === "content"
            ? String(value)
            : a.content;
        return { ...a, content, payload: nextPayload };
      })
    );
  };

  const deleteAction = (index: number) => {
    setActions((prev) => prev.filter((_, i) => i !== index));
  };

  const canMerge = (index: number) => {
    if (index < 0 || index >= actions.length - 1) return false;
    const a = actions[index];
    const b = actions[index + 1];
    return a.type === b.type && isFinanceType(a.type);
  };

  const mergeWithNext = (index: number) => {
    setActions((prev) => {
      if (index < 0 || index >= prev.length - 1) return prev;
      const a = prev[index];
      const b = prev[index + 1];
      if (a.type !== b.type || !isFinanceType(a.type)) return prev;
      const ap = (a.payload || {}) as Record<string, unknown>;
      const bp = (b.payload || {}) as Record<string, unknown>;
      const merged: CaptureAction = {
        ...a,
        content: [ap.description, bp.description].filter(Boolean).join(" + "),
        payload: {
          ...ap,
          ...bp,
          description: [ap.description, bp.description]
            .filter(Boolean)
            .join(" + "),
          amount:
            typeof ap.amount === "number" && typeof bp.amount === "number"
              ? Number(ap.amount) + Number(bp.amount)
              : ap.amount ?? bp.amount,
          currency: ap.currency || bp.currency || "VND",
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
      setActions(
        next.actions.map((a) => ({ ...a, payload: { ...(a.payload || {}) } }))
      );
      setStatusNote("Изменения сохранены");
    } catch (error: unknown) {
      setErrorUi(mapApiErrorToUi(error));
    } finally {
      setSaving(false);
    }
  };

  const confirmBatch = async () => {
    if (!sessionId) return;
    const errors = localValidationErrors(actions);
    if (errors.length) {
      setValidationNote(errors.join(". "));
      return;
    }
    setValidationNote(null);
    setSaving(true);
    setErrorUi(null);
    try {
      await apiClient.patchCaptureSession(sessionId, { actions });
      const result = await apiClient.confirmCaptureSession(sessionId);
      if (!result.confirmed || !result.executedCount) {
        setStatusNote("Ничего не сохранено — проверьте данные и повторите");
        setErrorUi({
          code: "unavailable",
          title: "Сохранение не выполнено",
          description:
            "Подтверждение не записало данные. Проверьте соединение и повторите.",
          retryable: true,
        });
        return;
      }
      setStatusNote(`Сохранено: ${result.executedCount}`);
      setSession((prev) => (prev ? { ...prev, status: "confirmed" } : prev));
    } catch (error: unknown) {
      const ui = mapApiErrorToUi(error);
      setErrorUi(ui);
      if (ui.description) setValidationNote(ui.description);
    } finally {
      setSaving(false);
    }
  };

  const cancelBatch = async () => {
    if (!sessionId) return;
    setSaving(true);
    try {
      await apiClient.cancelCaptureSession(sessionId);
      setStatusNote("Сессия отменена");
      setSession((prev) => (prev ? { ...prev, status: "cancelled" } : prev));
    } catch (error: unknown) {
      setErrorUi(mapApiErrorToUi(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-[calc(7rem+env(safe-area-inset-bottom))]">
      <Header title="Проверка записи" subtitle="Проверьте перед сохранением" />
      <div className="space-y-3 px-4 pt-4">
        {loading ? <LoadingState /> : null}
        {errorUi ? <ErrorState errorUi={errorUi} onRetry={load} /> : null}
        {statusNote ? (
          <p className="text-sm text-tg-hint" role="status">
            {statusNote}
          </p>
        ) : null}
        {validationNote ? (
          <p
            className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600"
            role="alert"
          >
            {validationNote}
          </p>
        ) : null}

        {session && !loading && !errorUi ? (
          <>
            <SectionCard title="Итог">
              <p className="text-sm text-tg-text">
                {session.status === "pending" || session.status === "editing"
                  ? "Готово к сохранению"
                  : String(session.status)}
              </p>
              <ul className="mt-2 space-y-1 text-sm text-tg-hint">
                {counts.expenses ? <li>Расходы: {counts.expenses}</li> : null}
                {counts.income ? <li>Доходы: {counts.income}</li> : null}
                {counts.ideas ? <li>Идеи: {counts.ideas}</li> : null}
                {counts.tasks ? <li>Задачи: {counts.tasks}</li> : null}
                {counts.memory ? <li>Память: {counts.memory}</li> : null}
                {counts.knowledge ? <li>Знания: {counts.knowledge}</li> : null}
              </ul>
            </SectionCard>

            {actions.map((action, index) => {
              const payload = (action.payload || {}) as Record<string, unknown>;
              const finance = isFinanceType(action.type);
              const desc = String(
                payload.description || action.content || ""
              ).trim();
              const amount = Number(payload.amount ?? 0);
              const currency = String(payload.currency || "VND");

              return (
                <SectionCard
                  key={`${action.type}-${index}`}
                  title={typeLabel(action.type)}
                  action={
                    editable ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        {canMerge(index) ? (
                          <button
                            type="button"
                            className="text-xs text-tg-link"
                            onClick={() => mergeWithNext(index)}
                          >
                            Объединить со следующей
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="text-xs text-red-500"
                          onClick={() => deleteAction(index)}
                        >
                          Удалить
                        </button>
                      </div>
                    ) : null
                  }
                >
                  <div className="space-y-2">
                    {finance ? (
                      <div className="rounded-lg bg-tg-secondary/60 px-3 py-2">
                        <p className="text-base font-semibold text-tg-text">
                          {formatAmount(amount)} {currency}
                        </p>
                        {desc && !/^finance_/i.test(desc) ? (
                          <p className="mt-0.5 text-sm capitalize text-tg-hint">
                            {desc}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    <label className="block text-xs text-tg-hint">
                      Описание
                      <input
                        className="mt-1 w-full rounded-lg bg-tg-secondary px-3 py-2 text-sm text-tg-text"
                        disabled={!editable}
                        value={desc}
                        onChange={(e) => {
                          const key = finance ? "description" : "content";
                          updatePayload(index, key, e.target.value);
                        }}
                      />
                    </label>

                    {finance ? (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs text-tg-hint">
                          Сумма
                          <input
                            type="number"
                            className="mt-1 w-full rounded-lg bg-tg-secondary px-3 py-2 text-sm text-tg-text"
                            disabled={!editable}
                            value={Number.isFinite(amount) ? amount : 0}
                            onChange={(e) =>
                              updatePayload(
                                index,
                                "amount",
                                Number(e.target.value)
                              )
                            }
                          />
                        </label>
                        <label className="block text-xs text-tg-hint">
                          Валюта
                          <select
                            className="mt-1 w-full rounded-lg bg-tg-secondary px-3 py-2 text-sm text-tg-text"
                            disabled={!editable}
                            value={currency}
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
                          Категория
                          <select
                            className="mt-1 w-full rounded-lg bg-tg-secondary px-3 py-2 text-sm text-tg-text"
                            disabled={!editable}
                            value={String(payload.category || "")}
                            onChange={(e) =>
                              updatePayload(
                                index,
                                "category",
                                e.target.value || null
                              )
                            }
                          >
                            <option value="">Выбрать категорию</option>
                            {CATEGORY_OPTIONS.filter(Boolean).map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : null}

                    {action.type === "idea_create" ? (
                      <label className="block text-xs text-tg-hint">
                        Категория
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
                  </div>
                </SectionCard>
              );
            })}

            {editable ? (
              <div className="fixed bottom-[calc(3.75rem+env(safe-area-inset-bottom))] left-0 right-0 z-20 border-t border-black/5 bg-tg-bg/95 px-4 py-3 backdrop-blur">
                <div className="mx-auto flex max-w-lg flex-col gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={persistDraft}
                    className="tap-target rounded-xl bg-tg-secondary px-4 py-3 text-sm font-medium text-tg-text"
                  >
                    Сохранить изменения
                  </button>
                  <button
                    type="button"
                    disabled={saving || actions.length === 0}
                    onClick={confirmBatch}
                    className="tap-target rounded-xl bg-tg-button px-4 py-3 text-sm font-medium text-tg-button-text"
                  >
                    Подтвердить и сохранить
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={cancelBatch}
                    className="tap-target rounded-xl px-2 py-2 text-sm font-medium text-tg-hint"
                  >
                    Отменить
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-center text-xs text-tg-hint">
                Сессия закрыта.{" "}
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
