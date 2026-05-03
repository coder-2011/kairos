import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  appendInterjection,
  createDebate,
  getBranches,
  getRunEvents,
  getRuns,
  triggerHeartbeat,
  updateBranchConfig,
  type BranchRecord,
  type JsonRecord,
  type RunEventRecord,
  type RunRecord,
} from "./api";
import type { KairosBranchAgentConfig } from "../../../src/global/agent-config.js";
import { fallbackBranches, fallbackEvents, fallbackRuns } from "./mockData";

type View = "branches" | "debate" | "detail" | "draft" | "config";
type LoadState = "loading" | "api" | "fallback";

const views: Array<{ id: View; label: string; icon: string }> = [
  { id: "branches", label: "Branch List", icon: "account_tree" },
  { id: "debate", label: "Monitoring", icon: "monitoring" },
  { id: "detail", label: "Run Deep-Dive", icon: "timeline" },
  { id: "draft", label: "Draft Law", icon: "edit_note" },
  { id: "config", label: "Configuration", icon: "settings" },
];

const personaPromptFields = [
  {
    role: "Judge",
    key: "debateJudgeSystemPrompt",
    fallback:
      "Orchestrate the debate, preserve uncertainty, and synthesize only from cited evidence.",
  },
  {
    role: "Bull",
    key: "debateBullSystemPrompt",
    fallback: "Argue materiality and opportunity when evidence supports it.",
  },
  {
    role: "Bear",
    key: "debateBearSystemPrompt",
    fallback: "Argue noise, stale evidence, source risk, and priced-in scenarios.",
  },
] as const;

const informationToolFields = [
  { label: "SEC Filings", key: "finnhub_filings" },
  { label: "Exa News Search", key: "exa_search" },
  { label: "Exa Research", key: "exa_research" },
  { label: "Source Reader", key: "exa_contents" },
  { label: "Supermemory Search", key: "supermemory_search" },
  { label: "Finnhub Company News", key: "finnhub_company_news" },
  { label: "Finnhub Basic Financials", key: "finnhub_basic_financials" },
  { label: "Finnhub Earnings", key: "finnhub_company_earnings" },
  { label: "Finnhub Insider Transactions", key: "finnhub_insider_transactions" },
] as const;

