"use client";

import {
  Camera,
  Circle,
  History,
  Loader2,
  Square,
  Upload,
  Video,
  VideoOff,
} from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Container from "@/components/container";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/base/tabs";
import { useDeviceSession } from "@/lib/device-session";
import { consoleLogUpload, useConsoleLogUpload } from "./console-log-upload";
import DeviceConsoleWorkspace from "./device-console-workspace";
import styles from "./device-console.module.css";
import DeviceLogActions from "./device-log-actions";
import DeviceMediaStage from "./device-media-stage";
import {
  ConnectionBar,
  DeviceSettings,
  DeviceToolbar,
  SessionToolbar,
  downloadDeviceBlob,
  useDeviceText,
} from "./device-tools";
import RemoteControl from "./remote-control";
import TerminalView from "./terminal-view";

const ConsoleLogHistory = dynamic(() => import("./console-log-history"), {
  ssr: false,
});

export default function DeviceConsole() {
  const d = useDeviceText();
  const pathname = usePathname();
  const upload = useConsoleLogUpload();
  const remote = useDeviceSession("remote");
  const serial = useDeviceSession("serial");
  const [error, setError] = useState("");
  const report = (error: unknown) => setError(String(error));
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [camera, setCamera] = useState("");
  const [videoActive, setVideoActive] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  // Responsive layout changes can move the video to another panel. Reattach the
  // existing stream without requesting capture permission again.
  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    video.current = element;
    if (element && stream.current) {
      element.srcObject = stream.current;
      void element.play().catch(() => {});
    }
  }, []);
  const recorder = useRef<MediaRecorder | null>(null);
  const animation = useRef(0);
  const recordingStream = useRef<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [address, setAddress] = useState("192.168.111.211");
  const [relayBusy, setRelayBusy] = useState(false);
  const [relayMessage, setRelayMessage] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    setHistoryOpen(false);
  }, [pathname]);
  const relayAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    const saved = localStorage.getItem("fae-relay-address");
    if (saved) setAddress(saved);
  }, []);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", warn);
    };
  }, [recording]);
  function stopRecording() {
    if (recorder.current?.state === "recording") recorder.current.stop();
    setRecording(false);
  }
  function stopVideo() {
    stopRecording();
    stream.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setVideoActive(false);
  }
  useEffect(
    () => () => {
      relayAbort.current?.abort();
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      cancelAnimationFrame(animation.current);
      recordingStream.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );
  async function startVideo() {
    setVideoBusy(true);
    setError("");
    stopVideo();
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(camera ? { deviceId: { exact: camera } } : {}),
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      stream.current = media;
      video.current!.srcObject = media;
      await video.current!.play();
      setVideoActive(true);
      media.getVideoTracks()[0].onended = () => {
        stopVideo();
        setError(
          d(
            "Capture device disconnected. Reconnect to resume.",
            "采集设备已断开，请重新连接。",
          ),
        );
      };
      const available = await navigator.mediaDevices.enumerateDevices();
      setDevices(available.filter((device) => device.kind === "videoinput"));
      setCamera(media.getVideoTracks()[0].getSettings().deviceId || "");
    } catch (error) {
      stopVideo();
      report(error);
    } finally {
      setVideoBusy(false);
    }
  }
  function canvasFrame(watermark: boolean) {
    const source = video.current;
    if (!source?.videoWidth || !source.videoHeight)
      throw new Error(d("No video frame available", "暂无可用视频画面"));
    const canvas = document.createElement("canvas");
    canvas.width = source.videoWidth;
    canvas.height = source.videoHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(source, 0, 0);
    if (watermark) {
      context.font = "24px monospace";
      context.fillStyle = "#000a";
      context.fillRect(10, 10, 310, 38);
      context.fillStyle = "white";
      context.fillText(new Date().toLocaleString(), 18, 37);
    }
    return canvas;
  }
  function screenshot() {
    try {
      canvasFrame(false).toBlob((blob) => {
        if (blob) downloadDeviceBlob(blob, `screenshot-${Date.now()}.png`);
      }, "image/png");
    } catch (error) {
      report(error);
    }
  }
  function record() {
    try {
      const canvas = canvasFrame(false),
        ctx = canvas.getContext("2d")!;
      const draw = () => {
        if (video.current) {
          ctx.drawImage(video.current, 0, 0, canvas.width, canvas.height);
          ctx.font = "24px monospace";
          ctx.fillStyle = "#000a";
          ctx.fillRect(10, 10, 360, 38);
          ctx.fillStyle = "white";
          ctx.fillText(new Date().toLocaleString(), 18, 37);
        }
        animation.current = requestAnimationFrame(draw);
      };
      const captured = canvas.captureStream(30);
      recordingStream.current = captured;
      const mime = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mime)
        throw new Error(
          d("WebM recording is unavailable", "浏览器不支持 WebM 录像"),
        );
      const media = new MediaRecorder(captured, { mimeType: mime });
      recorder.current = media;
      const chunks: Blob[] = [];
      media.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      media.onerror = (event) => {
        report(event);
        stopRecording();
      };
      media.onstop = () => {
        cancelAnimationFrame(animation.current);
        captured.getTracks().forEach((track) => track.stop());
        recordingStream.current = null;
        if (chunks.length)
          downloadDeviceBlob(
            new Blob(chunks, { type: mime }),
            `capture-${Date.now()}.webm`,
          );
        setRecording(false);
      };
      draw();
      media.start(1000);
      setElapsed(0);
      setRecording(true);
    } catch (error) {
      cancelAnimationFrame(animation.current);
      recordingStream.current?.getTracks().forEach((track) => track.stop());
      report(error);
    }
  }
  async function relay(channel: string, on: boolean) {
    setRelayBusy(true);
    setRelayMessage("");
    setError("");
    const controller = new AbortController();
    relayAbort.current = controller;
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const url = new URL(
        address.includes("://") ? address : `http://${address}`,
      );
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error(
          d("Enter an HTTP(S) relay address", "请输入 HTTP(S) 继电器地址"),
        );
      localStorage.setItem("fae-relay-address", address);
      url.pathname = "/ecmd";
      url.search = `?pin+set+${channel}+${on ? "on" : "off"}`;
      // Legacy relay endpoints do not expose CORS response headers. Opaque completion
      // only means dispatch completed, never confirmation of the hardware state.
      await fetch(url, {
        mode: "no-cors",
        cache: "no-store",
        signal: controller.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      setRelayMessage(
        d(
          "Request dispatched; hardware state is unconfirmed.",
          "请求已发出，尚未确认硬件状态。",
        ),
      );
    } catch (error) {
      setError(
        d(
          "Relay request failed. Check address, network and browser HTTP/local-network permissions. ",
          "继电器请求失败，请检查地址、网络及浏览器 HTTP／本地网络访问权限。 ",
        ) + String(error),
      );
    } finally {
      clearTimeout(timer);
      setRelayBusy(false);
    }
  }
  return (
    <div className="flex min-h-full flex-col" data-device-console>
      <DeviceToolbar label={d("Console toolbar", "控制台工具栏")}>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={videoBusy || recording}
            onClick={() => {
              void startVideo();
            }}
          >
            <Video />
            {videoActive
              ? d("Reconnect", "重新连接")
              : d("Connect capture card", "连接采集卡")}
          </Button>
          <Button variant="outline" disabled={!videoActive} onClick={stopVideo}>
            <VideoOff />
            {d("Stop video", "关闭视频")}
          </Button>
          <Button
            variant="outline"
            disabled={!videoActive}
            onClick={screenshot}
          >
            <Camera />
            {d("Screenshot", "截图")}
          </Button>
          <Button
            variant={recording ? "destructive" : "outline"}
            disabled={!videoActive}
            onClick={recording ? stopRecording : record}
          >
            {recording ? <Square /> : <Circle />}
            {recording
              ? `${d("Stop recording", "停止录像")} ${elapsed}s`
              : d("Record", "录像")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Button variant="outline" onClick={() => setHistoryOpen(true)}>
            <History />
            {d("Log history", "历史日志")}
          </Button>
          <DeviceSettings title={d("Serial settings", "串口设置")} keepMounted>
            <Tabs defaultValue="remote">
              <TabsList
                className="w-full"
                aria-label={d("Serial connection", "串口连接类型")}
              >
                <TabsTrigger value="remote">
                  {d("Remote", "遥控串口")}
                </TabsTrigger>
                <TabsTrigger value="logs">{d("Logs", "日志串口")}</TabsTrigger>
              </TabsList>
              <TabsContent value="remote" keepMounted>
                <ConnectionBar kind="remote" inlineSettings />
              </TabsContent>
              <TabsContent value="logs" keepMounted>
                <ConnectionBar kind="serial" inlineSettings />
              </TabsContent>
            </Tabs>
          </DeviceSettings>
          <DeviceSettings title={d("Capture settings", "采集设置")}>
            <label className="grid gap-2 text-xs">
              {d("Capture device", "采集设备")}{" "}
              <select
                aria-label={d("Capture device", "采集设备")}
                className="bg-background max-w-64 rounded border p-1"
                disabled={recording}
                value={camera}
                onChange={(e) => setCamera(e.target.value)}
              >
                <option value="">{d("Default device", "默认采集设备")}</option>
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || device.deviceId}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-muted-foreground text-xs">
              {d(
                "Select an input, then connect or reconnect to apply. Device names appear after permission is granted.",
                "选择输入后点击连接或重新连接生效；授权后可显示设备名称。",
              )}
            </p>
          </DeviceSettings>
          <DeviceSettings title={d("Relay control", "继电器控制")}>
            <label className="grid gap-2 text-xs">
              {d("Relay address", "继电器地址")}{" "}
              <Input
                aria-label={d("Relay address", "继电器地址")}
                className="max-w-sm"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <p className="text-muted-foreground text-xs">
              {d(
                "Default: 192.168.111.211. Applied to the next relay request.",
                "默认 192.168.111.211，应用于下一次继电器操作。",
              )}
            </p>
            <div className="space-y-2 border-t pt-3">
              {[
                ["k1", "Power", "电源"],
                ["k2", "Link / Reset contact", "Link／Reset 触点"],
                ["k3", "Recovery", "Recovery"],
              ].map(([channel, en, zh]) => (
                <div
                  key={channel}
                  role="group"
                  aria-label={d(en, zh)}
                  className="flex items-center gap-2"
                >
                  <span className="mr-auto text-sm">{d(en, zh)}</span>
                  <Button
                    variant="outline"
                    disabled={relayBusy}
                    onClick={() => {
                      void relay(channel, true);
                    }}
                  >
                    {d("On / Close", "接通")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={relayBusy}
                    onClick={() => {
                      void relay(channel, false);
                    }}
                  >
                    {d("Off / Open", "断开")}
                  </Button>
                </div>
              ))}
            </div>
            <p role="status" className="text-muted-foreground text-xs">
              {relayMessage ||
                d(
                  "Explicit on/off commands; actual relay state is not available. HTTPS pages may be blocked from accessing HTTP relays by the browser.",
                  "使用明确的接通／断开指令；无法读取继电器实际状态。浏览器可能阻止 HTTPS 页面访问 HTTP 继电器。",
                )}
            </p>
          </DeviceSettings>
        </div>
      </DeviceToolbar>
      <Container className="space-y-4 py-4">
        {error && (
          <p
            role="alert"
            className="border-destructive text-destructive rounded-lg border p-3 text-sm"
          >
            {error}
          </p>
        )}
        <DeviceConsoleWorkspace
          media={
            <DeviceMediaStage
              videoRef={attachVideo}
              videoActive={videoActive}
            />
          }
          remote={
            <RemoteControl
              fitHeight
              connected={remote.status === "connected"}
              onSend={(bytes, onTransmit) =>
                remote.session.write(bytes, onTransmit)
              }
              onError={report}
            />
          }
          logs={
            <div className={styles.logArea}>
              <section
                className="relative h-full min-h-0 overflow-hidden rounded-xl border"
                aria-label={d("Shared log serial", "共享日志串口")}
              >
                <DeviceLogActions>
                  <SessionToolbar session={serial.session} compact />
                  <Button
                    variant="outline"
                    size="icon-sm"
                    title={
                      upload.phase === "uploading"
                        ? d("Show upload progress", "查看上传进度")
                        : d("Upload log", "上传日志")
                    }
                    aria-label={
                      upload.phase === "uploading"
                        ? d("Show upload progress", "查看上传进度")
                        : d("Upload log", "上传日志")
                    }
                    aria-busy={upload.phase === "uploading"}
                    onClick={() => {
                      void consoleLogUpload.start(serial.session.transcript);
                    }}
                  >
                    {upload.phase === "uploading" ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Upload />
                    )}
                  </Button>
                </DeviceLogActions>
                <div className="h-full min-h-0 overflow-hidden">
                  <TerminalView session={serial.session} report={report} />
                </div>
              </section>
            </div>
          }
        />
      </Container>
      {historyOpen && (
        <ConsoleLogHistory
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}
