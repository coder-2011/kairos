export type JsonRecord = Record<string, unknown>;

export type BranchRecord = {
  id: string;
  lawId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  law?: JsonRecord;
  config?: JsonRecord;
  metadata?: JsonRecord;
};

export type RunRecord = {
  id: string;
  kind: "heartbeat" | "debate";
  status: "pending" | "running" | "succeeded" | "failed" | "canceled";
  branchId?: string;
  createdAt: string;
  updatedAt: string;
  dryRun: boolean;
  input: JsonRecord;
  output?: JsonRecord;
  metadata?: JsonRecord;
};

export type RunEventRecord = {
  id: string;
  runId: string;
  type: string;
  timestamp: string;
  payload: JsonRecord;
};

const apiBaseUrl =
  import.meta.env.VITE_KAIROS_API_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:4321";

export async function getBranches(): Promise<BranchRecord[]> {
  return request<{ branches: BranchRecord[] }>("/branches").then(
    (response) => response.branches,
  );
}

export async function getRuns(): Promise<RunRecord[]> {
  return request<{ runs: RunRecord[] }>("/runs").then((response) => response.runs);
}

export async function getRunEvents(runId: string): Promise<RunEventRecord[]> {
  return request<{ events: RunEventRecord[] }>(`/runs/${runId}/events`).then(
    (response) => response.events,
  );
}

export async function triggerHeartbeat(
  branchId: string,
  input: JsonRecord = {},
): Promise<RunRecord> {
  return request<{ run: RunRecord }>(`/branches/${branchId}/heartbeat-runs`, {
    method: "POST",
    body: JSON.stringify({ dryRun: true, input }),
  }).then((response) => response.run);
}

export async function createDebate(input: {
  branchId?: string;
  escalation?: JsonRecord;
}): Promise<RunRecord> {
  return request<{ run: RunRecord }>("/debates", {
    method: "POST",
    body: JSON.stringify({
      dryRun: true,
      escalation: input.escalation,
      input: { branchId: input.branchId },
    }),
  }).then((response) => response.run);
}

export async function appendInterjection(
  runId: string,
  message: string,
): Promise<RunEventRecord> {
  return request<{ event: RunEventRecord }>(`/runs/${runId}/interjections`, {
    method: "POST",
    body: JSON.stringify({ message }),
  }).then((response) => response.event);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Kairos API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}
