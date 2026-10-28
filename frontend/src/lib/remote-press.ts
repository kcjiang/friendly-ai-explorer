import { remoteCommand } from "./remote-keys";

export type RemoteFeedback = "send" | "disconnected" | "error";

type Clock = {
  setTimeout: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

export function createRemotePressController(
  options: {
    isConnected: () => boolean;
    send: (bytes: Uint8Array, onTransmit: () => void) => Promise<void>;
    feedback: (value: RemoteFeedback) => void;
    sent: (id: string) => void;
    error: (error: unknown) => void;
  },
  clock: Clock = {
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (timer) => clearTimeout(timer),
  },
) {
  let held: { id: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const repeatable = new Set([
    "up",
    "down",
    "left",
    "right",
    "volumeUp",
    "volumeDown",
  ]);

  function stop() {
    held = null;
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
  }

  async function transmit(id: string) {
    const bytes = remoteCommand(id);
    if (disposed || !bytes) return false;
    if (!options.isConnected()) {
      stop();
      options.feedback("disconnected");
      return false;
    }
    try {
      await options.send(bytes, () => {
        if (!disposed) options.feedback("send");
      });
      if (!disposed) options.sent(id);
      return true;
    } catch (error) {
      stop();
      if (!disposed) {
        options.feedback("error");
        options.error(error);
      }
      return false;
    }
  }

  async function repeat(press: { id: string }) {
    timer = undefined;
    if (disposed || held !== press) return;
    const ok = await transmit(press.id);
    // Wait for each write before scheduling another one: no repeat queue can
    // keep changing channels/volume after release, even on a slow serial port.
    if (ok && !disposed && held === press) {
      timer = clock.setTimeout(() => void repeat(press), 180);
    }
  }

  return {
    start(id: string) {
      if (disposed) return;
      stop();
      if (!remoteCommand(id)) return;
      const press = { id };
      held = press;
      void transmit(id).then((ok) => {
        if (ok && !disposed && held === press && repeatable.has(id)) {
          timer = clock.setTimeout(() => void repeat(press), 450);
        }
      });
    },
    stop,
    dispose() {
      disposed = true;
      stop();
    },
  };
}
