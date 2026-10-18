import { createContext, useContext, useState, type ReactNode } from "react";
import { conflictingBrief, demoBriefs, type Brief } from "@/lib/briefs";

const BriefsContext = createContext<{ briefs: Brief[]; save: (brief: Brief) => boolean } | null>(null);
export function BriefsProvider({ children }: { children: ReactNode }) {
  const [briefs, setBriefs] = useState(demoBriefs);
  function save(brief: Brief) {
    if (conflictingBrief(briefs, brief.date, brief.id)) return false;
    setBriefs(current => [...current.filter(item => item.id !== brief.id), brief].sort((a, b) => b.date.localeCompare(a.date)));
    return true;
  }
  return <BriefsContext.Provider value={{ briefs, save }}>{children}</BriefsContext.Provider>;
}
export function useBriefs() {
  const context = useContext(BriefsContext);
  if (!context) throw new Error("BriefsProvider is required");
  return context;
}