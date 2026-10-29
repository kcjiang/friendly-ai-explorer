import { ShellOutputDecoder, shellPacket } from "./adb-shell-protocol";

/**
 * ADB over WebUSB — 完整实现
 * 支持：设备连接、RSA 认证、Shell 执行、Logcat 流
 * 兼容：Chrome / Edge 89+（需 HTTPS 或 localhost）
 */

// ── 协议常量 ──────────────────────────────────────────────────
const A_CNXN = 0x4e584e43;
const A_AUTH = 0x48545541;
const A_OPEN = 0x4e45504f;
const A_OKAY = 0x59414b4f;
const A_CLSE = 0x45534c43;
const A_WRTE = 0x45545257;

const AUTH_TOKEN = 1;
const AUTH_SIGNATURE = 2;
const AUTH_RSAPUBLICKEY = 3;

const ADB_VERSION = 0x01000000;
const ADB_MAXDATA = 256 * 1024;
const ADB_BANNER = "host::features=shell_v2\0";

const ADB_CLASS = 0xff;
const ADB_SUBCLASS = 0x42;
const ADB_PROTOCOL = 0x01;

const LS_PRIV_KEY = "fae-adb-private-jwk";
const LS_PUB_KEY = "fae-adb-public-str";

class AdbHandshakeError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const te = (s: string) => new TextEncoder().encode(s);

// ── DER / ASN.1 解析（提取 RSA 模数）────────────────────────

function parseLength(buf: Uint8Array, off: number): [number, number] {
  if (buf[off] < 0x80) return [buf[off], 1];
  const nb = buf[off] & 0x7f;
  let len = 0;
  for (let i = 0; i < nb; i++) len = (len << 8) | buf[off + 1 + i];
  return [len, 1 + nb];
}

function extractModulus(spki: Uint8Array): Uint8Array {
  let o = 0;
  o++;
  const [, ol] = parseLength(spki, o);
  o += ol; // outer SEQ
  o++;
  const [al, alb] = parseLength(spki, o);
  o += alb + al; // alg SEQ
  o++;
  const [, bsl] = parseLength(spki, o);
  o += bsl; // BIT STRING len (bytes count)
  // Actually need to skip the length bytes properly
  // Let me redo this more carefully

  // Reset and parse properly
  o = 0;
  // outer SEQUENCE
  if (spki[o++] !== 0x30) throw new Error("Bad SPKI");
  const [, seqLenB] = parseLength(spki, o);
  o += seqLenB;
  // algorithm SEQUENCE - skip it
  if (spki[o++] !== 0x30) throw new Error("Bad alg");
  const [algLen, algLenB] = parseLength(spki, o);
  o += algLenB + algLen;
  // BIT STRING
  if (spki[o++] !== 0x03) throw new Error("Bad BIT STRING");
  const [, bsLenB] = parseLength(spki, o);
  o += bsLenB;
  o++; // unused bits byte
  // inner SEQUENCE
  if (spki[o++] !== 0x30) throw new Error("Bad inner SEQ");
  const [, isLenB] = parseLength(spki, o);
  o += isLenB;
  // INTEGER (modulus)
  if (spki[o++] !== 0x02) throw new Error("Bad INTEGER");
  const [modLen, modLenB] = parseLength(spki, o);
  o += modLenB;
  if (spki[o] === 0x00) {
    o++;
    return spki.slice(o, o + modLen - 1);
  }
  return spki.slice(o, o + modLen);
}

// ── BigInt 工具 ───────────────────────────────────────────────

function modInv(a: bigint, m: bigint): bigint {
  let [r, rn] = [m, ((a % m) + m) % m];
  let [s, sn] = [0n, 1n];
  while (rn !== 0n) {
    const q = r / rn;
    [r, rn] = [rn, r - q * rn];
    [s, sn] = [sn, s - q * sn];
  }
  return ((s % m) + m) % m;
}

function bytesToBigInt(b: Uint8Array): bigint {
  let n = 0n;
  for (const byte of b) n = (n << 8n) | BigInt(byte);
  return n;
}

function bigIntToLEWords(n: bigint, words: number): Uint32Array {
  const arr = new Uint32Array(words);
  for (let i = 0; i < words; i++) {
    arr[i] = Number(n & 0xffffffffn);
    n >>= 32n;
  }
  return arr;
}

