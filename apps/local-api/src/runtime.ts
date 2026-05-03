import { MemoryKairosStore, type KairosLocalStore } from "./store.js";

export type RuntimeFactory = {
  LocalKairosStore?: new (options?: { rootDir?: string }) => KairosLocalStore;
};

export async function createRuntimeStore(options: { dataDir?: string } = {}): Promise<KairosLocalStore> {
  const runtime = await loadRuntimeModule();
  if (runtime?.LocalKairosStore) {
    return new runtime.LocalKairosStore({ rootDir: options.dataDir });
  }
  return new MemoryKairosStore();
}

async function loadRuntimeModule(): Promise<RuntimeFactory | undefined> {
  const candidates = ["../../../src/runtime/index.js", "../../src/runtime/index.js"];

  for (const candidate of candidates) {
    try {
      return (await import(candidate)) as RuntimeFactory;
    } catch (error) {
      if (!isModuleMissing(error)) throw error;
    }
  }

  return undefined;
}

function isModuleMissing(error: unknown): boolean {
  return error instanceof Error && (
    error.message.includes("Cannot find module") ||
    error.message.includes("Cannot find package") ||
    error.message.includes("Module not found") ||
    error.message.includes("ResolveMessage")
  );
}
