import type { HeartbeatOutput } from "./types.js";

export class HeartbeatEscalationDeduper {
  private readonly frameSize: number;
  private readonly recentEscalations = new Map<string, string[]>();

  constructor(frameSize = 3) {
    this.frameSize = frameSize;
  }

  suppressDuplicate(output: HeartbeatOutput): HeartbeatOutput {
    const recent = this.recentEscalations.get(output.branch_id) ?? [];
    const key = output.decision === "escalate" ? normalize(output.summary) : "";

    this.recentEscalations.set(output.branch_id, [key, ...recent].slice(0, this.frameSize));

    if (output.decision === "escalate" && recent.includes(key)) {
      return {
        ...output,
        decision: "no_escalation",
        summary: `Duplicate escalation suppressed within the last ${this.frameSize} heartbeat calls.`,
      };
    }

    return output;
  }
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
