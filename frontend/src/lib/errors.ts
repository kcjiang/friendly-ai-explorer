import { isAxiosError } from "axios";
import { systemMessage } from "@/i18n/system-messages";

/** Read an API error without assuming every thrown value has an Axios shape. */
export function errorMessage(
  error: unknown,
  fallback = "Operation failed",
): string {
  if (
    isAxiosError<{ detail?: unknown; error?: unknown; request_id?: string }>(
      error,
    )
  ) {
    const detail = error.response?.data?.detail;
    let message = error.response?.data?.error
      ? systemMessage(error.response.data.error)
      : "";
    if (Array.isArray(detail)) {
      message = detail
        .slice(0, 3)
        .map((item: unknown) => {
          if (!item || typeof item !== "object")
            return systemMessage("Invalid parameters");
          return systemMessage(
            "error" in item ? item.error : "Invalid parameters",
          );
        })
        .join("; ");
    }
    const requestId: unknown = error.response?.headers?.["x-request-id"];
    if (message)
      return typeof requestId === "string" &&
        /^[A-Za-z0-9_-]{8,64}$/.test(requestId)
        ? systemMessage({
            code: "errors.withRequestId",
            params: { message, requestId },
          })
        : message;
    if (error.code === "ERR_NETWORK")
      return systemMessage({ code: "errors.networkFailed", params: {} });
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT")
      return systemMessage({ code: "errors.timeout", params: {} });
  }
  return systemMessage(error instanceof Error ? error.message : fallback);
}
