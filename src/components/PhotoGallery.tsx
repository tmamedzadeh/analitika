import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { Dialog, DialogPortal, DialogOverlay, DialogTitle, DialogClose } from "./ui/dialog";
import { loadPrivateImage } from "@/lib/private-image";

export type GalleryPhoto = {
  id: string;
  name: string;
  url: string;
  originalUrl?: string | undefined;
};
const errorLabel = "Şəkil əlçatan deyil. İcazəni yoxlayın və yenidən cəhd edin.";

function PrivateThumbnail({ photo, title }: { photo: GalleryPhoto; title: string }) {
  const [fallback, setFallback] = useState(false);
  const [source, setSource] = useState<string>();
  useEffect(() => {
    if (!fallback) return;
    const abort = new AbortController();
    let objectUrl: string | undefined;
    void loadPrivateImage(photo.url, abort.signal)
      .then((blob) => {
        if (!abort.signal.aborted) {
          objectUrl = URL.createObjectURL(blob);
          setSource(objectUrl);
        }
      })
      .catch(() => {});
    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.url, fallback]);
  return (
    <img
      src={source ?? photo.url}
      alt={photo.name || title}
      loading="lazy"
      decoding="async"
      onError={() => setFallback(true)}
      className="aspect-[4/3] h-full w-full object-cover transition-transform duration-300 motion-reduce:transition-none group-hover:scale-[1.025]"
    />
  );
}

