import { toast } from "sonner";
import { modelDisplayName, type ModelFallback } from "./ai";
import { az } from "./i18n/az";

// One instance per user request, shared by every corrective attempt / page.
export function createFallbackNotifier() {
  const shown = new Set<string>();
  return (event: ModelFallback) => {
    const key = event.toModel;
    if (shown.has(key)) return;
    shown.add(key);
    toast(event.backup ? az.ai.backupActivated : az.ai.switched, {
      description: (event.reason === "quota" ? az.ai.quota : az.ai.unavailable).replace(
        "{model}",
        modelDisplayName(event.toModel),
      ),
      duration: 4500,
    });
  };
}
