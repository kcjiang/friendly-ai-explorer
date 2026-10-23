export type WindowRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type Viewport = { width: number; height: number };
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const margin = 8;
export function centerWindow(
  size: Pick<WindowRect, "width" | "height">,
  viewport: Viewport,
): WindowRect {
  const fitted = fitWindow({ ...size, x: 0, y: 0 }, viewport);
  return {
    ...fitted,
    x: (viewport.width - fitted.width) / 2,
    y: (viewport.height - fitted.height) / 2,
  };
}
export function fitWindow(rect: WindowRect, viewport: Viewport): WindowRect {
  const width = Math.min(
    Math.max(280, rect.width),
    Math.max(1, viewport.width - margin * 2),
  );
  const height = Math.min(
    Math.max(180, rect.height),
    Math.max(1, viewport.height - margin * 2),
  );
  return {
    width,
    height,
    x: Math.max(margin, Math.min(rect.x, viewport.width - width - margin)),
    y: Math.max(margin, Math.min(rect.y, viewport.height - height - margin)),
  };
}
export function resizeWindow(
  rect: WindowRect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  viewport: Viewport,
): WindowRect {
  const minWidth = Math.min(280, viewport.width - margin * 2),
    minHeight = Math.min(180, viewport.height - margin * 2);
  let left = rect.x,
    right = rect.x + rect.width,
    top = rect.y,
    bottom = rect.y + rect.height;
  if (edge.includes("w"))
    left = Math.max(margin, Math.min(left + dx, right - minWidth));
  if (edge.includes("e"))
    right = Math.min(
      viewport.width - margin,
      Math.max(right + dx, left + minWidth),
    );
  if (edge.includes("n"))
    top = Math.max(margin, Math.min(top + dy, bottom - minHeight));
  if (edge.includes("s"))
    bottom = Math.min(
      viewport.height - margin,
      Math.max(bottom + dy, top + minHeight),
    );
  return { x: left, y: top, width: right - left, height: bottom - top };
}
