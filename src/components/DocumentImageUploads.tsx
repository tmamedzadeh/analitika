import {
  DocumentImageUploadContext as Context,
  useDocumentImageUploads,
  type Task,
  type Files,
} from "@/lib/document-image-context";
import { ClientImageError, uploadImageBytes, networkMessage } from "@/lib/image-upload-client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelDocumentImageUpload,
  completeDocumentImage,
  getDocumentImageState,
  prepareDocumentImage,
} from "@/lib/document-images.functions";
import { Button } from "./ui/button";

export function DocumentImageUploadProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  const files = useRef(new Map<string, File>());
  const controllers = useRef(new Map<string, AbortController>());
  const generations = useRef(new Map<string, number>());
  const finalizing = useRef(Promise.resolve());
  const queryClient = useQueryClient();
  const update = useCallback(
    (id: string, task: Task) => setTasks((previous) => ({ ...previous, [id]: task })),
    [],
  );
  const retry = useCallback(
    async (documentId: string, slotId: string, selected?: File) => {
      if (controllers.current.has(slotId)) return;
      const controller = new AbortController();
      controllers.current.set(slotId, controller);
      if (selected) files.current.set(slotId, selected);
      try {
        const slots = await getDocumentImageState({
          data: { documentId },
          signal: controller.signal,
        });
        if (!Array.isArray(slots)) throw new ClientImageError(slots.error, "server");
        const slot = slots.find((s) => s.id === slotId);
        if (!slot) throw new ClientImageError(networkMessage, "server");
        if (slot.state === "ready") {
          update(slotId, { state: "ready" });
          return;
        }
        const file = files.current.get(slotId);
        let generation = slot.generation;
        generations.current.set(slotId, generation);
        if (file) {
          if (
            !file.size ||
            file.size > 10 * 1024 * 1024 ||
            !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
            !file.name.trim() ||
            file.name.length > 255
          )
            throw new ClientImageError(
              "JPG, PNG və ya WebP faylı seçin. Ölçü 10 MiB-dən çox olmamalıdır.",
              "validation",
            );
          update(slotId, { state: "uploading" });
          const prepared = await prepareDocumentImage({
            data: {
              documentId,
              uploadId: slotId,
              generation,
              file: { name: file.name, mime: file.type as "image/png", size: file.size },
            },
            signal: controller.signal,
          });
          if ("error" in prepared) throw new ClientImageError(prepared.error, "server");
          generation = prepared.generation;
          generations.current.set(slotId, generation);
          if (prepared.state !== "ready")
            await uploadImageBytes(prepared.url, file, controller.signal, (loaded, total) =>
              update(slotId, { state: "uploading", loaded, total }),
            );
        }
        if (controller.signal.aborted) return;
        update(slotId, { state: "checking" });
        const previous = finalizing.current;
        let release!: () => void;
        finalizing.current = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          if (controller.signal.aborted) return;
          const result = await completeDocumentImage({
            data: { documentId, uploadId: slotId, generation },
            signal: controller.signal,
          });
          if ("error" in result) throw new ClientImageError(result.error, "server");
          update(slotId, { state: "ready" });
          files.current.delete(slotId);
        } finally {
          release();
        }
      } catch (error) {
        if (!controller.signal.aborted)
          update(slotId, {
            state: "failed",
            error: error instanceof ClientImageError ? error.message : networkMessage,
          });
      } finally {
        controllers.current.delete(slotId);
        void queryClient.invalidateQueries({ queryKey: ["document", documentId] });
        void queryClient.invalidateQueries({ queryKey: ["document-images", documentId] });
      }
    },
    [queryClient, update],
  );
  const start = useCallback(
    (documentId: string, selected: Files) => {
      void (async () => {
        const slots = await getDocumentImageState({ data: { documentId } });
        if (!Array.isArray(slots)) return;
        queryClient.setQueryData(["document-images", documentId], slots);
        const queue = slots.filter((s) => s.state !== "ready");
        for (const slot of queue) {
          const file = selected.get(slot.clientFileId);
          if (file) files.current.set(slot.id, file);
        }
        const worker = async () => {
          while (queue.length) {
            const slot = queue.shift()!;
            await retry(documentId, slot.id);
          }
        };
        await Promise.all([worker(), worker()]);
      })().catch(() => {
        /* Durable slots remain visible for retry after navigation/reload. */
      });
    },
    [retry, queryClient],
  );
  const cancel = useCallback(
    async (documentId: string, slotId: string, generation: number) => {
      controllers.current.get(slotId)?.abort();
      files.current.delete(slotId);
      try {
        const result = await cancelDocumentImageUpload({
          data: {
            documentId,
            uploadId: slotId,
            generation: generations.current.get(slotId) ?? generation,
          },
        });
        update(
          slotId,
          "error" in result ? { state: "failed", error: result.error } : { state: "cancelled" },
        );
      } catch {
        update(slotId, { state: "failed", error: networkMessage });
      }
      void queryClient.invalidateQueries({ queryKey: ["document-images", documentId] });
    },
    [queryClient, update],
  );
  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort();
      files.current.clear();
    },
    [],
  );
  return <Context.Provider value={{ tasks, start, retry, cancel }}>{children}</Context.Provider>;
}

