import type { BranchRecord, RunEventRecord, RunRecord } from "./api";

const now = new Date("2026-05-03T21:22:01.004Z").toISOString();

export const fallbackBranches: BranchRecord[] = [
  {
    id: "BR-EQ-091",
    lawId: "law_pltr_deals",
    name: "PLTR new enterprise and government deals",
    description: "Watch for credible reports of materially relevant PLTR deals.",
    enabled: true,
    createdAt: now,
    updatedAt: now,
    law: {
      thesis:
        "Escalate credible new customer, contract expansion, or strategically important deployment evidence.",
    },
    config: {
      assets: ["PLTR"],
      heartbeat: "5m",
      seedWindowDays: 30,
      riskLevel: "medium",
    },
    metadata: {
      lastRun: "14:22:01.004Z",
      heartbeatMs: 200,
      escalations: 0,
      status: "running",
    },
  },
  {
    id: "BR-EQ-112",
    lawId: "law_nvda_supply",
    name: "NVDA supply chain capacity change",
    description: "Material channel checks, datacenter supply, and allocation changes.",
    enabled: true,
    createdAt: now,
    updatedAt: now,
    config: { assets: ["NVDA"], heartbeat: "5m", riskLevel: "high" },
    metadata: {
      lastRun: "14:21:45.992Z",
      heartbeatMs: 500,
      escalations: 3,
      status: "escalated",
    },
  },
  {
    id: "BR-EQ-044",
    lawId: "law_biotech_pdufa",
    name: "FDA calendar and PDUFA catalyst drift",
    description: "Regulatory catalyst windows, panel updates, and label-risk evidence.",
    enabled: true,
    createdAt: now,
    updatedAt: now,
    config: { assets: ["XBI"], heartbeat: "15m", riskLevel: "medium" },
    metadata: {
      lastRun: "14:22:00.120Z",
      heartbeatMs: 1000,
      escalations: 0,
      status: "running",
    },
  },
  {
    id: "BR-EQ-092",
    lawId: "law_semis_export",
    name: "Semiconductor export restriction expansion",
    description: "Policy language with direct revenue or supply-chain exposure.",
    enabled: false,
    createdAt: now,
    updatedAt: now,
    config: { assets: ["SMH", "AMD", "NVDA"], heartbeat: "15m", riskLevel: "low" },
    metadata: {
      lastRun: "13:45:11.000Z",
      heartbeatMs: null,
      escalations: 0,
      status: "paused",
    },
  },
  {
    id: "BR-EQ-093",
    lawId: "law_tsla_margin",
    name: "TSLA margin pressure from price cuts",
    description: "Price cuts, incentives, delivery mix, and gross margin evidence.",
    enabled: true,
    createdAt: now,
    updatedAt: now,
    config: { assets: ["TSLA"], heartbeat: "5m", riskLevel: "medium" },
    metadata: {
      lastRun: "14:22:01.105Z",
      heartbeatMs: 250,
      escalations: 1,
      status: "running",
    },
  },
  {
    id: "BR-CR-113",
    lawId: "law_btc_liquidity",
    name: "BTC liquidity flush mean reversion",
    description: "Funding, liquidation clusters, RSI compression, and ETF flow context.",
    enabled: true,
    createdAt: now,
    updatedAt: now,
    config: { assets: ["BTC/USD"], heartbeat: "30s", riskLevel: "high" },
    metadata: {
      lastRun: "14:22:01.150Z",
      heartbeatMs: 100,
      escalations: 0,
      status: "running",
    },
  },
];

export const fallbackRuns: RunRecord[] = [
  {
    id: "run_40291",
    kind: "debate",
    status: "running",
    branchId: "BR-EQ-112",
    dryRun: true,
    createdAt: now,
    updatedAt: now,
    input: {
      escalation: {
        summary:
          "Volume and supplier-channel evidence diverged from the normal NVDA supply watch baseline.",
      },
    },
    output: {
      decision: "needs_review",
      summary: "Sentiment and source credibility conflict needs human review.",
    },
  },
  {
    id: "heartbeat_40290",
    kind: "heartbeat",
    status: "succeeded",
    branchId: "BR-EQ-091",
    dryRun: true,
    createdAt: now,
    updatedAt: now,
    input: {},
    output: { decision: "monitor" },
  },
];

export const fallbackEvents: RunEventRecord[] = [
  {
    id: "evt_001",
    runId: "run_40291",
    type: "heartbeat.ok",
    timestamp: "2026-05-03T14:02:11.004-07:00",
    payload: { title: "System Heartbeat", summary: "Routine latency check ok." },
  },
  {
    id: "evt_002",
    runId: "run_40291",
    type: "heartbeat.anomaly",
    timestamp: "2026-05-03T14:05:22.119-07:00",
    payload: {
      title: "Anomaly Detected",
      summary: "Unusual channel volume. Initiating secondary scan.",
    },
  },
  {
    id: "evt_003",
    runId: "run_40291",
    type: "escalation.triggered",
    timestamp: "2026-05-03T14:06:01.882-07:00",
    payload: {
      title: "Escalation Triggered",
      summary: "Variance exceeds threshold. Engaging debate protocol.",
      severity: "SEV-2 ALARM",
    },
  },
  {
    id: "evt_004",
    runId: "run_40291",
    type: "debate.active",
    timestamp: "2026-05-03T14:06:05.000-07:00",
    payload: {
      title: "Debate Active",
      summary: "Agents BULL, BEAR, and JUDGE online.",
    },
  },
];
