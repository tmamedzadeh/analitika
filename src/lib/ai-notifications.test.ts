import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createFallbackNotifier } from "./ai-notifications";
import { az } from "./i18n/az";
vi.mock("sonner", () => ({ toast: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
describe("fallback notifications", () => {
  it("deduplicates corrective generations per request and distinguishes unavailable from quota", () => {
    const notify = createFallbackNotifier();
    const event = {
      fromModel: "gemini-3.8-flash",
      toModel: "gemini-3.5-flash-lite",
      reason: "unavailable" as const,
      backup: false,
    };
    notify(event);
    notify(event);
    expect(toast).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith(
      az.ai.switched,
      expect.objectContaining({
        duration: 4500,
        description: expect.not.stringContaining("limiti"),
      }),
    );
    createFallbackNotifier()({
      ...event,
      toModel: "gemini-3.1-flash-lite",
      backup: true,
      reason: "quota",
    });
    expect(toast).toHaveBeenLastCalledWith(
      az.ai.backupActivated,
      expect.objectContaining({ description: expect.stringContaining("Gemini 3.1 Flash-Lite") }),
    );
  });
});