export function DocumentImageUploadStatus({
  documentId,
  canManage,
}: {
  documentId: string;
  canManage: boolean;
}) {
  const manager = useDocumentImageUploads();
  const queryClient = useQueryClient();
  const published = useRef("");
  const query = useQuery({
    queryKey: ["document-images", documentId],
    queryFn: () => getDocumentImageState({ data: { documentId } }),
    refetchInterval: (q) =>
      Array.isArray(q.state.data) &&
      q.state.data.some((s) => s.state === "uploading" || s.state === "checking")
        ? 2500
        : false,
  });
  const recovered = useRef(new Set<string>());
  useEffect(() => {
    if (!Array.isArray(query.data)) return;
    const signature = query.data
      .filter((slot) => slot.state === "ready")
      .map((slot) => slot.id)
      .join(",");
    if (signature !== published.current) {
      published.current = signature;
      void queryClient.invalidateQueries({ queryKey: ["document", documentId] });
    }
  }, [query.data, queryClient, documentId]);
  useEffect(() => {
    if (!manager || !canManage || !Array.isArray(query.data)) return;
    for (const slot of query.data)
      if (
        ["uploading", "checking"].includes(slot.state) &&
        !manager.tasks[slot.id] &&
        !recovered.current.has(slot.id)
      ) {
        recovered.current.add(slot.id);
        void manager.retry(documentId, slot.id);
      }
  }, [manager, canManage, query.data, documentId]);
  if (!Array.isArray(query.data) || !query.data.length) return null;
  return (
    <section className="panel mt-5 space-y-3 p-4" aria-label="Şəkillərin yüklənməsi">
      <h2 className="font-semibold">Şəkillər</h2>
      {query.data.map((slot) => {
        const task =
          slot.state === "ready" || slot.state === "cancelled"
            ? { state: slot.state }
            : (manager?.tasks[slot.id] ?? { state: slot.state });
        const label =
          (
            {
              pending: "Yüklənir",
              uploading: "Yüklənir",
              checking: "Yoxlanılır",
              ready: "Hazırdır",
              failed: "Xəta",
              cancelled: "Ləğv edilib",
              expired: "Yenidən fayl seçin",
            } as Record<string, string>
          )[task.state] ?? "Xəta";
        return (
          <div key={slot.id} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="min-w-0 truncate">{slot.name}</span>
              <span role="status">{label}</span>
            </div>
            {task.total !== undefined && task.total > 0 && (
              <>
                <progress
                  className="mt-2 w-full"
                  max={task.total}
                  value={task.loaded}
                  aria-label="Göndərilən baytlar"
                />
                <span className="text-xs text-muted-foreground">
                  {task.loaded} / {task.total} bayt
                </span>
              </>
            )}
            {task.error && (
              <p role="alert" className="mt-2 text-destructive">
                {task.error}
              </p>
            )}
            {canManage && task.state !== "ready" && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void manager?.retry(documentId, slot.id)}
                >
                  Yenidən cəhd et
                </Button>
                <label className="pill cursor-pointer">
                  Faylı yenidən seç
                  <input
                    type="file"
                    className="sr-only"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void manager?.retry(documentId, slot.id, file);
                      e.target.value = "";
                    }}
                  />
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void manager?.cancel(documentId, slot.id, slot.generation)}
                >
                  Ləğv et
                </Button>
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Mətn saxlanılıb. Səhifə yeniləndikdə göndərilməmiş faylı yenidən seçmək lazımdır.
      </p>
    </section>
  );
}