/** One private gallery for both documents and bulletins. Assets only live in memory. */
export function PhotoGallery({ photos, title }: { photos: GalleryPhoto[]; title: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [asset, setAsset] = useState<{ id: string; url?: string; error?: boolean }>();
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [downloading, setDownloading] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const downloadController = useRef<AbortController | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({
    x: 0,
    y: 0,
    lastX: 0,
    lastY: 0,
    distance: 0,
    scale: 1,
    pinch: false,
    tap: 0,
  });
  const index = photos.findIndex((photo) => photo.id === selectedId);
  const photo = photos[index];
  const photoId = photo?.id;
  const photoUrl = photo?.url;
  const open = Boolean(photo);
  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    pointers.current.clear();
  };
  const close = () => {
    setSelectedId(null);
    setAsset(undefined);
    reset();
    downloadController.current?.abort();
  };
  const move = (direction: number) => {
    if (photos.length < 2) return;
    reset();
    setSelectedId(photos[(index + direction + photos.length) % photos.length]!.id);
  };
  const toggleZoom = () => {
    setZoom((value) => (value > 1 ? 1 : 2));
    setPan({ x: 0, y: 0 });
  };
  useEffect(() => {
    if (!photoId || !photoUrl) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void loadPrivateImage(photoUrl, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setAsset({ id: photoId, url: objectUrl });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAsset({ id: photoId, error: true });
      });
    return () => {
      controller.abort();
      downloadController.current?.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId, photoUrl, attempt]);
  useEffect(() => () => downloadController.current?.abort(), []);
  async function download() {
    if (!photo || downloading) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloading(true);
    try {
      const blob = await loadPrivateImage(
        photo.originalUrl ?? `${photo.url}?original=1`,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = photo.name || "photo";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      if (!controller.signal.aborted) setAsset({ id: photo.id, error: true });
    } finally {
      setDownloading(false);
    }
  }
  const distance = () => {
    const points = [...pointers.current.values()];
    return Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
  };
  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1)
      Object.assign(gesture.current, {
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        scale: zoom,
        pinch: false,
      });
    if (pointers.current.size === 2)
      Object.assign(gesture.current, { distance: distance(), scale: zoom, pinch: true });
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2 && gesture.current.distance) {
      setZoom(
        Math.max(1, Math.min(4, (gesture.current.scale * distance()) / gesture.current.distance)),
      );
      return;
    }
    if (zoom > 1) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const dx = event.clientX - gesture.current.lastX;
      const dy = event.clientY - gesture.current.lastY;
      setPan((p) => ({
        x: Math.max(
          (-bounds.width * (zoom - 1)) / 2,
          Math.min((bounds.width * (zoom - 1)) / 2, p.x + dx),
        ),
        y: Math.max(
          (-bounds.height * (zoom - 1)) / 2,
          Math.min((bounds.height * (zoom - 1)) / 2, p.y + dy),
        ),
      }));
      gesture.current.lastX = event.clientX;
      gesture.current.lastY = event.clientY;
    }
  }
  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size || gesture.current.pinch) return;
    const dx = event.clientX - gesture.current.x;
    const dy = event.clientY - gesture.current.y;
    if (zoom === 1 && Math.abs(dx) > 60 && Math.abs(dy) < 80) move(dx < 0 ? 1 : -1);
    else if (event.pointerType === "touch" && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      const now = Date.now();
      if (now - gesture.current.tap < 300) toggleZoom();
      gesture.current.tap = now;
    }
  }
  const button =
    "grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/15 bg-white/5 text-white/90 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-35";
  const loading = open && asset?.id !== photo?.id;
  return (
    <>
      <div
        ref={grid}
        tabIndex={-1}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        aria-label="Şəkillər"
      >
        {photos.map((item, itemIndex) => (
          <button
            key={item.id}
            type="button"
            className="group relative overflow-hidden rounded-xl border border-border bg-secondary text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={`${item.name || title} · ${itemIndex + 1} / ${photos.length}`}
            onClick={(event) => {
              trigger.current = event.currentTarget;
              reset();
              setSelectedId(item.id);
            }}
          >
            <PrivateThumbnail photo={item} title={title} />
            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-5 text-xs text-white">
              {item.name}
            </span>
          </button>
        ))}
      </div>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <DialogPortal>
          <DialogOverlay className="bg-black/90 backdrop-blur-sm" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-0 z-50 flex h-dvh w-screen flex-col overflow-hidden px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-white sm:px-6"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
              else grid.current?.focus({ preventScroll: true });
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(-1);
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(1);
              }
            }}
          >
            <header className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 pb-3">
              <DialogTitle className="min-w-0 truncate text-sm font-medium text-white/80">
                {photo?.name || title}
              </DialogTitle>
              <div className="flex items-center gap-2">
                <span
                  className="mr-1 whitespace-nowrap text-sm tabular-nums text-white/65"
                  aria-live="polite"
                >
                  {index + 1} / {photos.length}
                </span>
                <DialogClose className={button} aria-label="Qalereyanı bağla">
                  <X size={20} />
                </DialogClose>
              </div>
            </header>
            <div
              className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl"
              style={{ touchAction: "none" }}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={() => pointers.current.clear()}
              onDoubleClick={toggleZoom}
            >
              {loading && (
                <p role="status" className="text-sm text-white/65">
                  Şəkil yüklənir…
                </p>
              )}
              {asset?.id === photo?.id && asset?.error && (
                <div role="alert" className="max-w-sm space-y-4 text-center text-sm text-white/75">
                  <p>{errorLabel}</p>
                  <button
                    type="button"
                    className="rounded-full border border-white/20 px-5 py-2"
                    onClick={() => {
                      setAsset(undefined);
                      setAttempt((a) => a + 1);
                    }}
                  >
                    Yenidən cəhd et
                  </button>
                </div>
              )}
              {asset?.id === photo?.id && asset?.url && (
                <img
                  key={photo?.id}
                  src={asset.url}
                  alt={photo?.name || title}
                  draggable={false}
                  className="h-full w-full min-h-0 min-w-0 select-none object-contain motion-safe:animate-in motion-safe:fade-in duration-200"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    cursor: zoom > 1 ? "grab" : "zoom-in",
                  }}
                  onError={() => setAsset({ id: photo!.id, error: true })}
                />
              )}
            </div>
            <footer className="mx-auto mt-4 flex w-full max-w-[1600px] items-center justify-between gap-2">
              <div className="flex gap-2">
                {photos.length > 1 && (
                  <>
                    <button
                      type="button"
                      className={button}
                      aria-label="Əvvəlki şəkil"
                      onClick={() => move(-1)}
                    >
                      <ArrowLeft size={20} />
                    </button>
                    <button
                      type="button"
                      className={button}
                      aria-label="Növbəti şəkil"
                      onClick={() => move(1)}
                    >
                      <ArrowRight size={20} />
                    </button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={button}
                  aria-label={zoom > 1 ? "Miqyası sıfırla" : "Şəkli böyüt"}
                  aria-pressed={zoom > 1}
                  disabled={loading || Boolean(asset?.error)}
                  onClick={toggleZoom}
                >
                  {zoom > 1 ? <ZoomOut size={20} /> : <ZoomIn size={20} />}
                </button>
                <button
                  type="button"
                  className="flex min-h-11 items-center gap-2 rounded-full border border-white/15 px-3 text-xs text-white/80 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-35 sm:px-4"
                  disabled={downloading}
                  onClick={() => void download()}
                >
                  <Download size={17} />
                  <span>{downloading ? "Yüklənir…" : "Orijinalı yüklə"}</span>
                </button>
              </div>
            </footer>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </>
  );
}
