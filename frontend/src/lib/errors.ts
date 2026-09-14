import { isAxiosError } from "axios";

/** Read an API error without assuming every thrown value has an Axios shape. */
export function errorMessage(error: unknown, fallback = "操作失败"): string {
  if (isAxiosError<{ detail?: unknown }>(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
  }
  return error instanceof Error ? error.message : fallback;
}
