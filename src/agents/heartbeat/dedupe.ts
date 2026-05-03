import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { HeartbeatOutput } from "./types.js";

type DedupeStore = {
  branches: Record<string, string[]>;
};

export class HeartbeatEscalationDeduper {
  private readonly frameSize: number;
  private readonly storePath?: string;
  private readonly recentEscalations: Map<string, string[]>;

  constructor(frameSize = 3, storePath?: string) {
    this.frameSize = frameSize;
    this.storePath = storePath;
    this.recentEscalations = new Map(Object.entries(loadStore(storePath).branches));
  }

  suppressDuplicate(output: HeartbeatOutput): HeartbeatOutput {
    const recent = this.recentEscalations.get(output.branch_id) ?? [];
    const key = output.decision === "escalate" ? normalize(output.summary) : "";

    this.recentEscalations.set(output.branch_id, [key, ...recent].slice(0, this.frameSize));
    this.save();

    if (output.decision === "escalate" && recent.includes(key)) {
      return {
        ...output,
        decision: "no_escalation",
        summary: `Duplicate escalation suppressed within the last ${this.frameSize} heartbeat calls.`,
      };
    }

    return output;
  }

  private save(): void {
    if (!this.storePath) {
      return;
    }

    mkdirSync(dirname(this.storePath), { recursive: true });
    writeFileSync(
      this.storePath,
      `${JSON.stringify(
        { branches: Object.fromEntries(this.recentEscalations) },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function loadStore(storePath?: string): DedupeStore {
  if (!storePath || !existsSync(storePath)) {
    return { branches: {} };
  }

  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as DedupeStore;
    return parsed.branches ? parsed : { branches: {} };
  } catch {
    return { branches: {} };
  }
}
