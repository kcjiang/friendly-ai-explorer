export type PasteOptions = {
  delayMs: number;
  ending: "\r" | "\n" | "\r\n";
  appendEnter: boolean;
  bracketed: boolean;
};
export function planPaste(text: string, options: PasteOptions) {
  if (!text || text.length > 65536)
    throw new Error("Paste must contain 1–65,536 characters.");
  if (
    Array.from(text).some((char) => {
      const code = char.charCodeAt(0);
      return (
        (code < 32 && !["\t", "\r", "\n"].includes(char)) ||
        (code >= 127 && code <= 159)
      );
    })
  )
    throw new Error("Paste contains unsupported control characters.");
  if (
    !["\r", "\n", "\r\n"].includes(options.ending) ||
    !Number.isInteger(options.delayMs) ||
    options.delayMs < 0 ||
    options.delayMs > 5000
  )
    throw new Error("Invalid paste settings.");
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 2000) throw new Error("Paste is limited to 2,000 lines.");
  const chunks: string[] = [];
  lines.forEach((line, i) => {
    const value =
      line +
      (i < lines.length - 1 || (options.appendEnter && line)
        ? options.ending
        : "");
    for (let start = 0; start < value.length; ) {
      let end = Math.min(value.length, start + 256);
      if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
      if (value[end - 1] === "\r" && value[end] === "\n") end--;
      chunks.push(value.slice(start, end));
      start = end;
    }
  });
  return chunks;
}
