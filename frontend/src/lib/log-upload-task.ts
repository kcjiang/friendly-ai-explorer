export type LogUploadState = {
  phase: "idle" | "uploading" | "success" | "error" | "cancelled" | "empty";
  progress: number | null;
  filename: string;
  error?: unknown;
  revision: number;
};
export type LogUploadNotice = LogUploadState & {
  onClose: () => void;
  cancel?: () => void;
};

export function createLogUploadTask(options: {
  upload: (
    text: string,
    signal: AbortSignal,
    progress: (percent: number | null) => void,
  ) => Promise<{ filename: string }>;
  notices: {
    add: (notice: LogUploadNotice) => string;
    update: (id: string, notice: LogUploadNotice) => void;
  };
}) {
  let state: LogUploadState = {
    phase: "idle",
    progress: null,
    filename: "",
    revision: 0,
  };
  let visible: string | null = null;
  let abort: AbortController | null = null;
  const listeners = new Set<() => void>();
  function publish(next: LogUploadState) {
    state = next;
    listeners.forEach((fn) => fn());
  }
  function cancel() {
    abort?.abort();
  }
  function present() {
    let id = visible;
    const notice: LogUploadNotice = {
      ...state,
      onClose: () => {
        if (visible === id) visible = null;
      },
      cancel: state.phase === "uploading" ? cancel : undefined,
    };
    if (id) options.notices.update(id, notice);
    else {
      id = options.notices.add(notice);
      visible = id;
    }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancel,
    async start(text: string) {
      if (state.phase === "uploading") {
        present();
        return;
      }
      if (!text.trim()) {
        publish({ ...state, phase: "empty" });
        visible = null;
        present();
        return;
      }
      const controller = new AbortController();
      abort = controller;
      // A completed notice belongs to the previous upload. The new task gets
      // its own notice; its progress updates and final result reuse that ID.
      visible = null;
      publish({
        phase: "uploading",
        progress: 0,
        filename: "",
        revision: state.revision,
      });
      present();
      try {
        const result = await options.upload(
          text,
          controller.signal,
          (percent) => {
            if (controller.signal.aborted || abort !== controller) return;
            publish({
              ...state,
              progress:
                percent === null
                  ? null
                  : Math.max(0, Math.min(100, Math.floor(percent))),
            });
            // Dismissed progress stays dismissed until completion or explicit reopen.
            if (visible) present();
          },
        );
        publish({
          ...state,
          phase: "success",
          progress: 100,
          filename: result.filename,
          revision: state.revision + 1,
        });
      } catch (error) {
        publish({
          ...state,
          phase: controller.signal.aborted ? "cancelled" : "error",
          error,
        });
      } finally {
        abort = null;
        present();
      }
    },
  };
}
