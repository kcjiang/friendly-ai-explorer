"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Home,
  LogIn,
  Mic,
  Minus,
  Plus,
  Power,
  Settings,
  Tv,
  UserRound,
} from "lucide-react";
import { useLocale } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/base/scroll-area";
import { remoteKeys } from "@/lib/remote-keys";
import {
  type RemoteFeedback,
  createRemotePressController,
} from "@/lib/remote-press";
import { cn } from "@/lib/utils";
import styles from "./remote-control.module.css";

const icons = {
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
  home: Home,
  back: ArrowLeft,
  settings: Settings,
  volumeUp: Plus,
  volumeDown: Minus,
  power: Power,
  input: LogIn,
  profile: UserRound,
  voice: Mic,
  tv: Tv,
  channelUp: ChevronUp,
  channelDown: ChevronDown,
};
type KeyId = (typeof remoteKeys)[number]["id"];

// Retain the source silhouette, but normalize the traced controls to a
// symmetric grid. Ordinary buttons are exactly 64 × 64; the top pair 50 × 50.
const positions: Record<KeyId, [number, number, number, number]> = {
  power: [37, 88, 50, 50],
  input: [239, 88, 50, 50],
  profile: [37, 161, 64, 64],
  voice: [131, 134, 64, 64],
  settings: [225, 161, 64, 64],
  up: [37, 216, 252, 126],
  left: [37, 216, 126, 252],
  right: [163, 216, 126, 252],
  down: [37, 342, 252, 126],
  ok: [113, 292, 100, 100],
  back: [37, 460, 64, 64],
  home: [131, 487, 64, 64],
  tv: [225, 460, 64, 64],
  volumeUp: [37, 570, 64, 78],
  volumeDown: [37, 648, 64, 78],
  channelUp: [225, 570, 64, 78],
  channelDown: [225, 648, 64, 78],
  liveTv: [131, 616, 64, 64],
  red: [37, 745, 115, 50],
  blue: [174, 745, 115, 50],
  yellow: [37, 813, 115, 50],
  green: [174, 813, 115, 50],
};
function placement(x: number, y: number, w: number, h: number) {
  return {
    left: (x / 326) * 100 + "%",
    top: (y / 1080) * 100 + "%",
    width: (w / 326) * 100 + "%",
    height: (h / 1080) * 100 + "%",
  };
}

