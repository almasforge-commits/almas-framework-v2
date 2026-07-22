import { useMemo } from "react";
import { ApiError, mapApiErrorToUi, type ApiErrorUi } from "../api/apiErrors";
import { useTelegram, type AuthBootstrapStatus } from "./TelegramProvider";

/**
 * Gate live API mounts until Telegram bootstrap finishes.
 * Mock mode reports ready immediately via TelegramProvider.
 */
export function useAuthGate(): {
  authStatus: AuthBootstrapStatus;
  canFetch: boolean;
  authErrorUi: ApiErrorUi | null;
} {
  const { authStatus } = useTelegram();

  return useMemo(() => {
    if (authStatus === "missing") {
      return {
        authStatus,
        canFetch: false,
        authErrorUi: mapApiErrorToUi(
          new ApiError("auth_required", "Telegram initData is required", {
            status: 401,
            retryable: false,
          })
        ),
      };
    }
    return {
      authStatus,
      canFetch: authStatus === "ready",
      authErrorUi: null,
    };
  }, [authStatus]);
}
