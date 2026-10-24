export const networkMessage = "Bağlantını yoxlayın və yenidən cəhd edin. Mətn artıq saxlanılıb.";
export class ClientImageError extends Error {
  constructor(
    message: string,
    public readonly code:
      "transport" | "storage" | "timeout" | "cancelled" | "validation" | "server",
  ) {
    super(message);
  }
}

export function uploadImageBytes(
  url: string,
  file: File,
  signal: AbortSignal,
  progress: (loaded: number, total: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let idle: ReturnType<typeof setTimeout>;
    let timedOut = false;
    const expire = () => {
      timedOut = true;
      xhr.abort();
    };
    const abort = () => xhr.abort();
    const finish = (error?: Error) => {
      clearTimeout(idle);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type);
    xhr.timeout = 600_000;
    xhr.upload.onprogress = (event) => {
      clearTimeout(idle);
      idle = setTimeout(expire, 30_000);
      if (event.lengthComputable) progress(event.loaded, event.total);
    };
    xhr.onload = () =>
      finish(
        xhr.status >= 200 && xhr.status < 300
          ? undefined
          : new ClientImageError(
              "Şəkil yaddaşı yükləməni qəbul etmədi. Yenidən cəhd edərək yeni keçid alın.",
              "storage",
            ),
      );
    xhr.onerror = () => finish(new ClientImageError(networkMessage, "transport"));
    xhr.ontimeout = () =>
      finish(new ClientImageError("Yükləmə vaxtı bitdi. Yenidən cəhd edin.", "timeout"));
    xhr.onabort = () =>
      finish(
        new ClientImageError(
          timedOut ? "Yükləmə vaxtı bitdi. Yenidən cəhd edin." : "Yükləmə ləğv edilib.",
          timedOut ? "timeout" : "cancelled",
        ),
      );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      finish(new ClientImageError("Yükləmə ləğv edilib.", "cancelled"));
      return;
    }
    idle = setTimeout(expire, 30_000);
    xhr.send(file);
  });
}
