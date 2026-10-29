import type { DeviceSession, SerialSettings } from "./device-session";
import {
  type TerminalPreferences,
  normalizeTerminalPreferences,
  terminalPreferences,
} from "./terminal-preferences";
import {
  type RecordingOptions,
  getTerminalRecorder,
} from "./terminal-recording";

export type TerminalProfile = {
  id: string;
  name: string;
  kind: "adb" | "serial";
  serial: SerialSettings;
  receiveEncoding: "utf-8" | "gb18030";
  sendEncoding: "utf-8" | "gbk";
  ending: string;
  pasteDelayMs: number;
  display: TerminalPreferences;
  recording: RecordingOptions;
};
const key = "fae-terminal-profiles-v1";
export function validateProfile(value: unknown): TerminalProfile {
  if (!value || typeof value !== "object")
    throw new Error("Invalid session profile.");
  const p = value as TerminalProfile;
  if (
    typeof p.id !== "string" ||
    !/^[\w-]{1,80}$/.test(p.id) ||
    typeof p.name !== "string" ||
    !p.name.trim() ||
    p.name.trim().length > 80 ||
    !["adb", "serial"].includes(p.kind)
  )
    throw new Error("Invalid profile name or type.");
  const s = p.serial;
  if (
    p.kind === "adb" &&
    (p.receiveEncoding !== "utf-8" || p.sendEncoding !== "utf-8")
  )
    throw new Error("ADB profiles require UTF-8 encoding.");
  if (
    !s ||
    !Number.isInteger(s.baudRate) ||
    s.baudRate < 1 ||
    s.baudRate > 4294967295 ||
    ![7, 8].includes(s.dataBits) ||
    ![1, 2].includes(s.stopBits) ||
    !["none", "even", "odd"].includes(s.parity) ||
    !["none", "hardware"].includes(s.flowControl)
  )
    throw new Error("Invalid profile serial parameters.");
  if (
    !["utf-8", "gb18030"].includes(p.receiveEncoding) ||
    !["utf-8", "gbk"].includes(p.sendEncoding) ||
    !["", "\r", "\n", "\r\n"].includes(p.ending) ||
    !Number.isInteger(p.pasteDelayMs) ||
    p.pasteDelayMs < 0 ||
    p.pasteDelayMs > 5000 ||
    !p.recording ||
    typeof p.recording.raw !== "boolean" ||
    typeof p.recording.timestamps !== "boolean" ||
    ![4, 16, 64].includes(p.recording.rotateMiB)
  )
    throw new Error("Invalid profile terminal settings.");
  return {
    id: p.id,
    name: p.name.trim(),
    kind: p.kind,
    serial: {
      baudRate: s.baudRate,
      dataBits: s.dataBits,
      stopBits: s.stopBits,
      parity: s.parity,
      flowControl: s.flowControl,
    },
    receiveEncoding: p.receiveEncoding,
    sendEncoding: p.sendEncoding,
    ending: p.ending,
    pasteDelayMs: p.pasteDelayMs,
    display: normalizeTerminalPreferences(p.display || {}),
    recording: {
      raw: p.recording.raw,
      timestamps: p.recording.timestamps && !p.recording.raw,
      rotateMiB: p.recording.rotateMiB,
    },
  };
}
export function readProfiles(
  storage: Pick<Storage, "getItem"> = localStorage,
): TerminalProfile[] {
  const raw = storage.getItem(key);
  if (!raw) return [];
  if (raw.length > 200000)
    throw new Error("Session profile storage is too large.");
  const data = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > 50)
    throw new Error("Invalid session profile storage.");
  const profiles = data.map(validateProfile);
  if (new Set(profiles.map((p) => p.id)).size !== profiles.length)
    throw new Error("Duplicate session profile IDs.");
  return profiles;
}
export function saveProfiles(
  profiles: TerminalProfile[],
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  if (profiles.length > 50)
    throw new Error("A maximum of 50 profiles can be saved.");
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length)
    throw new Error("Duplicate session profile IDs.");
  storage.setItem(key, JSON.stringify(profiles.map(validateProfile)));
}
export function captureProfile(
  session: DeviceSession,
  name: string,
  id = crypto.randomUUID(),
): TerminalProfile {
  if (session.kind === "remote")
    throw new Error("Remote profiles are not supported.");
  return validateProfile({
    id,
    name,
    kind: session.kind,
    serial: session.serialSettings,
    receiveEncoding: session.receiveEncoding,
    sendEncoding: session.sendEncoding,
    ending: session.lineEnding,
    pasteDelayMs: session.pasteDelayMs,
    display: terminalPreferences.snapshot(),
    recording: session.recordingOptions,
  });
}
export function applyProfile(session: DeviceSession, profile: TerminalProfile) {
  const p = validateProfile(profile);
  if (
    ["recording", "saving"].includes(
      getTerminalRecorder(session).snapshot().status,
    )
  )
    throw new Error(
      "Stop recording and wait for saving before loading a profile.",
    );
  if (
    session.kind !== p.kind ||
    !["disconnected", "error"].includes(session.snapshot().status)
  )
    throw new Error(
      "Disconnect and select the matching connection type before loading a profile.",
    );
  session.configure({
    serialSettings: p.serial,
    profileName: p.name,
    lineEnding: p.ending,
    pasteDelayMs: p.pasteDelayMs,
    recordingOptions: p.recording,
  });
  session.setReceiveEncoding(p.receiveEncoding);
  session.setSendEncoding(p.sendEncoding);
  terminalPreferences.set(p.display);
}
