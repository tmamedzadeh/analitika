import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadImageBytes } from "./image-upload-client";
class FakeUploadRequest {
  static current: FakeUploadRequest;
  upload: {
    onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void;
  } = {};
  status = 200;
  timeout = 0;
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  ontimeout?: () => void;
  constructor() {
    FakeUploadRequest.current = this;
  }
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort?.());
}
afterEach(() => vi.unstubAllGlobals());
describe("measured browser upload progress", () => {
  it("reports only measured bytes, preserves File and rejects cancellation", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
    const controller = new AbortController();
    const progress = vi.fn();
    const file = new File([new Uint8Array(10)], "synthetic.png", { type: "image/png" });
    const upload = uploadImageBytes(
      "https://synthetic.invalid/upload",
      file,
      controller.signal,
      progress,
    );
    const rejected = expect(upload).rejects.toThrow();
    const xhr = FakeUploadRequest.current;
    expect(xhr.send).toHaveBeenCalledWith(file);
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 1, total: 0 });
    expect(progress).not.toHaveBeenCalled();
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 7, total: 10 });
    expect(progress).toHaveBeenCalledWith(7, 10);
    controller.abort();
    await rejected;
    expect(xhr.abort).toHaveBeenCalledOnce();
  });
  it("finishes only after a successful PUT response", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
    const promise = uploadImageBytes(
      "https://synthetic.invalid/upload",
      new File(["synthetic"], "test.png"),
      new AbortController().signal,
      vi.fn(),
    );
    FakeUploadRequest.current.onload?.();
    await expect(promise).resolves.toBeUndefined();
  });
});