export function App() {
  const [view, setView] = useState<View>("branches");
  const [branches, setBranches] = useState<BranchRecord[]>(fallbackBranches);
  const [runs, setRuns] = useState<RunRecord[]>(fallbackRuns);
  const [events, setEvents] = useState<RunEventRecord[]>(fallbackEvents);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selectedBranchId, setSelectedBranchId] = useState("BR-EQ-112");
  const [selectedRunId, setSelectedRunId] = useState("run_40291");

  const selectedBranch =
    branches.find((branch) => branch.id === selectedBranchId) ?? branches[0];
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0];

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [apiBranches, apiRuns] = await Promise.all([
          getBranches(),
          getRuns(),
        ]);

        if (cancelled) return;

        const nextBranches = apiBranches.length ? apiBranches : fallbackBranches;
        const nextRuns = apiRuns.length ? apiRuns : fallbackRuns;
        setBranches(nextBranches);
        setRuns(nextRuns);
        setSelectedBranchId(nextBranches[0]?.id ?? "BR-EQ-112");
        setSelectedRunId(nextRuns[0]?.id ?? "run_40291");
        setLoadState(apiBranches.length || apiRuns.length ? "api" : "fallback");
      } catch {
        if (cancelled) return;
        setBranches(fallbackBranches);
        setRuns(fallbackRuns);
        setEvents(fallbackEvents);
        setLoadState("fallback");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedRun?.id || loadState !== "api") return;
    let cancelled = false;

    getRunEvents(selectedRun.id)
      .then((nextEvents) => {
        if (!cancelled) {
          setEvents(nextEvents.length ? nextEvents : fallbackEvents);
        }
      })
      .catch(() => {
        if (!cancelled) setEvents(fallbackEvents);
      });

    return () => {
      cancelled = true;
    };
  }, [loadState, selectedRun?.id]);

  async function runDryHeartbeat(branchId: string) {
    try {
      const run = await triggerHeartbeat(branchId, { source: "web_command" });
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setSelectedRunId(run.id);
      setView("debate");
      setLoadState("api");
    } catch {
      setView("debate");
    }
  }

  async function startDebate(branchId: string) {
    try {
      const run = await createDebate({
        branchId,
        escalation: {
          branchId,
          summary: "Manual dry-run escalation opened from the web command center.",
        },
      });
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setSelectedRunId(run.id);
      setView("debate");
      setLoadState("api");
    } catch {
      setView("debate");
    }
  }

  async function injectHumanContext(message: string) {
    if (!selectedRun?.id || !message.trim()) return;

    try {
      const event = await appendInterjection(selectedRun.id, message.trim());
      setEvents((current) => [...current, event]);
      setLoadState("api");
    } catch {
      setEvents((current) => [
        ...current,
        {
          id: `local_${Date.now()}`,
          runId: selectedRun.id,
          type: "human.interjection",
          timestamp: new Date().toISOString(),
          payload: { title: "Human Interjection", summary: message.trim() },
        },
      ]);
    }
  }

  async function saveBranchAgentConfig(
    branchId: string,
    config: KairosBranchAgentConfig,
  ) {
    try {
      const branch = await updateBranchConfig(branchId, config);
      setBranches((current) =>
        current.map((item) => (item.id === branch.id ? branch : item)),
      );
      setLoadState("api");
    } catch {
      setBranches((current) =>
        current.map((item) =>
          item.id === branchId
            ? {
                ...item,
                config,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      );
    }
  }

  return (
    <div className="shell">
      <SideNav view={view} setView={setView} />
      <div className="workspace">
        <TopBar loadState={loadState} />
        {view === "branches" && (
          <BranchList
            branches={branches}
            runs={runs}
            onSelect={(branch) => {
              setSelectedBranchId(branch.id);
              setView("detail");
            }}
            onCreate={() => setView("draft")}
          />
        )}
        {view === "debate" && (
          <DebateView
            events={events}
            run={selectedRun}
            onInject={injectHumanContext}
          />
        )}
        {view === "detail" && (
          <BranchDetail
            branch={selectedBranch}
            onEdit={() => setView("config")}
            onDryRun={() => void runDryHeartbeat(selectedBranch.id)}
            onEscalate={() => void startDebate(selectedBranch.id)}
          />
        )}
        {view === "draft" && <DraftLaw onCompile={() => setView("config")} />}
        {view === "config" && (
          <BranchConfig
            branch={selectedBranch}
            onSave={(config) =>
              void saveBranchAgentConfig(selectedBranch.id, config)
            }
          />
        )}
        <Footer active={view === "debate" ? "human" : view === "detail" ? "manual" : "dry"} />
      </div>
    </div>
  );
}

function SideNav({
  view,
  setView,
}: {
  view: View;
  setView: (view: View) => void;
}) {
  return (
    <nav className="side-nav">
      <div className="brand-block">
        <div className="operator-avatar">
          <Icon name="person" />
        </div>
        <div>
          <div className="brand">KAIROS</div>
          <div className="version">v1.0.4-alpha</div>
        </div>
      </div>
      <div className="nav-list">
        {views.map((item) => (
          <button
            className={`nav-item ${view === item.id ? "active" : ""}`}
            key={item.id}
            onClick={() => setView(item.id)}
            type="button"
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      <div className="operator-block">
        <div className="operator-chip">SO</div>
        <span>System Operator</span>
      </div>
    </nav>
  );
}

function TopBar({ loadState }: { loadState: LoadState }) {
  return (
    <header className="top-bar">
      <div className="status-cluster">
        <span className="top-status">STATUS: BRANCH_ACTIVE</span>
        <span className="status-light" />
        <span className="source-pill">
          {loadState === "loading"
            ? "SYNCING"
            : loadState === "api"
              ? "LOCAL API"
              : "FALLBACK DATA"}
        </span>
      </div>
      <div className="top-actions">
        <div className="icon-row">
          <IconButton icon="sensors" label="Sensors" />
          <IconButton icon="history" label="History" />
          <IconButton icon="emergency" label="Emergency" />
        </div>
        <div className="divider" />
        <button className="command-button primary" type="button">
          PAUSE
        </button>
        <button className="command-button" type="button">
          DISABLE
        </button>
      </div>
    </header>
  );
}

function BranchList({
  branches,
  runs,
  onSelect,
  onCreate,
}: {
  branches: BranchRecord[];
  runs: RunRecord[];
  onSelect: (branch: BranchRecord) => void;
  onCreate: () => void;
}) {
  const totalEscalations = branches.reduce(
    (sum, branch) => sum + getEscalations(branch),
    0,
  );

  return (
    <main className="canvas branch-canvas">
      <section className="toolbar">
        <div className="filters">
          <FieldLabel label="Status">
            <select>
              <option>ALL ACTIVE</option>
              <option>RUNNING</option>
              <option>PAUSED</option>
              <option>ESCALATED</option>
            </select>
          </FieldLabel>
          <FieldLabel label="Asset Class">
            <select>
              <option>EQUITIES</option>
              <option>CRYPTO</option>
              <option>MACRO</option>
            </select>
          </FieldLabel>
          <FieldLabel label="Risk Level">
            <select>
              <option>ANY</option>
              <option>HIGH</option>
              <option>MEDIUM</option>
              <option>LOW</option>
            </select>
          </FieldLabel>
        </div>
        <div className="toolbar-metrics">
          <Metric label="RUNS" value={runs.length.toString()} />
          <Metric label="ESCALATIONS" value={totalEscalations.toString()} alert={totalEscalations > 0} />
          <button className="command-button primary create-button" onClick={onCreate} type="button">
            <Icon name="add" />
            CREATE NEW BRANCH
          </button>
        </div>
      </section>
      <section className="data-panel">
        <table className="branch-table">
          <thead>
            <tr>
              <th>BRANCH ID</th>
              <th>LINKED LAW</th>
              <th>STATUS</th>
              <th>HEARTBEAT</th>
              <th>LAST RUN</th>
              <th className="right">ESCALATIONS</th>
            </tr>
          </thead>
          <tbody>
            {branches.map((branch) => (
              <tr key={branch.id} onClick={() => onSelect(branch)}>
                <td>{branch.id}</td>
                <td className="muted truncate-cell">{branch.name}</td>
                <td>
                  <StatusBadge status={getBranchStatus(branch)} />
                </td>
                <td className="muted">{formatHeartbeat(branch)}</td>
                <td>{String(branch.metadata?.lastRun ?? timeOnly(branch.updatedAt))}</td>
                <td className={`right ${getEscalations(branch) > 0 ? "danger-text" : ""}`}>
                  {getEscalations(branch)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function DebateView({
  events,
  run,
  onInject,
}: {
  events: RunEventRecord[];
  run?: RunRecord;
  onInject: (message: string) => void;
}) {
  const [message, setMessage] = useState("");

  const renderedEvents = useMemo(
    () => (events.length ? events : fallbackEvents),
    [events],
  );

  return (
    <main className="split-canvas">
      <section className="event-stream pane narrow">
        <PaneHeader icon="stream" title="RUN EVENT STREAM" meta={`ID: ${run?.id ?? "EVT-992-ALPHA"}`} />
        <div className="timeline-scroll">
          {renderedEvents.map((event, index) => (
            <TimelineEvent
              event={event}
              key={event.id}
              last={index === renderedEvents.length - 1}
            />
          ))}
        </div>
      </section>
      <section className="transcript pane wide">
        <PaneHeader icon="forum" title="DEBATE TRANSCRIPT" meta="PROTOCOL: DELPHI-3" action="EXPORT" />
        <div className="transcript-scroll">
          <AgentMessage
            agent="BEAR"
            icon="trending_down"
            confidence="87%"
            tone="secondary"
            sources={["SRC: VOL-HIST-14", "SRC: OB-DEPTH-A"]}
          >
            The new evidence resembles historical false positives: the source
            velocity is high, but the cited contract language still lacks size,
            timing, and budget attribution. Recommend downgrade to watch until a
            primary source confirms materiality.
          </AgentMessage>
          <AgentMessage
            agent="BULL"
            icon="trending_up"
            confidence="62%"
            tone="primary"
            sources={["SRC: SENT-IND-09"]}
          >
            The counterpoint is that channel pickup is diverging from ordinary
            commentary. If the event is tied to a new customer category or
            multi-year procurement, this is exactly the kind of underpriced
            evidence the law is supposed to catch.
          </AgentMessage>
          <AgentMessage
            agent="JUDGE"
            icon="gavel"
            confidence="SYNTHESIS PENDING"
            tone="judge"
          >
            Conflict detected in source credibility versus law relevance. Human
            context can help classify the source, but it will be stored as
            unverified context rather than a decision command.
          </AgentMessage>
        </div>
        <div className="interjection-panel">
          <label>HUMAN INTERJECTION</label>
          <div className="interjection-row">
            <input
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void onInject(message);
                  setMessage("");
                }
              }}
              placeholder="Input context or reliability note..."
              value={message}
            />
            <button
              className="command-button primary"
              onClick={() => {
                void onInject(message);
                setMessage("");
              }}
              type="button"
            >
              INJECT
            </button>
          </div>
          <div className="decision-row">
            <span>DECISION CONTROL</span>
            <div>
              <button className="command-button compact" type="button">
                <Icon name="thumb_down" /> WRONG
              </button>
              <button className="command-button compact" type="button">
                <Icon name="update" /> STALE
              </button>
              <button className="command-button compact primary-outline" type="button">
                <Icon name="thumb_up" /> USEFUL
              </button>
            </div>
          </div>
        </div>
      </section>
      <EvidencePane />
    </main>
  );
}

function BranchDetail({
  branch,
  onEdit,
  onDryRun,
  onEscalate,
}: {
  branch: BranchRecord;
  onEdit: () => void;
  onDryRun: () => void;
  onEscalate: () => void;
}) {
  const assets = readAssets(branch).join(", ") || "PLTR";

  return (
    <main className="detail-canvas">
      <section className="detail-main">
        <div className="detail-head">
          <div>
            <h1>{branch.name}</h1>
            <p>
              Target Asset: <b>{assets}</b> | Heartbeat:{" "}
              <b>{String(branch.config?.heartbeat ?? "5m")}</b>
            </p>
          </div>
          <div className="button-row">
            <button className="command-button" onClick={onEdit} type="button">
              <Icon name="edit" /> EDIT LAW
            </button>
            <button className="command-button" onClick={onDryRun} type="button">
              <Icon name="play_arrow" /> TRIGGER DRY RUN
            </button>
            <button className="command-button primary" onClick={onEscalate} type="button">
              <Icon name="warning" /> MANUAL ESCALATION
            </button>
          </div>
        </div>
        <section className="law-block">
          <div className="section-title">
            <span>THESIS / THE LAW</span>
            <b>v4.1.2</b>
          </div>
          <pre>
{`# Thesis: ${branch.description ?? "Watch for high-information market evidence."}
# Branch evidence should be new, law-relevant, and citeable.

def evaluate_evidence(source_event):
    novelty = source_event.score("novelty")
    relevance = source_event.score("law_relevance")
    credibility = source_event.score("source_credibility")

    if novelty > 0.72 and relevance > 0.80 and credibility > 0.65:
        return Action.ESCALATE_TO_DEBATE

    if relevance > 0.55:
        return Action.STORE_AND_MONITOR

    return Action.IGNORE`}
          </pre>
        </section>
        <section className="recent-runs">
          <div className="section-title">RECENT RUNS (HEARTBEAT)</div>
          {[
            ["14:32:00", "EVAL_HOLD", ""],
            ["14:31:30", "EVAL_HOLD", ""],
            ["14:31:00", "ESCALATION_REQUIRED", "Source credibility conflict"],
            ["14:30:30", "EVAL_HOLD", ""],
          ].map(([time, status, note]) => (
            <div className={`run-row ${status.includes("ESCALATION") ? "alert" : ""}`} key={`${time}-${status}`}>
              <span>{time}</span>
              <b>{status}</b>
              <em>{note}</em>
              <a>{status.includes("ESCALATION") ? "Resolve" : "Details"}</a>
            </div>
          ))}
        </section>
      </section>
      <aside className="detail-side">
        <SettingsPanel />
        <EscalationCard />
      </aside>
    </main>
  );
}

function DraftLaw({ onCompile }: { onCompile: () => void }) {
  return (
    <main className="editor-canvas">
      <section className="editor-main">
        <div className="editor-head">
          <h1>Draft New Monitoring Law</h1>
          <div className="button-row">
            <button className="command-button" type="button">DISCARD</button>
            <button className="command-button primary" onClick={onCompile} type="button">
              COMPILE LAW
            </button>
          </div>
        </div>
        <div className="editor-body">
          <FieldLabel label="Thesis Title">
            <input placeholder="e.g. Abnormal contract-signing evidence for PLTR" />
          </FieldLabel>
          <FieldLabel label="Market Signal Logic">
            <textarea
              className="code-area"
              defaultValue={`WATCH source_events
WHERE entity IN branch.assets
AND law_relevance > 0.80
AND source_credibility > 0.65
EMIT ESCALATION_CANDIDATE;`}
            />
          </FieldLabel>
          <div>
            <div className="field-label">ESCALATION THRESHOLDS</div>
            <div className="threshold-grid">
              {["INFO", "WARN", "CRITICAL"].map((label) => (
                <div className="threshold-cell" key={label}>
                  <span className={`dot ${label.toLowerCase()}`} />
                  <b>{label}</b>
                  <input placeholder="Match Count" type="number" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      <aside className="snippet-side">
        <PaneHeader title="LOGIC SNIPPETS" meta="" />
        {["Material Contract", "Sentiment Spike", "Policy Shock"].map((title) => (
          <button className="snippet" key={title} type="button">
            <b>{title}</b>
            <span>
              Detects new, high-signal evidence that meets branch relevance and
              credibility gates.
            </span>
          </button>
        ))}
        <div className="simulation-panel">
          <div className="section-title">SIMULATION: DRY RUN</div>
          <Icon name="query_stats" />
          <p>Compile logic to preview historical behavior.</p>
        </div>
      </aside>
    </main>
  );
}

function BranchConfig({ branch }: { branch: BranchRecord }) {
  return (
    <main className="config-canvas">
      <div className="editor-head sticky">
        <h1>Branch Configuration</h1>
        <div className="button-row">
          <button className="command-button" type="button">DISCARD</button>
          <button className="command-button primary" type="button">
            SAVE CONFIGURATION
          </button>
        </div>
      </div>
      <div className="config-body">
        <FieldLabel label="The Law (Primary Thesis)">
          <textarea
            defaultValue={
              branch.description ??
              "Watch for credible, new, market-relevant evidence tied to this branch."
            }
          />
        </FieldLabel>
        <div>
          <div className="field-label">AGENT PERSONA PROMPTS</div>
          <div className="persona-grid">
            {[
              ["Judge", "Orchestrate the debate, preserve uncertainty, and synthesize only from cited evidence."],
              ["Bull", "Argue materiality and opportunity when evidence supports it."],
              ["Bear", "Argue noise, stale evidence, source risk, and priced-in scenarios."],
            ].map(([role, text]) => (
              <FieldLabel label={role} key={role}>
                <textarea defaultValue={text} />
              </FieldLabel>
            ))}
          </div>
        </div>
        <div className="config-grid">
          <FieldLabel label="Information Agent Tools">
            <div className="tool-picker">
              {["SEC Filings Parser", "Exa News Search", "Supermemory Search", "Finnhub Company News"].map((tool, index) => (
                <label key={tool}>
                  <input defaultChecked={index < 3} type="checkbox" />
                  <span>{tool}</span>
                </label>
              ))}
            </div>
          </FieldLabel>
          <FieldLabel label="Data Seeding (Heartbeat & Debate)">
            <select defaultValue="equities">
              <option value="equities">Tracked equities rolling 30-day packet</option>
              <option value="crypto">Crypto liquidity packet</option>
              <option value="earnings">Tech earnings calendar packet</option>
              <option value="regulatory">Regulatory catalyst packet</option>
            </select>
          </FieldLabel>
        </div>
        <FieldLabel label="Research Seeding (Exa)">
          <textarea defaultValue="Find recent, citeable evidence relevant to the branch law. Prefer primary sources and source diversity." />
        </FieldLabel>
        <div>
          <div className="field-label">EXECUTION THRESHOLDS</div>
          <div className="threshold-wide">
            <Slider label="Notification Threshold" value="75%" />
            <Slider label="Paper Trade Draft Threshold" value="90%" />
          </div>
        </div>
      </div>
    </main>
  );
}

function EvidencePane() {
  return (
    <section className="evidence pane medium">
      <PaneHeader icon="database" title="EVIDENCE & SOURCE" meta="" actionIcon="close" />
      <div className="evidence-scroll">
        <div className="source-card">
          <div className="field-label">SOURCE IDENTIFIER</div>
          <h1>SENT-IND-09</h1>
          <div className="source-tags">
            <span>TYPE: SENTIMENT</span>
            <span>QLTY: TIER 2</span>
          </div>
        </div>
        <div className="field-label">RAW DATA SNAPSHOT</div>
        <pre className="json-block">
{`{
  "timestamp": "14:04:55.201Z",
  "vector": "POSITIVE_DIVERGENCE",
  "magnitude": 0.88,
  "sources_aggregated": 42,
  "confidence_interval": [0.75, 0.92],
  "keywords_detected": ["accumulation", "hidden_buyer"]
}`}
        </pre>
        <div className="field-label">TIMELINE ALIGNMENT</div>
        <div className="alignment-row">
          <span>Data Captured</span>
          <b>T-01:10</b>
        </div>
        <div className="alignment-row">
          <span>Debate Ingest</span>
          <b>T-00:04</b>
        </div>
      </div>
    </section>
  );
}

function SettingsPanel() {
  return (
    <section className="side-panel">
      <div className="section-title">
        <Icon name="tune" /> BRANCH SETTINGS
      </div>
      <FieldLabel label="Paper Position Limit">
        <input readOnly value="2.5% portfolio notional" />
      </FieldLabel>
      <FieldLabel label="Agent Confidence Threshold">
        <input readOnly value="85%" />
      </FieldLabel>
      <FieldLabel label="Operational Mode">
        <div className="mode-list">
          <button className="selected" type="button">DRY RUN <Icon name="check_circle" /></button>
          <button type="button">HUMAN INTERJECTION</button>
          <button type="button">MANUAL ESCALATION</button>
        </div>
      </FieldLabel>
      <div className="risk-toggle">
        <span>Halt on 5% Drawdown</span>
        <b />
      </div>
    </section>
  );
}

function EscalationCard() {
  return (
    <section className="side-panel grow">
      <div className="section-title">
        <Icon name="warning" /> ACTIVE ESCALATIONS
      </div>
      <div className="escalation-card">
        <div>
          <b>SOURCE_CONFLICT</b>
          <span>2m ago</span>
        </div>
        <p>
          Exa result velocity is high, but primary-source confirmation is still
          missing. Debate confidence is below notification threshold.
        </p>
        <div className="button-row">
          <button className="command-button danger" type="button">ACKNOWLEDGE</button>
          <button className="command-button" type="button">VIEW LOGS</button>
        </div>
      </div>
    </section>
  );
}

function AgentMessage({
  agent,
  icon,
  confidence,
  tone,
  sources = [],
  children,
}: {
  agent: string;
  icon: string;
  confidence: string;
  tone: "primary" | "secondary" | "judge";
  sources?: string[];
  children: ReactNode;
}) {
  return (
    <article className={`agent-card ${tone}`}>
      <div className="agent-card-head">
        <span>
          <Icon name={icon} /> AGENT: {agent}
        </span>
        <b>{confidence.includes("%") ? `CONF: ${confidence}` : confidence}</b>
      </div>
      <p>{children}</p>
      {sources.length > 0 && (
        <div className="source-list">
          {sources.map((source) => (
            <span key={source}>{source}</span>
          ))}
        </div>
      )}
    </article>
  );
}

function TimelineEvent({
  event,
  last,
}: {
  event: RunEventRecord;
  last: boolean;
}) {
  const isError = event.type.includes("escalation") || event.type.includes("failed");
  const isDebate = event.type.includes("debate");
  const title = String(event.payload.title ?? titleize(event.type));
  const summary = String(event.payload.summary ?? event.type);

  return (
    <div className={`timeline-item ${last ? "last" : ""} ${isError ? "error" : ""} ${isDebate ? "primary" : ""}`}>
      <span className="timeline-dot" />
      <div className="mono-label">{timeOnly(event.timestamp)}</div>
      <h3>{title}</h3>
      <p>{summary}</p>
      {typeof event.payload.severity === "string" && (
        <b className="severity">{event.payload.severity}</b>
      )}
    </div>
  );
}

function PaneHeader({
  icon,
  title,
  meta,
  action,
  actionIcon,
}: {
  icon?: string;
  title: string;
  meta: string;
  action?: string;
  actionIcon?: string;
}) {
  return (
    <div className="pane-head">
      <div>
        <h2>{icon && <Icon name={icon} />} {title}</h2>
        {meta && <div>{meta}</div>}
      </div>
      {action && <button className="command-button compact" type="button">{action}</button>}
      {actionIcon && <IconButton icon={actionIcon} label={actionIcon} />}
    </div>
  );
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function Metric({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className={`metric ${alert ? "alert" : ""}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function Slider({ label, value }: { label: string; value: string }) {
  return (
    <div className="slider-block">
      <div>
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <input max="100" min="0" readOnly type="range" value={Number(value.replace("%", ""))} />
      <div>
        <small>0%</small>
        <small>Confidence Score</small>
        <small>100%</small>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge ${status}`}>
      <span />
      {status}
    </span>
  );
}

function Footer({ active }: { active: "dry" | "human" | "manual" }) {
  return (
    <footer className="footer">
      <span>KAIROS COMMAND CENTER | LATENCY: 24ms</span>
      <div>
        <a className={active === "dry" ? "active" : ""}>Dry Run</a>
        <a className={active === "human" ? "active" : ""}>Human Interjection</a>
        <a className={active === "manual" ? "active" : ""}>Manual Escalation</a>
      </div>
    </footer>
  );
}

function IconButton({ icon, label }: { icon: string; label: string }) {
  return (
    <button className="icon-button" title={label} type="button">
      <Icon name={icon} />
    </button>
  );
}

function Icon({ name }: { name: string }) {
  return <span className="material-symbols-outlined">{name}</span>;
}

function getBranchStatus(branch: BranchRecord) {
  if (!branch.enabled) return "paused";
  const status = String(branch.metadata?.status ?? "running").toLowerCase();
  return status === "escalated" ? "escalated" : "running";
}

function getEscalations(branch: BranchRecord) {
  const value = branch.metadata?.escalations;
  return typeof value === "number" ? value : 0;
}

function formatHeartbeat(branch: BranchRecord) {
  const value = branch.metadata?.heartbeatMs;
  if (typeof value === "number") return `${value}ms`;
  return branch.enabled ? String(branch.config?.heartbeat ?? "5m") : "-";
}

function readAssets(branch: BranchRecord): string[] {
  const assets = branch.config?.assets;
  return Array.isArray(assets)
    ? assets.filter((asset): asset is string => typeof asset === "string")
    : [];
}

function timeOnly(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(11, 23);
}

function titleize(value: string) {
  return value
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
