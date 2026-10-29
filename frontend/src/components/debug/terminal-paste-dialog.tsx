"use client";

import { useLocale } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/base/button";
import { Checkbox } from "@/components/ui/base/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/base/dialog";
import { Input } from "@/components/ui/base/input";
import { Label } from "@/components/ui/base/label";
import { NativeSelect } from "@/components/ui/base/native-select";
import { Textarea } from "@/components/ui/base/textarea";
import type { DeviceSession } from "@/lib/device-session";
import { type PasteOptions, planPaste } from "@/lib/terminal-paste";

export type PasteRequest = {
  id: string;
  text: string;
  bracketed: boolean;
  token: string;
};
export default function TerminalPasteDialog({
  session,
  request,
  onClose,
}: {
  session: DeviceSession;
  request: PasteRequest;
  onClose: () => void;
}) {
  const zh = useLocale() === "zh-CN";
  const state = useSyncExternalStore(
    session.subscribe,
    session.snapshot,
    session.snapshot,
  );
  const [text, setText] = useState(request.text);
  const [delayMs, setDelay] = useState(session.pasteDelayMs);
  const [ending, setEnding] = useState<PasteOptions["ending"]>(
    session.kind === "adb"
      ? "\r"
      : ((session.lineEnding || "\r") as PasteOptions["ending"]),
  );
  const [appendEnter, setAppend] = useState(false);
  const [message, setMessage] = useState("");
  const [finished, setFinished] = useState(false);
  const options = {
    delayMs,
    ending,
    appendEnter,
    bracketed: request.bracketed,
  };
  let validation = "";
  try {
    if (text) planPaste(text, options);
  } catch (e) {
    validation = String(e);
  }
  const changed = request.token !== session.connectionToken();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          session.cancelPaste();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {zh ? "粘贴预览与发送" : "Preview and send paste"}
          </DialogTitle>
          <DialogDescription>
            {zh
              ? "确认前不会发送。换行可能执行命令；发送时可取消未发送部分，已发送内容无法撤回。"
              : "Nothing is sent until confirmation. Newlines can execute commands. Cancel discards unsent content; sent content cannot be recalled."}
          </DialogDescription>
        </DialogHeader>
        <Label className="grid gap-1">
          {zh ? "待发送文本" : "Text to send"}
          <Textarea
            aria-label={zh ? "待发送文本" : "Text to send"}
            className="max-h-72 min-h-40 font-mono"
            maxLength={65536}
            value={text}
            disabled={state.pasting}
            onChange={(e) => {
              setText(e.target.value);
              setFinished(false);
            }}
          />
        </Label>
        <p className="text-muted-foreground text-xs">
          {text.length} {zh ? "字符" : "characters"} ·{" "}
          {text.replace(/\r\n?/g, "\n").split("\n").length}{" "}
          {zh ? "行" : "lines"} ·{" "}
          {request.bracketed
            ? zh
              ? "应用已启用括号粘贴模式"
              : "Application bracketed paste enabled"
            : zh
              ? "普通终端粘贴"
              : "Normal terminal paste"}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Label className="grid gap-1">
            {zh
              ? "每行／长行分段间隔（ms）"
              : "Line / long-line chunk delay (ms)"}
            <Input
              type="number"
              min={0}
              max={5000}
              value={delayMs}
              disabled={state.pasting}
              onChange={(e) => setDelay(Number(e.target.value))}
            />
          </Label>
          <Label className="grid gap-1">
            {zh ? "发送换行符" : "Send line ending"}
            <NativeSelect
              disabled={state.pasting}
              value={ending}
              onChange={(e) =>
                setEnding(e.target.value as PasteOptions["ending"])
              }
            >
              <option value={"\r"}>CR</option>
              <option value={"\n"}>LF</option>
              <option value={"\r\n"}>CRLF</option>
            </NativeSelect>
          </Label>
        </div>
        <Label className="flex items-center gap-2">
          <Checkbox
            disabled={state.pasting}
            checked={appendEnter}
            onCheckedChange={(v) => setAppend(v === true)}
          />
          {zh
            ? "文本末尾额外按一次 Enter（默认不添加）"
            : "Append Enter at end (off by default)"}
        </Label>
        {state.status !== "connected" && (
          <p role="status" className="text-muted-foreground text-sm">
            {zh
              ? "设备未连接，当前仅预览。"
              : "Device disconnected. Preview only."}
          </p>
        )}
        {changed && (
          <p role="alert" className="text-destructive text-sm">
            {zh
              ? "连接已发生变化，请关闭并重新打开预览后确认。"
              : "Connection changed. Close and reopen the preview before confirming."}
          </p>
        )}
        {(validation || message) && (
          <p role="status" className="text-sm break-words">
            {validation || message}
          </p>
        )}
        {state.pasting && (
          <p role="status" className="text-sm">
            {zh ? "发送进度" : "Send progress"} {state.pasteSent} /{" "}
            {state.pasteTotal}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {state.pasting ? (
            <>
              <Button variant="outline" onClick={() => session.cancelPaste()}>
                {zh ? "取消未发送部分" : "Cancel remaining"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  void session
                    .write("\x03")
                    .catch((e) => setMessage(String(e)));
                }}
              >
                Ctrl+C
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                {zh ? "关闭" : "Close"}
              </Button>
              <Button
                disabled={
                  finished ||
                  !text ||
                  !!validation ||
                  changed ||
                  state.status !== "connected"
                }
                onClick={() => {
                  setMessage("");
                  session.configure({ pasteDelayMs: delayMs });
                  void session
                    .sendPaste(text, options, request.token)
                    .then(() => {
                      setFinished(true);
                      setMessage(zh ? "已完成发送。" : "Paste completed.");
                    })
                    .catch((e) => setMessage(String(e)));
                }}
              >
                {zh ? "确认发送" : "Confirm send"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