// ── ADB RSA 公钥格式构建 ──────────────────────────────────────

async function buildAdbPubKey(pub: CryptoKey): Promise<string> {
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pub));
  const mod = extractModulus(spki);
  const n = bytesToBigInt(mod);
  const W = 64; // 2048-bit / 32

  const n0inv = Number(
    (-modInv(n & 0xffffffffn, 1n << 32n) + (1n << 32n)) & 0xffffffffn,
  );
  const rr = (1n << 4096n) % n;

  const buf = new Uint8Array(4 + 4 + W * 4 + W * 4 + 4);
  const dv = new DataView(buf.buffer);
  dv.setInt32(0, W, true);
  dv.setUint32(4, n0inv, true);
  const nw = bigIntToLEWords(n, W);
  const rrw = bigIntToLEWords(rr, W);
  for (let i = 0; i < W; i++) {
    dv.setUint32(8 + i * 4, nw[i], true);
    dv.setUint32(8 + W * 4 + i * 4, rrw[i], true);
  }
  dv.setInt32(8 + W * 8, 65537, true);
  return btoa(String.fromCharCode(...buf)) + " adbkey@fae\0";
}

// ── RSA 密钥管理（存储在 localStorage）───────────────────────

async function getOrCreateKey(): Promise<{
  privKey: CryptoKey;
  pubStr: string;
}> {
  const storedPriv = localStorage.getItem(LS_PRIV_KEY);
  const storedPub = localStorage.getItem(LS_PUB_KEY);

  if (storedPriv && storedPub) {
    const privKey = await crypto.subtle.importKey(
      "jwk",
      JSON.parse(storedPriv),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-1" },
      false,
      ["sign"],
    );
    return { privKey, pubStr: storedPub };
  }

  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-1",
    },
    true,
    ["sign", "verify"],
  );

  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const pubStr = await buildAdbPubKey(pair.publicKey);
  localStorage.setItem(LS_PRIV_KEY, JSON.stringify(jwk));
  localStorage.setItem(LS_PUB_KEY, pubStr);

  const privKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-1" },
    false,
    ["sign"],
  );
  return { privKey, pubStr };
}

// ── USB 接口查找 ──────────────────────────────────────────────

interface AdbIface {
  ifaceNum: number;
  epIn: number;
  epOut: number;
  maxPacket: number;
}

function findAdbIface(device: USBDevice): AdbIface | null {
  for (const cfg of device.configurations) {
    for (const iface of cfg.interfaces) {
      for (const alt of iface.alternates) {
        if (
          alt.interfaceClass === ADB_CLASS &&
          alt.interfaceSubclass === ADB_SUBCLASS &&
          alt.interfaceProtocol === ADB_PROTOCOL
        ) {
          let epIn = -1,
            epOut = -1,
            maxPacket = 512;
          for (const ep of alt.endpoints) {
            if (ep.type !== "bulk") continue;
            if (ep.direction === "in") {
              epIn = ep.endpointNumber;
              maxPacket = ep.packetSize;
            }
            if (ep.direction === "out") {
              epOut = ep.endpointNumber;
            }
          }
          if (epIn >= 0 && epOut >= 0) {
            return { ifaceNum: iface.interfaceNumber, epIn, epOut, maxPacket };
          }
        }
      }
    }
  }
  return null;
}

// ── 消息编码 ──────────────────────────────────────────────────

function encodeMsg(
  cmd: number,
  arg0: number,
  arg1: number,
  data: Uint8Array,
): Uint8Array {
  const msg = new Uint8Array(24 + data.length);
  const dv = new DataView(msg.buffer);
  dv.setUint32(0, cmd, true);
  dv.setUint32(4, arg0, true);
  dv.setUint32(8, arg1, true);
  dv.setUint32(12, data.length, true);
  dv.setUint32(
    16,
    data.reduce((sum, byte) => (sum + byte) >>> 0, 0),
    true,
  );
  dv.setUint32(20, (cmd ^ 0xffffffff) >>> 0, true);
  msg.set(data, 24);
  return msg;
}

// ── Stream 管理 ───────────────────────────────────────────────

interface Stream {
  remoteId: number;
  onData: (d: Uint8Array) => void;
  onClose?: () => void;
  ready?: () => void;
}

// ── AdbDevice（主类）─────────────────────────────────────────

