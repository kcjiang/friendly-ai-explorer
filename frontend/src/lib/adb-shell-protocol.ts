export function shellPacket(id: number, data: Uint8Array) {
  const packet = new Uint8Array(data.length + 5);
  packet[0] = id;
  new DataView(packet.buffer).setUint32(1, data.length, true);
  packet.set(data, 5);
  return packet;
}
export class ShellOutputDecoder {
  private pending = new Uint8Array();
  constructor(
    private output: (data: Uint8Array) => void,
    private exit: () => void,
  ) {}
  push(data: Uint8Array) {
    const buffer = new Uint8Array(this.pending.length + data.length);
    buffer.set(this.pending);
    buffer.set(data, this.pending.length);
    let offset = 0;
    while (buffer.length - offset >= 5) {
      const id = buffer[offset];
      const length = new DataView(
        buffer.buffer,
        buffer.byteOffset + offset + 1,
        4,
      ).getUint32(0, true);
      if (length > 1024 * 1024 || ![1, 2, 3].includes(id))
        throw new Error("Invalid ADB shell v2 frame");
      if (buffer.length - offset < length + 5) break;
      const payload = buffer.slice(offset + 5, offset + 5 + length);
      if (id === 3) this.exit();
      else this.output(payload);
      offset += length + 5;
    }
    this.pending = buffer.slice(offset);
  }
}