export default function RemoteControl({
  connected,
  onSend,
  onError,
  fitHeight = false,
}: {
  connected: boolean;
  onSend: (bytes: Uint8Array, onTransmit: () => void) => Promise<void>;
  onError: (error: unknown) => void;
  fitHeight?: boolean;
}) {
  const chinese = useLocale() === "zh-CN";
  const pathname = usePathname();
  const hintId = useId();
  const [lastKey, setLastKey] = useState("");
  const [led, setLed] = useState<{
    value: RemoteFeedback | "idle";
    pulse: number;
  }>({ value: "idle", pulse: 0 });
  const live = useRef({ connected, onSend, onError, chinese });
  live.current = { connected, onSend, onError, chinese };
  const pointer = useRef<number | null>(null);
  const keyboard = useRef<string | null>(null);
  const mounted = useRef(false);
  const press = useMemo(
    () =>
      createRemotePressController({
        isConnected: () => live.current.connected,
        send: (bytes, onTransmit) => live.current.onSend(bytes, onTransmit),
        feedback: (value) => {
          if (mounted.current)
            setLed((old) => ({ value, pulse: old.pulse + 1 }));
        },
        sent: (id) => {
          if (!mounted.current) return;
          const key = remoteKeys.find((key) => key.id === id)!;
          setLastKey(live.current.chinese ? key.zh : key.en);
        },
        error: (error) => {
          if (mounted.current) live.current.onError(error);
        },
      }),
    [],
  );
  useEffect(() => {
    mounted.current = true;
    const stop = () => {
      press.stop();
      pointer.current = null;
      keyboard.current = null;
    };
    const visibility = () => {
      if (document.hidden) stop();
    };
    window.addEventListener("blur", stop);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      press.stop();
      window.removeEventListener("blur", stop);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [press]);
  useEffect(() => {
    press.stop();
    setLed((old) =>
      old.value === "idle" ? old : { value: "idle", pulse: old.pulse + 1 },
    );
  }, [press, pathname, connected]);
  function keyButton(id: KeyId, className?: string) {
    const key = remoteKeys.find((key) => key.id === id)!;
    const supported = "code" in key;
    const label = chinese ? key.zh : key.en;
    const title = supported
      ? connected
        ? label
        : label +
          " · " +
          (chinese
            ? "请先连接遥控串口"
            : "Connect the remote serial port first")
      : label + " · " + (chinese ? "暂未实现" : "Not implemented");
    const Icon = icons[id as keyof typeof icons];
    const color = ["red", "blue", "yellow", "green"].includes(id);
    const direction = ["up", "down", "left", "right"].includes(id);
    const rocker = [
      "volumeUp",
      "volumeDown",
      "channelUp",
      "channelDown",
    ].includes(id);
    return (
      <button
        key={id}
        type="button"
        disabled={!supported}
        aria-label={title}
        title={title}
        aria-describedby={hintId}
        data-remote-key={id}
        data-supported={supported}
        data-connected={connected}
        style={placement(...positions[id])}
        className={cn(
          styles.key,
          supported ? styles.available : styles.unsupported,
          color && styles.colorKey,
          color && styles[id],
          direction && styles.direction,
          rocker && styles.rockerButton,
          className,
        )}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.currentTarget.focus({ preventScroll: true });
          pointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          press.start(id);
        }}
        onPointerMove={(event) => {
          if (pointer.current !== event.pointerId) return;
          const hit = document
            .elementFromPoint(event.clientX, event.clientY)
            ?.closest("[data-remote-key]");
          if (hit !== event.currentTarget) {
            press.stop();
            pointer.current = null;
          }
        }}
        onPointerUp={() => {
          press.stop();
          pointer.current = null;
        }}
        onPointerCancel={() => {
          press.stop();
          pointer.current = null;
        }}
        onLostPointerCapture={() => {
          press.stop();
          pointer.current = null;
        }}
        onBlur={() => {
          press.stop();
          keyboard.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          if (
            event.repeat ||
            keyboard.current ||
            event.ctrlKey ||
            event.altKey ||
            event.metaKey
          )
            return;
          keyboard.current = event.key;
          press.start(id);
        }}
        onKeyUp={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          press.stop();
          keyboard.current = null;
        }}
        onClick={(event) => {
          // Pointer/keyboard handlers send on press. A standalone accessibility
          // click has detail=0 and still needs exactly one activation.
          if (event.detail === 0 && !keyboard.current) {
            press.start(id);
            press.stop();
          }
        }}
      >
        <span className={cn(styles.face, direction && styles[id + "Face"])}>
          {Icon ? (
            <Icon
              aria-hidden="true"
              className={styles.icon}
              strokeWidth={1.8}
            />
          ) : color ? (
            <span aria-hidden="true" className={styles.colorMark} />
          ) : (
            <span aria-hidden="true">{id === "ok" ? "OK" : "TV"}</span>
          )}
        </span>
      </button>
    );
  }
  return (
    <div className={fitHeight ? styles.fitted : "space-y-3"}>
      <p
        id={hintId}
        className={
          fitHeight
            ? "sr-only"
            : "text-muted-foreground text-xs leading-relaxed"
        }
      >
        {chinese
          ? "方向键和音量键支持长按重复发送，其他可用键每次按下发送一次。每次实际发送闪红灯；未连接或发送失败闪黄灯。灰色按键与底部四色键暂不支持。"
          : "Hold direction and volume keys to repeat; other available keys send once per press. Each transmission flashes red; disconnected or failed writes flash yellow. Gray and color keys are unavailable."}
      </p>
      <ScrollArea className={fitHeight ? styles.scrollArea : undefined}>
        <div className={fitHeight ? styles.remoteSpace : undefined}>
          <div
            role="group"
            aria-label={chinese ? "模拟遥控器" : "Virtual remote control"}
            aria-describedby={hintId}
            className={styles.remote}
          >
            <div className={styles.body}>
              <div aria-hidden="true" className={styles.shell} />
              <div
                key={led.pulse}
                aria-hidden="true"
                data-remote-led={led.value}
                className={cn(
                  styles.led,
                  led.value === "send"
                    ? styles.ledSend
                    : led.value !== "idle" && styles.ledWarning,
                )}
                style={placement(159.5, 68, 7, 18)}
              />
              <div
                aria-hidden="true"
                className={styles.ring}
                style={placement(37, 216, 252, 252)}
              />
              <div
                aria-hidden="true"
                className={styles.rocker}
                style={placement(37, 570, 64, 156)}
              />
              <div
                aria-hidden="true"
                className={cn(styles.rocker, styles.disabledRocker)}
                style={placement(225, 570, 64, 156)}
              />
              {remoteKeys.map((key) => keyButton(key.id, styles[key.id]))}
            </div>
          </div>
        </div>
      </ScrollArea>
      <p
        role="status"
        className={
          fitHeight
            ? "sr-only"
            : "text-muted-foreground min-h-4 text-center text-xs"
        }
      >
        {led.value === "disconnected"
          ? chinese
            ? "遥控串口未连接"
            : "Remote serial port disconnected"
          : led.value === "error"
            ? chinese
              ? "遥控指令发送失败"
              : "Remote command failed"
            : connected
              ? lastKey
                ? (chinese ? "已发送" : "Sent") + " · " + lastKey
                : chinese
                  ? "遥控器已就绪"
                  : "Remote ready"
              : chinese
                ? "等待连接遥控串口"
                : "Connect the remote serial port"}
      </p>
    </div>
  );
}