export type AdbStatus =
  | "disconnected"
  | "connecting"
  | "auth"
  | "connected"
  | "error";

export class AdbDevice {
  private dev: USBDevice;
  private iface: AdbIface;
  private privKey!: CryptoKey;
  private pubStr!: string;
  private lid = 1;
  private streams = new Map<number, Stream>();
  private openWait = new Map<
    number,
    { resolve: (rid: number) => void; reject: (e: Error) => void }
  >();
  private sendQueue: Promise<void> = Promise.resolve();
  private onStatus?: (s: AdbStatus, msg?: string) => void;
  private running = false;
  private stopped = false;
  private shellV2 = false;
  interactiveProtocol = "legacy";
  private acceptConnection(msg: { cmd: number; data?: Uint8Array }) {
    if (msg.cmd !== A_CNXN) return false;
    const banner = msg.data ? new TextDecoder().decode(msg.data) : "";
    this.shellV2 = (banner.match(/(?:^|[;:])features=([^;\0]*)/)?.[1] || "")
      .split(",")
      .includes("shell_v2");
    return true;
  }

  private constructor(dev: USBDevice, iface: AdbIface) {
    this.dev = dev;
    this.iface = iface;
  }

  // 请求设备（调用浏览器 USB 选择器）
  static async request(): Promise<AdbDevice> {
    const dev = await navigator.usb.requestDevice({
      filters: [
        {
          classCode: ADB_CLASS,
          subclassCode: ADB_SUBCLASS,
          protocolCode: ADB_PROTOCOL,
        },
      ],
    });
    const iface = findAdbIface(dev);
    if (!iface)
      throw new Error("ADB interface not found. Enable USB debugging");

    try {
      await dev.open();
      if (dev.configuration === null) await dev.selectConfiguration(1);
      await dev.claimInterface(iface.ifaceNum);
      return new AdbDevice(dev, iface);
    } catch (error) {
      await dev.close().catch(() => {});
      throw error;
    }
  }

  // 连接 & 认证
  async connect(
    onStatus?: (s: AdbStatus, msg?: string) => void,
  ): Promise<void> {
    this.onStatus = onStatus;
    this.stopped = false;
    onStatus?.("connecting");
    const { privKey, pubStr } = await getOrCreateKey();
    this.privKey = privKey;
    this.pubStr = pubStr;

    for (let attempt = 1; ; attempt++) {
      try {
        if (this.stopped) throw new Error("ADB connection canceled");
        await this.send(A_CNXN, ADB_VERSION, ADB_MAXDATA, te(ADB_BANNER));
        onStatus?.("auth", "Waiting for authentication...");
        await this.doAuth();
        if (this.stopped) throw new Error("ADB connection canceled");
        break;
      } catch (error) {
        // Closing the USB handle cancels timed-out reads before a new attempt.
        await this.dev.close().catch(() => {});
        if (this.stopped) throw new Error("ADB connection canceled");
        if (
          !(error instanceof AdbHandshakeError) ||
          !error.retryable ||
          attempt >= 3
        )
          throw new Error(
            `ADB handshake failed (attempt ${attempt}/3): ${String(error)}`,
          );
        onStatus?.(
          "connecting",
          `Retrying ADB handshake (${attempt + 1}/3): ${error.message}`,
        );
        await this.dev.open();
        if (this.stopped) {
          await this.dev.close().catch(() => {});
          throw new Error("ADB connection canceled");
        }
        if (this.dev.configuration === null)
          await this.dev.selectConfiguration(1);
        await this.dev.claimInterface(this.iface.ifaceNum);
      }
    }

    this.running = true;
    void this.loop();
    onStatus?.("connected");
  }

