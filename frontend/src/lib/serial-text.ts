let gbkBytes: Map<string, number> | undefined;
/** GBK sending is explicit: never silently replace an unsupported character. */
export function encodeSerialText(
  text: string,
  encoding: "utf-8" | "gbk",
): Uint8Array {
  if (encoding === "utf-8") return new TextEncoder().encode(text);
  if (!gbkBytes) {
    gbkBytes = new Map();
    const decoder = new TextDecoder("gbk", { fatal: true });
    for (let lead = 0x81; lead <= 0xfe; lead++) {
      for (let trail = 0x40; trail <= 0xfe; trail++) {
        if (trail === 0x7f) continue;
        try {
          const char = decoder.decode(new Uint8Array([lead, trail]));
          if (Array.from(char).length === 1 && !gbkBytes.has(char))
            gbkBytes.set(char, (lead << 8) | trail);
        } catch {
          /* unused code positions */
        }
      }
    }
  }
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 128) bytes.push(code);
    else if (char === "€") bytes.push(0x80);
    else {
      const encoded = gbkBytes.get(char);
      if (encoded === undefined)
        throw new Error(
          `GBK cannot encode ${char}; select UTF-8 to send this character.`,
        );
      bytes.push(encoded >> 8, encoded & 255);
    }
  }
  return Uint8Array.from(bytes);
}
