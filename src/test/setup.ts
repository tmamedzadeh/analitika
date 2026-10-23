import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";
import { isolateTestEnvironment } from "./safe-env";

isolateTestEnvironment();

// Every test that needs HTTP must install its own synthetic transport.
beforeEach(() => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("Unit tests cannot make unmocked network requests.");
  });
});

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
