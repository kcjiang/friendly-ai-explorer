/**
 * ADB over WebUSB — 完整实现
 * 支持：设备连接、RSA 认证、Shell 执行、Logcat 流
 * 兼容：Chrome / Edge 89+（需 HTTPS 或 localhost）
 */

// ── CRC32 ─────────────────────────────────────────────────────
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC32_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── 协议常量 ──────────────────────────────────────────────────
const A_CNXN = 0x4e584e43;
const A_AUTH = 0x48545541;
const A_OPEN = 0x4e45504f;
const A_OKAY = 0x59414b4f;
const A_CLSE = 0x45534c43;
const A_WRTE = 0x45545257;

const AUTH_TOKEN        = 1;
const AUTH_SIGNATURE    = 2;
const AUTH_RSAPUBLICKEY = 3;

const ADB_VERSION   = 0x01000000;
const ADB_MAXDATA   = 256 * 1024;
const ADB_BANNER    = 'host::';

const ADB_CLASS    = 0xff;
const ADB_SUBCLASS = 0x42;
const ADB_PROTOCOL = 0x01;

const LS_PRIV_KEY = 'fae-adb-private-jwk';
const LS_PUB_KEY  = 'fae-adb-public-str';

const te = (s: string) => new TextEncoder().encode(s);
const td = (b: Uint8Array) => new TextDecoder().decode(b);

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
  o++; const [, ol] = parseLength(spki, o); o += ol;          // outer SEQ
  o++; const [al, alb] = parseLength(spki, o); o += alb + al; // alg SEQ
  o++; const [, bsl] = parseLength(spki, o); o += bsl;        // BIT STRING len (bytes count)
  // Actually need to skip the length bytes properly
  // Let me redo this more carefully
  
  // Reset and parse properly
  o = 0;
  // outer SEQUENCE
  if (spki[o++] !== 0x30) throw new Error('Bad SPKI');
  const [seqLen, seqLenB] = parseLength(spki, o); o += seqLenB;
  // algorithm SEQUENCE - skip it
  if (spki[o++] !== 0x30) throw new Error('Bad alg');
  const [algLen, algLenB] = parseLength(spki, o); o += algLenB + algLen;
  // BIT STRING
  if (spki[o++] !== 0x03) throw new Error('Bad BIT STRING');
  const [, bsLenB] = parseLength(spki, o); o += bsLenB;
  o++; // unused bits byte
  // inner SEQUENCE
  if (spki[o++] !== 0x30) throw new Error('Bad inner SEQ');
  const [, isLenB] = parseLength(spki, o); o += isLenB;
  // INTEGER (modulus)
  if (spki[o++] !== 0x02) throw new Error('Bad INTEGER');
  const [modLen, modLenB] = parseLength(spki, o); o += modLenB;
  if (spki[o] === 0x00) { o++; return spki.slice(o, o + modLen - 1); }
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
  for (let i = 0; i < words; i++) { arr[i] = Number(n & 0xffffffffn); n >>= 32n; }
  return arr;
}

// ── ADB RSA 公钥格式构建 ──────────────────────────────────────

async function buildAdbPubKey(pub: CryptoKey): Promise<string> {
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pub));
  const mod  = extractModulus(spki);
  const n    = bytesToBigInt(mod);
  const W    = 64; // 2048-bit / 32

  const n0inv = Number((-(modInv(n & 0xffffffffn, 1n << 32n)) + (1n << 32n)) & 0xffffffffn);
  const rr    = (1n << 4096n) % n;

  const buf = new Uint8Array(4 + 4 + W * 4 + W * 4 + 4);
  const dv  = new DataView(buf.buffer);
  dv.setInt32(0, W, true);
  dv.setUint32(4, n0inv, true);
  const nw  = bigIntToLEWords(n, W);
  const rrw = bigIntToLEWords(rr, W);
  for (let i = 0; i < W; i++) {
    dv.setUint32(8 + i * 4,         nw[i],  true);
    dv.setUint32(8 + W * 4 + i * 4, rrw[i], true);
  }
  dv.setInt32(8 + W * 8, 65537, true);
  return btoa(String.fromCharCode(...buf)) + ' adbkey@fae\0';
}

// ── RSA 密钥管理（存储在 localStorage）───────────────────────

async function getOrCreateKey(): Promise<{ privKey: CryptoKey; pubStr: string }> {
  const storedPriv = localStorage.getItem(LS_PRIV_KEY);
  const storedPub  = localStorage.getItem(LS_PUB_KEY);

  if (storedPriv && storedPub) {
    const privKey = await crypto.subtle.importKey(
      'jwk', JSON.parse(storedPriv),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' },
      false, ['sign'],
    );
    return { privKey, pubStr: storedPub };
  }

  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' },
    true, ['sign', 'verify'],
  );

  const jwk    = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pubStr = await buildAdbPubKey(pair.publicKey);
  localStorage.setItem(LS_PRIV_KEY, JSON.stringify(jwk));
  localStorage.setItem(LS_PUB_KEY,  pubStr);

  const privKey = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' },
    false, ['sign'],
  );
  return { privKey, pubStr };
}

