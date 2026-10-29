"use client";

import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";

export type UploadPurpose = "storage" | "knowledge" | "log" | "attachment";
export type UploadOptions = {
  purpose: UploadPurpose;
  space?: "public" | "personal";
  parent?: string;
  conflict?: "skip" | "keep";
  ticket_id?: string;
  device_type?: "adb" | "serial";
  client_timezone_offset_minutes?: number;
  description?: string;
};
export type UploadReceipt = {
  id: string;
  filename: string;
  size: number;
  space: string;
  parent: string;
  purpose: UploadPurpose;
  status: string;
  chunk_size: number;
  parts: { size: number; sha256: string }[];
  fingerprint: string;
  entry_id: string | null;
  context: {
    ticket_id?: string;
    device_type?: "adb" | "serial";
    client_timezone_offset_minutes?: number;
    bound?: boolean;
  };
};
export type UploadJob = {
  key: string;
  filename: string;
  size: number;
  phase:
    | "queued"
    | "hashing"
    | "uploading"
    | "saving"
    | "complete"
    | "skipped"
    | "paused"
    | "error"
    | "cancelled";
  percent: number;
  speed: number;
  error?: string;
  server?: UploadReceipt;
  options: UploadOptions;
  needsFile: boolean;
};
type Runtime = {
  requestId?: string;
  file?: File;
  abort?: AbortController;
  resolve?: (value: UploadReceipt) => void;
  reject?: (error: unknown) => void;
  progress?: (percent: number) => void;
};
let jobs: UploadJob[] = [];
const runtime = new Map<string, Runtime>();
const listeners = new Set<() => void>();
let owner: string | null = null;
let running = false;
let epoch = 0;
let revision = 0;
function emit() {
  jobs = [...jobs];
  listeners.forEach((fn) => fn());
}
function update(key: string, patch: Partial<UploadJob>) {
  jobs = jobs.map((j) => (j.key === key ? { ...j, ...patch } : j));
  emit();
}
function changed() {
  revision++;
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("file-storage-changed"));
}
async function hash(data: ArrayBuffer) {
  const bytes = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(bytes), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}