  private async doAuth(): Promise<void> {
    const msg = await this.readAuth("initial response");
    if (this.acceptConnection(msg)) return;

    if (msg.cmd !== A_AUTH || msg.arg0 !== AUTH_TOKEN)
      throw this.unexpectedAuth("initial response", msg);
    if (msg.data.length !== 20)
      throw new AdbHandshakeError(
        `Invalid AUTH TOKEN length: ${msg.data.length}`,
        false,
      );

    // 签名挑战
    // ADB's token is already a SHA-1 digest. WebCrypto would hash it again.
    const jwk = JSON.parse(localStorage.getItem(LS_PRIV_KEY)!) as JsonWebKey;
    const decode = (s: string) =>
      Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
        c.charCodeAt(0),
      );
    const modulus = decode(jwk.n!);
    const prefix = Uint8Array.from([
      0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05,
      0x00, 0x04, 0x14,
    ]);
    const encoded = new Uint8Array(modulus.length).fill(0xff);
    encoded[0] = 0;
    encoded[1] = 1;
    const offset = encoded.length - prefix.length - msg.data.length;
    encoded[offset - 1] = 0;
    encoded.set(prefix, offset);
    encoded.set(msg.data, offset + prefix.length);
    let base = bytesToBigInt(encoded),
      power = bytesToBigInt(decode(jwk.d!)),
      signed = 1n;
    const n = bytesToBigInt(modulus);
    while (power) {
      if (power & 1n) signed = (signed * base) % n;
      base = (base * base) % n;
      power >>= 1n;
    }
    const sig = new Uint8Array(modulus.length);
    for (let i = sig.length - 1; i >= 0; i--) {
      sig[i] = Number(signed & 255n);
      signed >>= 8n;
    }
    await this.send(A_AUTH, AUTH_SIGNATURE, 0, sig);

    const resp = await this.readAuth("signature response");
    if (this.acceptConnection(resp)) return;