// ── USB 接口查找 ──────────────────────────────────────────────

interface AdbIface {
  ifaceNum:  number;
  epIn:      number;
  epOut:     number;
  maxPacket: number;
}

function findAdbIface(device: USBDevice): AdbIface | null {
  for (const cfg of device.configurations) {
    for (const iface of cfg.interfaces) {
      for (const alt of iface.alternates) {
        if (alt.interfaceClass === ADB_CLASS &&
            alt.interfaceSubclass === ADB_SUBCLASS &&
            alt.interfaceProtocol === ADB_PROTOCOL) {
          let epIn = -1, epOut = -1, maxPacket = 512;
          for (const ep of alt.endpoints) {
            if (ep.type !== 'bulk') continue;
            if (ep.direction === 'in')  { epIn  = ep.endpointNumber; maxPacket = ep.packetSize; }
            if (ep.direction === 'out') { epOut = ep.endpointNumber; }
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

function encodeMsg(cmd: number, arg0: number, arg1: number, data: Uint8Array): Uint8Array {
  const msg = new Uint8Array(24 + data.length);
  const dv  = new DataView(msg.buffer);
  dv.setUint32(0,  cmd,                         true);
  dv.setUint32(4,  arg0,                        true);
  dv.setUint32(8,  arg1,                        true);
  dv.setUint32(12, data.length,                 true);
  dv.setUint32(16, crc32(data),                 true);
  dv.setUint32(20, (cmd ^ 0xffffffff) >>> 0,    true);
  msg.set(data, 24);
  return msg;
}

// ── Stream 管理 ───────────────────────────────────────────────

interface Stream {
  remoteId: number;
  onData:   (d: Uint8Array) => void;
  onClose?: () => void;
}

// ── AdbDevice（主类）─────────────────────────────────────────

export type AdbStatus = 'disconnected' | 'connecting' | 'auth' | 'connected' | 'error';

export class AdbDevice {
  private dev:       USBDevice;
  private iface:     AdbIface;
  private privKey!:  CryptoKey;
  private pubStr!:   string;
  private lid      = 1;
  private streams  = new Map<number, Stream>();
  private openWait = new Map<number, (rid: number) => void>();
  private running  = false;

  private constructor(dev: USBDevice, iface: AdbIface) {
    this.dev   = dev;
    this.iface = iface;
  }

  // 请求设备（调用浏览器 USB 选择器）
  static async request(): Promise<AdbDevice> {
    const dev = await navigator.usb.requestDevice({
      filters: [{ classCode: ADB_CLASS, subclassCode: ADB_SUBCLASS, protocolCode: ADB_PROTOCOL }],
    });
    const iface = findAdbIface(dev);
    if (!iface) throw new Error('未找到 ADB 接口，请确认已开启 USB 调试');

    await dev.open();
    if (dev.configuration === null) await dev.selectConfiguration(1);
    await dev.claimInterface(iface.ifaceNum);
    return new AdbDevice(dev, iface);
  }

  // 连接 & 认证
  async connect(onStatus?: (s: AdbStatus, msg?: string) => void): Promise<void> {
    onStatus?.('connecting');
    const { privKey, pubStr } = await getOrCreateKey();
    this.privKey = privKey;
    this.pubStr  = pubStr;

    await this.send(A_CNXN, ADB_VERSION, ADB_MAXDATA, te(ADB_BANNER));

    onStatus?.('auth', '等待认证...');
    await this.doAuth();

    this.running = true;
    void this.loop();
    onStatus?.('connected');
  }

  private async doAuth(): Promise<void> {
    const msg = await this.readMsg();
    if (msg.cmd === A_CNXN) return; // 已信任

    if (msg.cmd !== A_AUTH || msg.arg0 !== AUTH_TOKEN) throw new Error('协议错误：期望 AUTH TOKEN');

    // 签名挑战
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', this.privKey, new Uint8Array(msg.data)));
    await this.send(A_AUTH, AUTH_SIGNATURE, 0, sig);

    const resp = await this.readMsg();
    if (resp.cmd === A_CNXN) return; // 签名认证成功

    // 密钥不在信任列表，发送公钥 → 设备弹窗
    if (resp.cmd === A_AUTH && resp.arg0 === AUTH_TOKEN) {
      await this.send(A_AUTH, AUTH_RSAPUBLICKEY, 0, te(this.pubStr));
      const final = await this.readMsg();
      if (final.cmd !== A_CNXN) throw new Error('认证失败，请在设备屏幕上点击"允许 USB 调试"');
      return;
    }
    throw new Error('认证失败');
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const msg = await this.readMsg();
        const localId = msg.arg1;

        if (msg.cmd === A_OKAY) {
          const res = this.openWait.get(localId);
          if (res) { this.openWait.delete(localId); res(msg.arg0); }
        } else if (msg.cmd === A_WRTE) {
          const s = this.streams.get(localId);
          if (s) {
            s.onData(msg.data);
            await this.send(A_OKAY, localId, msg.arg0, new Uint8Array(0));
          }
        } else if (msg.cmd === A_CLSE) {
          const s = this.streams.get(localId);
          s?.onClose?.();
          this.streams.delete(localId);
        }
      } catch { break; }
    }
  }

  // 执行 shell 命令（command 结束后 resolve）
  async shell(command: string, onData: (txt: string) => void): Promise<void> {
    const lid = this.lid++;
    const rid = await this.open(lid, `shell:${command}`);
    return new Promise(resolve => {
      this.streams.set(lid, {
        remoteId: rid,
        onData: d => onData(td(d)),
        onClose: () => { this.streams.delete(lid); resolve(); },
      });
    });
  }

  // 启动 Logcat（返回停止函数）
  async startLogcat(onLine: (line: string) => void, filter?: string): Promise<() => void> {
    const lid = this.lid++;
    const cmd = filter ? `logcat -v time ${filter}` : 'logcat -v time';
    const rid = await this.open(lid, `shell:${cmd}`);
    let buf = '';
    this.streams.set(lid, {
      remoteId: rid,
      onData: d => {
        buf += td(d);
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const l of lines) onLine(l);
      },
    });
    return () => {
      const s = this.streams.get(lid);
      if (s) { void this.send(A_CLSE, lid, s.remoteId, new Uint8Array(0)); }
      this.streams.delete(lid);
    };
  }

  private async open(lid: number, service: string): Promise<number> {
    await this.send(A_OPEN, lid, 0, te(service + '\0'));
    return new Promise(resolve => this.openWait.set(lid, resolve));
  }

  private async send(cmd: number, arg0: number, arg1: number, data: Uint8Array): Promise<void> {
    const pkt = encodeMsg(cmd, arg0, arg1, data);
    await this.dev.transferOut(this.iface.epOut, pkt.slice(0, 24));
    for (let off = 24; off < pkt.length; off += this.iface.maxPacket) {
      await this.dev.transferOut(this.iface.epOut, pkt.slice(off, off + this.iface.maxPacket));
    }
  }

  private async readMsg(): Promise<{ cmd: number; arg0: number; arg1: number; data: Uint8Array }> {
    const hdr = await this.dev.transferIn(this.iface.epIn, 24);
    if (!hdr.data || hdr.data.byteLength < 24) throw new Error('消息头读取失败');
    const dv   = hdr.data;
    const cmd  = dv.getUint32(0,  true);
    const arg0 = dv.getUint32(4,  true);
    const arg1 = dv.getUint32(8,  true);
    const dlen = dv.getUint32(12, true);

    if (dlen === 0) return { cmd, arg0, arg1, data: new Uint8Array(0) };

    const chunks: Uint8Array[] = [];
    let remaining = dlen;
    while (remaining > 0) {
      const r = await this.dev.transferIn(this.iface.epIn, Math.min(remaining, this.iface.maxPacket));
      if (!r.data) break;
      chunks.push(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength));
      remaining -= r.data.byteLength;
    }
    const data = new Uint8Array(dlen);
    let off = 0;
    for (const c of chunks) { data.set(c, off); off += c.length; }
    return { cmd, arg0, arg1, data };
  }

  async disconnect(): Promise<void> {
    this.running = false;
    try {
      await this.dev.releaseInterface(this.iface.ifaceNum);
      await this.dev.close();
    } catch { /* ignore */ }
  }

  get isConnected() { return this.running; }
}

// ── 浏览器兼容性检查 ──────────────────────────────────────────

export function checkWebUsbSupport(): string | null {
  if (typeof navigator === 'undefined') return '非浏览器环境';
  if (!('usb' in navigator)) return '浏览器不支持 WebUSB，请使用 Chrome 或 Edge 89+';
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    return 'WebUSB 需要 HTTPS 或 localhost 环境';
  }
  return null;
}

export function checkWebSerialSupport(): string | null {
  if (typeof navigator === 'undefined') return '非浏览器环境';
  if (!('serial' in navigator)) return '浏览器不支持 Web Serial，请使用 Chrome 或 Edge 89+';
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    return 'Web Serial 需要 HTTPS 或 localhost 环境';
  }
  return null;
}
