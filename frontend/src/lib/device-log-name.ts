/** Filenames use the browser's wall clock; server upload timestamps remain UTC. */
export function deviceLogStem(kind: string, date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const random = crypto
    .getRandomValues(new Uint16Array(1))[0]
    .toString(16)
    .padStart(4, "0");
  return `${kind}_${day}_${time}_${random}`;
}
export function deviceLogName(kind: string, date = new Date()): string {
  return `${deviceLogStem(kind, date)}.log`;
}