    // 密钥不在信任列表，发送公钥 → 设备弹窗
    if (resp.cmd === A_AUTH && resp.arg0 === AUTH_TOKEN) {
      await this.send(A_AUTH, AUTH_RSAPUBLICKEY, 0, te(this.pubStr));
      const final = await this.readAuth("device authorization", true);
      if (!this.acceptConnection(final))
        throw this.unexpectedAuth("device authorization", final, false);
      return;
    }
    throw this.unexpectedAuth("signature response", resp);
  }

  private unexpectedAuth(
    stage: string,
    msg: { cmd: number; arg0: number; arg1: number },
    retry = true,
  ) {
    const tag = String.fromCharCode(
      ...[0, 8, 16, 24].map((shift) => (msg.cmd >>> shift) & 255),
    );
    return new AdbHandshakeError(
      `${stage}: expected CNXN or AUTH TOKEN, received ${JSON.stringify(tag)} (0x${msg.cmd.toString(16)}, arg0=${msg.arg0}, arg1=${msg.arg1})`,
      retry && [A_WRTE, A_OKAY, A_CLSE].includes(msg.cmd),
    );
  }

  private async readAuth(stage: string, authorization = false) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.readMsg(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new AdbHandshakeError(
                  authorization
                    ? 'Device authorization timed out. Tap "Allow USB debugging" on the device.'
                    : `${stage}: response timed out`,
                  !authorization,
                ),
              ),
            authorization ? 60000 : 10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const msg = await this.readMsg();
        const localId = msg.arg1;

        if (msg.cmd === A_OKAY) {
          const res = this.openWait.get(localId);
          if (res) {
            this.openWait.delete(localId);
            res.resolve(msg.arg0);
          } else {
            this.streams.get(localId)?.ready?.();
          }
        } else if (msg.cmd === A_WRTE) {
          const s = this.streams.get(localId);
          if (s) {
            s.onData(msg.data);
            await this.send(A_OKAY, localId, msg.arg0, new Uint8Array(0));
          }
        } else if (msg.cmd === A_CLSE) {
          this.openWait.get(localId)?.reject(new Error("ADB service closed"));
          this.openWait.delete(localId);
          const s = this.streams.get(localId);
          s?.onClose?.();
          s?.ready?.();
          this.streams.delete(localId);
          if (s) await this.send(A_CLSE, localId, msg.arg0, new Uint8Array(0));
        }
      } catch (error) {
        if (this.running) this.onStatus?.("error", String(error));
        this.running = false;
        this.closeStreams();
        break;
      }
    }
  }

  private closeStreams() {
    for (const waiter of this.openWait.values())
      waiter.reject(new Error("ADB disconnected"));
    this.openWait.clear();
    for (const stream of this.streams.values()) {
      stream.onClose?.();
      stream.ready?.();
    }
    this.streams.clear();
  }

  async interactive(
    onData: (data: Uint8Array) => void,
    onClose: () => void,
    legacy = false,
  ): Promise<{
    write: (data: Uint8Array) => Promise<void>;
    resize: (cols: number, rows: number) => Promise<boolean>;
    close: () => Promise<void>;
  }> {
    const lid = this.lid++;
    let closed = false;
    let opened = false;
    let notified = false;
    const v2 = this.shellV2 && !legacy;
    const finish = () => {
      closed = true;
      if (opened && !notified) {
        notified = true;
        onClose();
      }
    };
    const decoder = new ShellOutputDecoder(onData, finish);
    this.streams.set(lid, {
      remoteId: 0,
      onData: (data) => (v2 ? decoder.push(data) : onData(data)),
      onClose: finish,
    });
    let rid: number;
    try {
      rid = await this.open(
        lid,
        v2 ? "shell,v2,pty,TERM=xterm-256color:" : "shell:",
      );
    } catch (error) {
      this.streams.delete(lid);
      if (v2 && String(error).includes("ADB service closed"))
        return this.interactive(onData, onClose, true);
      throw error;
    }
    const active = this.streams.get(lid);
    if (!active || closed) throw new Error("Shell closed");
    active.remoteId = rid;
    opened = true;
    this.interactiveProtocol = v2 ? "shell-v2-pty" : "legacy";
    let queue = Promise.resolve();
    const writeRaw = (data: Uint8Array) => {
      const work = queue
        .then(async () => {
          for (let offset = 0; offset < data.length; offset += 4096) {
            if (closed || !this.running) throw new Error("Shell closed");
            await new Promise<void>((resolve, reject) => {
              const stream = this.streams.get(lid)!;
              const timer = setTimeout(() => {
                stream.ready = undefined;
                reject(new Error("ADB write timeout"));
              }, 15000);
              stream.ready = () => {
                clearTimeout(timer);
                stream.ready = undefined;
                if (closed || !this.running) reject(new Error("Shell closed"));
                else resolve();
              };
              void this.send(
                A_WRTE,
                lid,
                rid,
                data.slice(offset, offset + 4096),
              ).catch((error) => {
                clearTimeout(timer);
                reject(error);
              });
            });
          }
        })
        .catch((error) => {
          // A late ACK after a failed write must never acknowledge a later write.
          if (!closed) {
            finish();
            this.streams.delete(lid);
            void this.send(A_CLSE, lid, rid, new Uint8Array(0)).catch(() => {});
          }
          throw error;
        });
      queue = work.catch(() => {});
      return work;
    };
    return {
      write: (data) => writeRaw(v2 ? shellPacket(0, data) : data),
      resize: async (cols, rows) => {
        if (!v2) return false;
        if (
          !Number.isInteger(cols) ||
          !Number.isInteger(rows) ||
          cols < 2 ||
          cols > 1000 ||
          rows < 1 ||
          rows > 500
        )
          throw new Error("Invalid terminal size");
        await writeRaw(shellPacket(5, te(`${rows}x${cols},0x0\0`)));
        return true;
      },
      close: async () => {
        closed = true;
        await this.send(A_CLSE, lid, rid, new Uint8Array(0));
      },
    };
  }

  // 执行 shell 命令（command 结束后 resolve）
  async shell(command: string, onData: (txt: string) => void): Promise<void> {
    const lid = this.lid++;
    const decoder = new TextDecoder();
    let complete!: () => void;
    const done = new Promise<void>((resolve) => {
      complete = resolve;
    });
    this.streams.set(lid, {
      remoteId: 0,
      onData: (data) => onData(decoder.decode(data, { stream: true })),
      onClose: complete,
    });
    try {
      const rid = await this.open(lid, `shell:${command}`);
      const stream = this.streams.get(lid);
      if (stream) stream.remoteId = rid;
      await done;
    } finally {
      this.streams.delete(lid);
    }
  }

  // 启动 Logcat（返回停止函数）
  async startLogcat(
    onLine: (line: string) => void,
    filter?: string,
  ): Promise<() => void> {
    const lid = this.lid++;
    const cmd = filter ? `logcat -v time ${filter}` : "logcat -v time";
    let buf = "";
    const decoder = new TextDecoder();
    this.streams.set(lid, {
      remoteId: 0,
      onData: (d) => {
        buf += decoder.decode(d, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) onLine(l);
      },
    });
    try {
      const rid = await this.open(lid, `shell:${cmd}`);
      const stream = this.streams.get(lid);
      if (stream) stream.remoteId = rid;
    } catch (error) {
      this.streams.delete(lid);
      throw error;
    }
    return () => {
      const s = this.streams.get(lid);
      if (s) {
        void this.send(A_CLSE, lid, s.remoteId, new Uint8Array(0));
      }
      this.streams.delete(lid);
    };
  }

  private async open(lid: number, service: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.openWait.delete(lid);
        reject(new Error("ADB service timeout"));
      }, 15000);
      this.openWait.set(lid, {
        resolve: (rid) => {
          clearTimeout(timer);
          resolve(rid);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      void this.send(A_OPEN, lid, 0, te(service + "\0")).catch((error) => {
        this.openWait.delete(lid);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private async send(
    cmd: number,
    arg0: number,
    arg1: number,
    data: Uint8Array,
  ): Promise<void> {
    const work = this.sendQueue.then(() =>
      this.sendPacket(cmd, arg0, arg1, data),
    );
    this.sendQueue = work.catch(() => {});
    return work;
  }

  private async sendPacket(
    cmd: number,
    arg0: number,
    arg1: number,
    data: Uint8Array,
  ): Promise<void> {
    const pkt = encodeMsg(cmd, arg0, arg1, data);
    const header = await this.dev.transferOut(
      this.iface.epOut,
      pkt.slice(0, 24),
    );
    if (header.status !== "ok") throw new Error("ADB USB write failed");
    for (let off = 24; off < pkt.length; off += this.iface.maxPacket) {
      const result = await this.dev.transferOut(
        this.iface.epOut,
        pkt.slice(off, off + this.iface.maxPacket),
      );
      if (result.status !== "ok") throw new Error("ADB USB write failed");
    }
  }

  private async readMsg(): Promise<{
    cmd: number;
    arg0: number;
    arg1: number;
    data: Uint8Array;
  }> {
    const hdr = await this.dev.transferIn(this.iface.epIn, 24);
    if (hdr.status !== "ok")
      throw new Error(`ADB USB header read failed: ${hdr.status}`);
    if (!hdr.data || hdr.data.byteLength < 24)
      throw new Error("Failed to read message header");
    const dv = hdr.data;
    const cmd = dv.getUint32(0, true);
    const arg0 = dv.getUint32(4, true);
    const arg1 = dv.getUint32(8, true);
    const dlen = dv.getUint32(12, true);
    if (
      dv.getUint32(20, true) !== (cmd ^ 0xffffffff) >>> 0 ||
      dlen > ADB_MAXDATA
    )
      throw new Error("Invalid ADB header");

    if (dlen === 0) return { cmd, arg0, arg1, data: new Uint8Array(0) };

    const chunks: Uint8Array[] = [];
    let remaining = dlen;
    while (remaining > 0) {
      const r = await this.dev.transferIn(
        this.iface.epIn,
        Math.min(remaining, this.iface.maxPacket),
      );
      if (r.status !== "ok")
        throw new Error(`ADB USB payload read failed: ${r.status}`);
      if (!r.data || r.data.byteLength === 0)
        throw new Error("Incomplete ADB payload");
      chunks.push(
        new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength),
      );
      remaining -= r.data.byteLength;
    }
    const data = new Uint8Array(dlen);
    let off = 0;
    for (const c of chunks) {
      data.set(c, off);
      off += c.length;
    }
    return { cmd, arg0, arg1, data };
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.running = false;
    this.closeStreams();
    try {
      await this.dev.releaseInterface(this.iface.ifaceNum);
    } catch {
      /* ignore */
    }
    await this.dev.close().catch(() => {});
  }

  get isConnected() {
    return this.running;
  }
}

// ── 浏览器兼容性检查 ──────────────────────────────────────────

export function checkWebUsbSupport(): string | null {
  if (typeof navigator === "undefined") return "Not running in a browser";
  if (!("usb" in navigator))
    return "WebUSB is unavailable. Use Chrome or Edge 89+";
  if (!window.isSecureContext) {
    return "WebUSB requires HTTPS or localhost";
  }
  return null;
}

export function checkWebSerialSupport(): string | null {
  if (typeof navigator === "undefined") return "Not running in a browser";
  if (!("serial" in navigator))
    return "Web Serial is unavailable. Use Chrome or Edge 89+";
  if (!window.isSecureContext) {
    return "Web Serial requires HTTPS or localhost";
  }
  return null;
}
