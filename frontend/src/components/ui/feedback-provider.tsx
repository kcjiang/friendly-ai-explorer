"use client";

import { useLocale } from "next-intl";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useUiTranslations } from "@/i18n/client";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./base/alert-dialog";
import { Button } from "./base/button";

type Request = { message: string; cancelable: boolean };
type Feedback = {
  confirm: (message: string) => Promise<boolean>;
  notify: (message: string) => Promise<boolean>;
};
const FeedbackContext = createContext<Feedback | null>(null);

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const t = useUiTranslations();
  const chinese = useLocale() === "zh-CN";
  const pathname = usePathname();
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<((value: boolean) => void) | null>(null);
  const finish = useCallback((value: boolean) => {
    pending.current?.(value);
    pending.current = null;
    setRequest(null);
  }, []);
  useEffect(() => {
    finish(false);
  }, [pathname, finish]);
  useEffect(
    () => () => {
      pending.current?.(false);
    },
    [],
  );
  const ask = useCallback((message: string, cancelable: boolean) => {
    pending.current?.(false);
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setRequest({ message, cancelable });
    });
  }, []);
  return (
    <FeedbackContext.Provider
      value={{
        confirm: (message) => ask(message, true),
        notify: (message) => ask(message, false),
      }}
    >
      {children}
      <AlertDialog
        open={!!request}
        onOpenChange={(open) => {
          if (!open) finish(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {request?.cancelable
                ? chinese
                  ? "确认操作"
                  : "Confirm action"
                : chinese
                  ? "提示"
                  : "Notice"}
            </AlertDialogTitle>
            <AlertDialogDescription className="break-words whitespace-pre-wrap">
              {request?.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {request?.cancelable && (
              <Button variant="outline" onClick={() => finish(false)}>
                {t("ui.cancel")}
              </Button>
            )}
            <Button onClick={() => finish(true)}>
              {chinese ? "确定" : "OK"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error("FeedbackProvider is required");
  return feedback;
}
