// Only codes verified in WEB_RCU are enabled. Relay power is a separate control.
export const remoteKeys = [
  { id: "power", en: "Power", zh: "电源" },
  { id: "input", en: "Input source", zh: "输入源" },
  { id: "profile", en: "Profile", zh: "用户" },
  { id: "voice", en: "Voice", zh: "语音" },
  { id: "settings", en: "Settings", zh: "设置", code: "0A" },
  { id: "up", en: "Up", zh: "上", code: "00" },
  { id: "right", en: "Right", zh: "右", code: "02" },
  { id: "down", en: "Down", zh: "下", code: "01" },
  { id: "left", en: "Left", zh: "左", code: "03" },
  { id: "ok", en: "OK", zh: "确认", code: "1F" },
  { id: "back", en: "Back", zh: "返回", code: "1C" },
  { id: "home", en: "Home", zh: "主页", code: "0C" },
  { id: "tv", en: "TV", zh: "电视" },
  { id: "volumeUp", en: "Volume up", zh: "音量加", code: "58" },
  { id: "volumeDown", en: "Volume down", zh: "音量减", code: "5D" },
  { id: "channelUp", en: "Channel up", zh: "频道加" },
  { id: "channelDown", en: "Channel down", zh: "频道减" },
  { id: "liveTv", en: "Live TV", zh: "直播电视" },
  { id: "red", en: "Red key", zh: "红色键" },
  { id: "blue", en: "Blue key", zh: "蓝色键" },
  { id: "yellow", en: "Yellow key", zh: "黄色键" },
  { id: "green", en: "Green key", zh: "绿色键" },
] as const;

export function remoteCommand(id: string): Uint8Array | null {
  const key = remoteKeys.find((key) => key.id === id);
  if (!key || !("code" in key)) return null;
  return new Uint8Array([0xfa, 0xf1, 0x08, 0xf7, parseInt(key.code, 16)]);
}
