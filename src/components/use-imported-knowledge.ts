"use client";

import { useEffect, useState } from "react";
import { appendImport, importStorageKey, loadImports, removeImport } from "@/lib/import-storage";
import { type PreparedImport } from "@/lib/knowledge-import";
import { type KnowledgeCatalog } from "@/lib/knowledge";

export function useImportedKnowledge(initial: KnowledgeCatalog | null) {
  const [state, setState] = useState<{ imports: PreparedImport[]; catalog: KnowledgeCatalog | null }>({ imports: [], catalog: initial });
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!initial) return;
    let active = true;
    const hydrate = () => {
      if (!active) return;
      try { setState(loadImports(localStorage.getItem(importStorageKey), initial)); setError(""); setReady(true); }
      catch { setError("Saved imports could not be loaded. Browser storage may be disabled, full, or invalid. Existing data has not been overwritten."); setReady(false); }
    };
    queueMicrotask(hydrate);
    const onStorage = (event: StorageEvent) => { if (event.key === importStorageKey) hydrate(); };
    window.addEventListener("storage", onStorage);
    return () => { active = false; window.removeEventListener("storage", onStorage); };
  }, [initial]);

  function add(prepared: PreparedImport) {
    if (!initial) throw new Error("Local storage is only used in sample mode.");
    const next = appendImport(localStorage.getItem(importStorageKey), prepared, initial);
    localStorage.setItem(importStorageKey, next.serialized);
    setState(next); setError(""); setReady(true);
  }

  function remove(id: string) {
    if (!initial) return;
    const next = removeImport(localStorage.getItem(importStorageKey), id, initial);
    localStorage.setItem(importStorageKey, next.serialized);
    setState(next); setError("");
  }

  return { ...state, error, ready, add, remove };
}