async function fingerprint(file: File) {
  return hash(
    await new Blob([
      file.name,
      String(file.size),
      String(file.lastModified),
      file.slice(0, 65536),
      file.slice(Math.max(0, file.size - 65536)),
    ]).arrayBuffer(),
  );
}
export const uploadManager = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  snapshot: () => jobs,
  revision: () => revision,
  async bind(userId: string | null) {
    if (owner === userId) return;
    epoch++;
    for (const item of runtime.values()) {
      item.abort?.abort();
      item.reject?.(new Error("Upload session changed"));
    }
    runtime.clear();
    jobs = [];
    owner = userId;
    emit();
    if (!userId) return;
    const generation = epoch;
    try {
      const r = await api.get<UploadReceipt[]>("/api/v1/uploads");
      if (generation !== epoch) return;
      const restored: UploadJob[] = r.data
        .filter(
          (t) =>
            ["active", "complete", "skipped"].includes(t.status) &&
            !jobs.some((j) => j.server?.id === t.id || j.key === t.id),
        )
        .map((t) => ({
          key: t.id,
          filename: t.filename,
          size: t.size,
          phase:
            t.status === "active"
              ? "paused"
              : t.status === "skipped"
                ? "skipped"
                : "complete",
          percent:
            t.status === "active"
              ? Math.floor(
                  (t.parts.reduce((s, p) => s + p.size, 0) /
                    Math.max(1, t.size)) *
                    100,
                )
              : 100,
          speed: 0,
          server: t,
          options: {
            purpose: t.purpose,
            space: t.space === "public" ? "public" : "personal",
            parent: t.parent,
            ticket_id: t.context.ticket_id,
            device_type: t.context.device_type,
          },
          needsFile: t.status === "active",
        }));
      jobs = [...jobs, ...restored];
      emit();
    } catch {
      /* A failed history read does not prevent new uploads. */
    }
  },
  enqueue(
    file: File,
    options: UploadOptions,
    callbacks?: { signal?: AbortSignal; progress?: (percent: number) => void },
  ) {
    const key = crypto.randomUUID();
    const promise = new Promise<UploadReceipt>((resolve, reject) => {
      runtime.set(key, {
        file,
        resolve,
        reject,
        progress: callbacks?.progress,
      });
      jobs = [
        ...jobs,
        {
          key,
          filename: file.name,
          size: file.size,
          phase: "queued",
          percent: 0,
          speed: 0,
          options,
          needsFile: false,
        },
      ];
      emit();
      if (callbacks?.signal) {
        callbacks.signal.addEventListener(
          "abort",
          () => void uploadManager.cancel(key),
          { once: true },
        );
        if (callbacks.signal.aborted) void uploadManager.cancel(key);
      }
      void pump();
    });
    return { key, promise };
  },
  pause(key: string) {
    runtime.get(key)?.abort?.abort();
    update(key, { phase: "paused", speed: 0 });
  },
  resume(key: string, file?: File) {
    const item = runtime.get(key) || {};
    if (file) item.file = file;
    runtime.set(key, item);
    if (!item.file) {
      update(key, { needsFile: true });
      return;
    }
    update(key, { phase: "queued", needsFile: false, error: undefined });
    void pump();
  },
  async cancel(key: string) {
    const state = jobs.find((j) => j.key === key);
    if (!state) return;
    const item = runtime.get(key);
    item?.abort?.abort();
    update(key, { phase: "cancelled", speed: 0 });
    try {
      if (state.server) await api.delete(`/api/v1/uploads/${state.server.id}`);
      changed();
    } catch (e) {
      update(key, { phase: "error", error: errorMessage(e) });
    }
    item?.reject?.(new DOMException("Upload cancelled", "AbortError"));
    if (item) {
      item.resolve = undefined;
      item.reject = undefined;
    }
  },
  dismiss(key: string) {
    jobs = jobs.filter((j) => j.key !== key);
    runtime.delete(key);
    emit();
  },
};
async function pump() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const job = jobs.find((j) => j.phase === "queued");
      if (!job) break;
      await perform(job);
    }
  } finally {
    running = false;
  }
}
async function perform(job: UploadJob) {
  const item = runtime.get(job.key);
  if (!item?.file) return;
  const file = item.file;
  const controller = new AbortController();
  item.abort = controller;
  const generation = epoch;
  try {
    update(job.key, { phase: "hashing", speed: 0 });
    const print = await fingerprint(file);
    const policy = (
      await api.get("/api/v1/uploads/policy", { signal: controller.signal })
    ).data;
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    let limit =
      policy.limits_mb[job.options.purpose] ?? policy.limits_mb.storage;
    if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext))
      limit = Math.min(limit, policy.limits_mb.image);
    else if (
      ["mp4", "webm", "mov", "mkv", "avi", "ogg"].includes(ext) &&
      !["knowledge", "log"].includes(job.options.purpose)
    )
      limit = policy.limits_mb.video;
    if (file.size > limit * 1024 ** 2)
      throw new Error(`File exceeds ${limit} MiB / 文件超过 ${limit} MiB 上限`);
    let fetched: UploadReceipt | undefined;
    if (job.server) {
      if (job.server.fingerprint !== print)
        throw new Error("所选文件与原上传文件不一致 / File mismatch");
      try {
        fetched = (
          await api.get<UploadReceipt>(`/api/v1/uploads/${job.server.id}`, {
            signal: controller.signal,
          })
        ).data;
      } catch (error) {
        const status = (error as { response?: { status: number } }).response
          ?.status;
        if (status !== 404 && status !== 410) throw error;
      }
      if (
        fetched &&
        !["active", "complete", "skipped"].includes(fetched.status)
      )
        fetched = undefined;
    }
    let task: UploadReceipt;
    if (fetched) task = fetched;
    else {
      item.requestId =
        item.requestId || (job.server ? crypto.randomUUID() : job.key);
      task = (
        await api.post<UploadReceipt>("/api/v1/uploads", {
          ...job.options,
          upload_id: item.requestId,
          filename: file.name,
          size: file.size,
          fingerprint: print,
        })
      ).data;
      if (generation !== epoch) return;
      update(job.key, { server: task });
    }
    if (controller.signal.aborted) {
      if (jobs.find((j) => j.key === job.key)?.phase === "cancelled")
        await api.delete(`/api/v1/uploads/${task.id}`);
      return;
    }
    if (task.status === "complete" || task.status === "skipped") {
      done(job, task, item);
      return;
    }
    if (task.status !== "active")
      throw new Error("上传已失效，请重新上传 / Upload expired");
    let offset = 0;
    for (const part of task.parts) {
      if (controller.signal.aborted)
        throw new DOMException("Paused", "AbortError");
      if (
        (await hash(
          await file.slice(offset, offset + part.size).arrayBuffer(),
        )) !== part.sha256
      )
        throw new Error(
          "The selected file does not match / 所选文件与原上传文件不一致",
        );
      offset += part.size;
    }
    while (offset < file.size) {
      if (controller.signal.aborted)
        throw new DOMException("Paused", "AbortError");
      const chunk = file.slice(
        offset,
        Math.min(file.size, offset + task.chunk_size),
      );
      const digest = await hash(await chunk.arrayBuffer());
      const index = task.parts.length;
      let sent = false;
      for (let attempt = 0; attempt < 3 && !sent; attempt++) {
        const started = Date.now();
        try {
          const current = offset;
          const r: { data: UploadReceipt } = await api.put<UploadReceipt>(
            `/api/v1/uploads/${task.id}/parts/${index}`,
            chunk,
            {
              params: { sha256: digest },
              headers: { "Content-Type": "application/octet-stream" },
              signal: controller.signal,
              timeout: 600000,
              onUploadProgress: (e) => {
                const percent = Math.min(
                  99,
                  Math.floor(
                    ((current + e.loaded) / Math.max(1, file.size)) * 100,
                  ),
                );
                update(job.key, {
                  phase: "uploading",
                  percent,
                  speed:
                    e.loaded / Math.max(0.1, (Date.now() - started) / 1000),
                });
                item.progress?.(percent);
              },
            },
          );
          task = r.data;
          sent = true;
        } catch (error) {
          if (controller.signal.aborted || attempt === 2) throw error;
          const status = (
            await api.get<UploadReceipt>(`/api/v1/uploads/${task.id}`, {
              signal: controller.signal,
            })
          ).data;
          if (status.parts[index]?.sha256 === digest) {
            task = status;
            sent = true;
          }
        }
      }
      offset += chunk.size;
      update(job.key, { server: task });
    }
    update(job.key, { phase: "saving", percent: 99, speed: 0 });
    let result: UploadReceipt;
    try {
      result = (
        await api.post<UploadReceipt>(
          `/api/v1/uploads/${task.id}/complete`,
          {},
          { signal: controller.signal, timeout: 600000 },
        )
      ).data;
    } catch (error) {
      if (controller.signal.aborted) throw error;
      result = (await api.get<UploadReceipt>(`/api/v1/uploads/${task.id}`))
        .data;
      if (!["complete", "skipped"].includes(result.status)) throw error;
    }
    if (generation === epoch) done(job, result, item);
  } catch (error) {
    if (generation !== epoch) return;
    if (controller.signal.aborted) return;
    const current = jobs.find((j) => j.key === job.key);
    if (current?.phase === "cancelled" || current?.phase === "paused") return;
    update(job.key, { phase: "error", speed: 0, error: errorMessage(error) });
    item.reject?.(error);
    item.reject = undefined;
    item.resolve = undefined;
  }
}
function done(job: UploadJob, result: UploadReceipt, item: Runtime) {
  update(job.key, {
    phase: result.status === "skipped" ? "skipped" : "complete",
    percent: 100,
    speed: 0,
    server: result,
  });
  item.progress?.(100);
  item.resolve?.(result);
  item.resolve = undefined;
  item.reject = undefined;
  changed();
}

export function enqueueUpload(file: File, options: UploadOptions) {
  const task = uploadManager.enqueue(file, options);
  void task.promise.catch(() => {});
  return task.key;
}
