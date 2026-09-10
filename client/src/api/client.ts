import axios, { AxiosError } from "axios";
import type { ApiResponse } from "@ai-novel/shared/types/api";
import { API_BASE_URL, API_TIMEOUT_MS } from "@/lib/constants";
import { toast } from "@/components/ui/toast";
import { installDeepSeekQuickSettings } from "@/mobile/localRuntime";
import { mobileCreationApiAdapter } from "@/mobile/creationAdapter";

export interface ApiHttpError extends Error {
  status?: number;
  details?: unknown;
}

declare module "axios" {
  interface AxiosRequestConfig {
    silentErrorStatuses?: number[];
  }
}

const isMobileLocalRuntime =
  typeof window !== "undefined"
  && (window as Window & { __AI_NOVEL_RUNTIME__?: { localFirst?: boolean } }).__AI_NOVEL_RUNTIME__?.localFirst === true;

export const apiClient = axios.create({
  baseURL: isMobileLocalRuntime ? "local://api" : API_BASE_URL,
  timeout: API_TIMEOUT_MS,
  ...(isMobileLocalRuntime ? { adapter: mobileCreationApiAdapter } : {}),
});

if (isMobileLocalRuntime && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", installDeepSeekQuickSettings, { once: true });
  } else {
    installDeepSeekQuickSettings();
  }
}

const AUTO_DISMISS_SERVER_ERROR_TOAST = {
  duration: 4000,
  closeButton: false,
} as const;

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiResponse<unknown>>) => {
    const status = error.response?.status ?? (error as AxiosError & { status?: number }).status;
    const backendError = error.response?.data?.error;
    const backendMessage = error.response?.data?.message;
    const silentErrorStatuses = error.config?.silentErrorStatuses ?? [];
    let title = backendError ?? error.message ?? "请求失败。";
    let description = backendMessage && backendMessage !== backendError ? backendMessage : undefined;

    if (!status) {
      title = isMobileLocalRuntime ? "本地执行失败，请检查 DeepSeek API Key 或网络连接。" : "网络连接失败，请检查网络后重试。";
      description = isMobileLocalRuntime ? error.message : undefined;
    } else if (status >= 500) {
      title = backendError ?? (isMobileLocalRuntime ? "本地工作流执行失败。" : "服务器错误，请稍后重试。");
      description = backendMessage && backendMessage !== title ? backendMessage : undefined;
    }

    if (!status || !silentErrorStatuses.includes(status)) {
      const isGenericServerErrorToast = title === "服务器错误，请稍后重试。";

      if (description) {
        toast.error(
          title,
          isGenericServerErrorToast
            ? {
                description,
                ...AUTO_DISMISS_SERVER_ERROR_TOAST,
              }
            : { description },
        );
      } else {
        toast.error(title, isGenericServerErrorToast ? AUTO_DISMISS_SERVER_ERROR_TOAST : undefined);
      }
    }

    const message = description ? `${title} ${description}` : title;

    const normalizedError = new Error(message) as ApiHttpError;
    normalizedError.status = status;
    normalizedError.details = error.response?.data;
    return Promise.reject(normalizedError);
  },
);
