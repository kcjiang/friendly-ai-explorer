"use client";

import { useLocale } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/base/button";
import { useUiTranslations } from "@/i18n/client";
import type { MailItem } from "@/types/workbench-mail";

export function MailReader({
  mail,
  onDownload,
}: {
  mail: MailItem;
  onDownload: (index: number, name: string) => void;
}) {
  const locale = useLocale();

  const t = useUiTranslations();

  const [imagesFor, setImagesFor] = useState("");
  const showImages = imagesFor === mail.id;
  const html = useMemo(() => {
    if (!showImages) return mail.body_html;
    const doc = new DOMParser().parseFromString(mail.body_html, "text/html");
    doc
      .querySelectorAll<HTMLImageElement>("img[data-remote-src]")
      .forEach((image) => {
        image.src = image.dataset.remoteSrc ?? "";
      });
    return doc.documentElement.outerHTML;
  }, [mail.body_html, showImages]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden py-2">
      <header className="max-h-[35%] shrink-0 overflow-y-auto overscroll-contain">
        <h3 className="font-medium break-words">
          {mail.subject || t("ui.noSubject")}
        </h3>
        <div className="text-muted-foreground mt-2 space-y-1 text-xs break-all">
          <p>
            {t("ui.from")}
            {mail.sender}
          </p>
          <p>
            {t("ui.to")}
            {mail.recipients}
          </p>
          {mail.cc && (
            <p>
              {t("ui.cc")}
              {mail.cc}
            </p>
          )}
          <p>{new Date(mail.received_at).toLocaleString(locale)}</p>
        </div>
      </header>
      {mail.has_remote_images && !showImages && (
        <div className="text-muted-foreground flex shrink-0 items-center gap-2 text-xs">
          <span>{t("ui.thisMessageContainsExternalImages")}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImagesFor(mail.id)}
          >
            {t("ui.showExternalImages")}
          </Button>
        </div>
      )}
      <iframe
        key={mail.id + String(showImages)}
        title={t("ui.originalEmail")}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        className="min-h-0 w-full flex-1 overscroll-none border-0 bg-white"
        srcDoc={
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:' +
          (showImages ? " https: http:" : "") +
          "; style-src 'unsafe-inline';\"><style>html{overscroll-behavior:none!important;overflow:auto}body{font:14px/1.6 Arial,sans-serif;overflow-wrap:anywhere;margin:12px;overscroll-behavior:none!important}pre{white-space:pre-wrap}img{max-width:100%}a{color:#2563eb}</style>" +
          html
        }
      />
      {!!mail.attachments.length && (
        <div className="flex max-h-24 shrink-0 flex-wrap gap-2 overflow-y-auto overscroll-contain border-t pt-2">
          {mail.attachments.map((a) => (
            <Button
              key={a.index}
              variant="outline"
              size="sm"
              onClick={() => onDownload(a.index, a.name)}
            >
              {a.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
