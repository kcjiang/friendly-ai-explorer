import { isAxiosError } from "axios";

/** Read an API error without assuming every thrown value has an Axios shape. */
export function errorMessage(error: unknown, fallback = "操作失败"): string {
  if (isAxiosError<{ detail?: unknown }>(error)) {
    const detail = error.response?.data?.detail;
    let message = typeof detail === "string" ? detail : "";
    if (Array.isArray(detail)) {
      message = detail.slice(0, 3).map((item: unknown) => {
        if (!item || typeof item !== "object" || !("msg" in item)) return "参数无效";
        return String(item.msg);
      }).join("；");
    }
    const requestId: unknown = error.response?.headers?.["x-request-id"];
    if (message) return typeof requestId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(requestId)
      ? `${message}（请求编号：${requestId}）` : message;
  }
  return error instanceof Error ? error.message : fallback;
}
