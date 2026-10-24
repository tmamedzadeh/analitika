import { createContext, useContext } from "react";
export type Task = { state: string; loaded?: number; total?: number; error?: string };
export type Files = Map<string, File>;
export type Manager = {
  tasks: Record<string, Task>;
  start: (documentId: string, files: Files) => void;
  retry: (documentId: string, slotId: string, file?: File) => Promise<void>;
  cancel: (documentId: string, slotId: string, generation: number) => Promise<void>;
};
export const DocumentImageUploadContext = createContext<Manager | null>(null);

export const useDocumentImageUploads = () => useContext(DocumentImageUploadContext);
