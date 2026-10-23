import axios from "axios";
import { getSession, signOut } from "next-auth/react";
import { getBrowserUiLocale } from "@/i18n/browser";

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
});

// 请求拦截：自动附加 Bearer Token
apiClient.interceptors.request.use(async (config) => {
  config.headers["X-FAE-Locale"] = getBrowserUiLocale();
  // AI requests can include a primary and fallback attempt (up to 300s each).
  if (config.url?.startsWith("/api/v1/ai/") && config.timeout === 30_000) {
    config.timeout = 610_000;
  }
  if (
    config.url?.startsWith("/api/v1/knowledge") &&
    ["post", "patch"].includes(config.method ?? "") &&
    config.timeout === 30_000
  ) {
    config.timeout = 60_000;
  }
  if (typeof window !== "undefined") {
    const session = await getSession();
    if (session?.accessToken) {
      config.headers.Authorization = `Bearer ${session.accessToken}`;
    }
  }
  return config;
});

// 响应拦截：Token 失效时退出登录
apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && typeof window !== "undefined") {
      await signOut({ callbackUrl: "/login" });
    }
    return Promise.reject(error);
  },
);

export default apiClient;
