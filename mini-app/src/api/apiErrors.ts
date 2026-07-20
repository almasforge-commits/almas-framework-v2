export type ApiErrorCode =
  | "unauthorized"
  | "auth_required"
  | "unavailable"
  | "network"
  | "malformed"
  | "bad_request"
  | "unknown";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { status?: number | null; retryable?: boolean } = {}
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

export interface ApiErrorUi {
  title: string;
  description: string;
  retryable: boolean;
  code: ApiErrorCode;
}

/**
 * Maps API failures to safe Russian UI copy. Never surfaces raw server errors.
 */
export function mapApiErrorToUi(error: unknown): ApiErrorUi {
  if (error instanceof ApiError) {
    if (error.code === "unauthorized" || error.code === "auth_required") {
      return {
        code: error.code,
        title: "Откройте приложение через Telegram",
        description:
          "Для загрузки данных нужна авторизация Telegram Mini App.",
        retryable: false,
      };
    }
    if (error.code === "unavailable") {
      return {
        code: error.code,
        title: "Данные временно недоступны",
        description: "Попробуйте позже.",
        retryable: true,
      };
    }
    if (error.code === "network") {
      return {
        code: error.code,
        title: "Нет соединения",
        description: "Проверьте сеть и повторите попытку.",
        retryable: true,
      };
    }
    if (error.code === "malformed") {
      return {
        code: error.code,
        title: "Не удалось обработать ответ",
        description: "Сервер вернул неожиданные данные.",
        retryable: true,
      };
    }
  }

  return {
    code: "unknown",
    title: "Не удалось загрузить данные",
    description: "Попробуйте ещё раз.",
    retryable: true,
  };
}
