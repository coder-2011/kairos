import { useEffect, useState, type ReactNode } from "react";

import {
  BEAR_SYSTEM_PROMPT,
  BULL_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
} from "../../../src/agents/debate/prompt.js";
import { HEARTBEAT_SYSTEM_PROMPT } from "../../../src/agents/heartbeat/prompt.js";
import type {
  InformationConfigToolName,
  KairosBranchAgentConfig,
  KairosConfigModelRole,
  KairosReasoningEffort,
} from "../../../src/global/agent-config.js";
import {
  appendInterjection,
  createDebate,
  getBranches,
  getRunEvents,
  getRuns,
  triggerHeartbeat,
  updateBranch,
  type BranchRecord,
  type JsonRecord,
  type RunEventRecord,
  type RunRecord,
} from "./api";

type View = "branches" | "debate" | "detail" | "draft" | "config";
type LoadState = "loading" | "api" | "offline";
type RunMode = "dry" | "live";

const views: Array<{ id: View; label: string; icon: string }> = [
  { id: "branches", label: "Branch List", icon: "account_tree" },
  { id: "debate", label: "Monitoring", icon: "monitoring" },
  { id: "detail", label: "Run Deep-Dive", icon: "timeline" },
  { id: "config", label: "Branch Configuration", icon: "settings" },
];

type PromptConfigKey = keyof NonNullable<KairosBranchAgentConfig["prompts"]>;

const promptFields: Array<{
  role: string;
  key: PromptConfigKey;
  description: string;
  defaultText: string;
}> = [
  {
    role: "Heartbeat",
    key: "heartbeatSystemPrompt",
    description: "Frequent branch monitor instructions.",
    defaultText: HEARTBEAT_SYSTEM_PROMPT,
  },
  {
    role: "Debate Judge",
    key: "debateJudgeSystemPrompt",
    description: "Debate orchestration and speaker-selection instructions.",
    defaultText: JUDGE_SYSTEM_PROMPT,
  },
  {
    role: "Debate Bull",
    key: "debateBullSystemPrompt",
    description: "Materiality and opportunity-side argument instructions.",
    defaultText: BULL_SYSTEM_PROMPT,
  },
  {
    role: "Debate Bear",
    key: "debateBearSystemPrompt",
    description: "Noise, risk, stale-evidence, and priced-in argument instructions.",
    defaultText: BEAR_SYSTEM_PROMPT,
  },
];

const modelRoleFields: Array<{ label: string; key: KairosConfigModelRole }> = [
  { label: "Heartbeat", key: "heartbeat" },
  { label: "Information Planner", key: "informationPlanner" },
  { label: "Information Synthesis", key: "informationSynthesis" },
  { label: "Debate Judge", key: "debateJudge" },
  { label: "Debate Bull", key: "debateBull" },
  { label: "Debate Bear", key: "debateBear" },
  { label: "Debate Final", key: "debateFinal" },
];

const reasoningEffortOptions: Array<KairosReasoningEffort | ""> = [
  "",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

const informationToolFields: Array<{ label: string; key: InformationConfigToolName }> = [
  { label: "SEC Filings", key: "finnhub_filings" },
  { label: "Exa News Search", key: "exa_search" },
  { label: "Exa Research", key: "exa_research" },
  { label: "Source Reader", key: "exa_contents" },
  { label: "Supermemory Search", key: "supermemory_search" },
  { label: "Finnhub Company News", key: "finnhub_company_news" },
  { label: "Finnhub Basic Financials", key: "finnhub_basic_financials" },
  { label: "Finnhub Earnings", key: "finnhub_company_earnings" },
  { label: "Finnhub Insider Transactions", key: "finnhub_insider_transactions" },
];

export function App() {
  const [view, setView] = useState<View>("branches");
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [events, setEvents] = useState<RunEventRecord[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [runMode, setRunMode] = useState<RunMode>("dry");

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

        setBranches(apiBranches);
        setRuns(apiRuns);
        setSelectedBranchId(apiBranches[0]?.id ?? "");
        setSelectedRunId(apiRuns[0]?.id ?? "");
        setLoadState("api");
      } catch {
        if (cancelled) return;
        setBranches([]);
        setRuns([]);
        setEvents([]);
        setLoadState("offline");
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
          setEvents(nextEvents);
        }
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });

    return () => {
      cancelled = true;
    };
  }, [loadState, selectedRun?.id]);

  async function runHeartbeat(branchId: string) {
    const dryRun = runMode === "dry";
    try {
      const run = await triggerHeartbeat(
        branchId,
        { source: "web_command", runMode },
        { dryRun },
      );
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setSelectedRunId(run.id);
      setView("debate");
      setLoadState("api");
    } catch {
      setView("debate");
      setLoadState("offline");
    }
  }

  async function startDebate(branchId: string) {
    const dryRun = runMode === "dry";
    try {
      const run = await createDebate({
        branchId,
        dryRun,
        escalation: {
          branchId,
          summary: dryRun
            ? "Manual dry-run escalation opened from the web command center."
            : "Manual live escalation opened from the web command center.",
        },
      });
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setSelectedRunId(run.id);
      setView("debate");
      setLoadState("api");
    } catch {
      setView("debate");
      setLoadState("offline");
    }
  }

  async function injectHumanContext(message: string) {
    if (!selectedRun?.id || !message.trim()) return;

    try {
      const event = await appendInterjection(selectedRun.id, message.trim());
      setEvents((current) => [...current, event]);
      setLoadState("api");
    } catch {
      setLoadState("offline");
    }
  }

  async function saveBranchSettings(
    branchId: string,
    input: {
      config: KairosBranchAgentConfig;
      lawText: string;
    },
  ) {
    try {
      const currentBranch = branches.find((branch) => branch.id === branchId);
      const branch = await updateBranch(branchId, {
        description: input.lawText,
        law: {
          ...currentBranch?.law,
          thesis: input.lawText,
        },
        config: input.config,
      });
      setBranches((current) =>
        current.map((item) => (item.id === branch.id ? branch : item)),
      );
      setLoadState("api");
    } catch {
      setLoadState("offline");
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
              setView("config");
            }}
            onCreate={() => setView("config")}
          />
        )}
        {view === "monitoring" && (
          <DebateView
            events={events}
            run={selectedRun}
            onInject={injectHumanContext}
          />
        )}
        {view === "runDeepDive" && (
          <RunDeepDive
            branches={branches}
            events={events}
            runs={runs}
            selectedRun={selectedRun}
            onSelectRun={setSelectedRunId}
          />
        )}
        {view === "config" && selectedBranch && (
          <BranchConfig
            branch={selectedBranch}
            onDryRun={() => void runDryHeartbeat(selectedBranch.id)}
            onEscalate={() => void startDebate(selectedBranch.id)}
            onSave={(input) =>
              void saveBranchSettings(selectedBranch.id, input)
            }
          />
        )}
        {view === "config" && !selectedBranch && (
          <EmptyCanvas
            icon="settings"
            title="No Branch Configuration"
            message="Select a branch from Branch List. Branch Configuration is where laws and branch-agent settings are edited."
          />
        )}
        <Footer active={view === "monitoring" ? "human" : view === "runDeepDive" ? "manual" : "dry"} />
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
              : "API OFFLINE"}
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
            {branches.length === 0 ? (
              <tr>
                <td className="empty-table-cell" colSpan={6}>
                  No branches returned by the local API.
                </td>
              </tr>
            ) : (
              branches.map((branch) => (
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
              ))
            )}
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
  const transcriptEvents = events.filter((event) =>
    event.type.startsWith("debate.") || event.type.startsWith("human."),
  );

  return (
    <main className="split-canvas">
      <section className="event-stream pane narrow">
        <PaneHeader icon="stream" title="RUN EVENT STREAM" meta={`ID: ${run?.id ?? "NO RUN"}`} />
        <div className="timeline-scroll">
          {events.length === 0 ? (
            <EmptyPanel
              icon="stream"
              title="No Run Events"
              message="Select or create a real run to populate the event stream."
            />
          ) : (
            events.map((event, index) => (
              <TimelineEvent
                event={event}
                key={event.id}
                last={index === events.length - 1}
              />
            ))
          )}
        </div>
      </section>
      <section className="transcript pane wide">
        <PaneHeader icon="forum" title="DEBATE TRANSCRIPT" meta="PROTOCOL: DELPHI-3" action="EXPORT" />
        <div className="transcript-scroll">
          {transcriptEvents.length === 0 ? (
            <EmptyPanel
              icon="forum"
              title="No Debate Transcript"
              message="Debate and human interjection events from the selected run will appear here."
            />
          ) : (
            transcriptEvents.map((event) => (
              <EventRecordCard event={event} key={event.id} />
            ))
          )}
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
      <EvidencePane events={events} run={run} />
    </main>
  );
}

function BranchDetail({
  branch,
  runs,
  onEdit,
  onDryRun,
  onEscalate,
}: {
  branch: BranchRecord;
  runs: RunRecord[];
  onEdit: () => void;
  onDryRun: () => void;
  onEscalate: () => void;
}) {
  const assets = readAssets(branch).join(", ") || "No assets configured";
  const branchRuns = runs.filter((run) => run.branchId === branch.id);
  const lawText =
    typeof branch.law?.thesis === "string"
      ? branch.law.thesis
      : branch.description ?? "No law text returned by the local API.";

  return (
    <main className="detail-canvas">
      <section className="detail-main">
        <div className="detail-head">
          <div>
            <h1>{branch.name}</h1>
            <p>
              Target Asset: <b>{assets}</b> | Heartbeat:{" "}
              <b>{formatHeartbeat(branch)}</b>
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
            <b>{branch.lawId ?? branch.id}</b>
          </div>
          <pre>{lawText}</pre>
        </section>
        <section className="recent-runs">
          <div className="section-title">RECENT RUNS (HEARTBEAT)</div>
          {branchRuns.length === 0 ? (
            <EmptyPanel
              icon="history"
              title="No Runs"
              message="Heartbeat and debate runs for this branch will appear here after the local API records them."
            />
          ) : (
            branchRuns.map((run) => (
              <div className={`run-row ${run.status === "failed" ? "alert" : ""}`} key={run.id}>
                <span>{timeOnly(run.createdAt)}</span>
                <b>{run.kind.toUpperCase()}</b>
                <em>{run.status}</em>
                <a>{run.id}</a>
              </div>
            ))
          )}
        </section>
      </section>
      <aside className="detail-side">
        <SettingsPanel branch={branch} />
        <EscalationCard runs={branchRuns} />
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
            <input placeholder="Enter a monitoring-law title..." />
          </FieldLabel>
          <FieldLabel label="Market Signal Logic">
            <textarea
              className="code-area"
              placeholder="Describe the branch-specific signal logic to compile..."
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
        <EmptyPanel
          icon="inventory_2"
          title="No Saved Snippets"
          message="Saved law snippets from the real workspace will appear here when that source exists."
        />
        <div className="simulation-panel">
          <div className="section-title">SIMULATION: DRY RUN</div>
          <Icon name="query_stats" />
          <p>Compile logic to preview historical behavior.</p>
        </div>
      </aside>
    </main>
  );
}

function BranchConfig({
  branch,
  onSave,
}: {
  branch: BranchRecord;
  onSave: (config: KairosBranchAgentConfig) => void;
}) {
  const [config, setConfig] = useState<KairosBranchAgentConfig>(() =>
    normalizeBranchConfig(branch),
  );

  useEffect(() => {
    setConfig(normalizeBranchConfig(branch));
  }, [branch.id, branch.config]);

  const heartbeatInterval = config.heartbeat?.intervalMinutes ?? 5;
  const seedWindowDays = config.heartbeat?.seedWindowDays ?? 30;
  const notifyConfidence = Math.round(
    (config.thresholds?.notifyConfidence ?? 0.75) * 100,
  );
  const paperTradeDraftConfidence = Math.round(
    (config.thresholds?.paperTradeDraftConfidence ??
      config.thresholds?.buyConfidence ??
      0.9) * 100,
  );

  return (
    <main className="config-canvas">
      <div className="editor-head sticky">
        <h1>Branch Configuration</h1>
        <div className="button-row">
          <button
            className="command-button"
            onClick={() => setConfig(normalizeBranchConfig(branch))}
            type="button"
          >
            DISCARD
          </button>
          <button
            className="command-button primary"
            onClick={() => onSave(config)}
            type="button"
          >
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
          <div className="field-label">AGENT SYSTEM PROMPTS</div>
          <div className="prompt-grid">
            {promptFields.map((field) => (
              <FieldLabel label={field.role} key={field.key}>
                <textarea
                  className="prompt-area"
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      prompts: {
                        ...current.prompts,
                        [field.key]: event.target.value,
                      },
                    }))
                  }
                  placeholder={field.description}
                  value={config.prompts?.[field.key] ?? ""}
                />
              </FieldLabel>
            ))}
          </div>
        </div>
        <div>
          <div className="field-label">MODEL ROLE CONFIGURATION</div>
          <div className="model-grid">
            {modelRoleFields.map((field) => (
              <div className="model-row" key={field.key}>
                <span>{field.label}</span>
                <input
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      models: {
                        ...current.models,
                        [field.key]: {
                          ...current.models?.[field.key],
                          model: event.target.value || undefined,
                        },
                      },
                    }))
                  }
                  placeholder="OpenRouter model id"
                  value={config.models?.[field.key]?.model ?? ""}
                />
                <select
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      models: {
                        ...current.models,
                        [field.key]: {
                          ...current.models?.[field.key],
                          reasoningEffort:
                            event.target.value === ""
                              ? undefined
                              : (event.target.value as KairosReasoningEffort),
                        },
                      },
                    }))
                  }
                  value={config.models?.[field.key]?.reasoningEffort ?? ""}
                >
                  {reasoningEffortOptions.map((effort) => (
                    <option key={effort || "default"} value={effort}>
                      {effort === "" ? "DEFAULT EFFORT" : effort.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
        <div className="config-grid">
          <FieldLabel label="Information Agent Tools">
            <div className="tool-picker">
              {informationToolFields.map((tool) => (
                <label key={tool.key}>
                  <input
                    checked={
                      config.tools?.information?.[tool.key]?.enabled ?? true
                    }
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        tools: {
                          ...current.tools,
                          information: {
                            ...current.tools?.information,
                            [tool.key]: {
                              ...current.tools?.information?.[tool.key],
                              enabled: event.target.checked,
                            },
                          },
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  <span>{tool.label}</span>
                </label>
              ))}
            </div>
          </FieldLabel>
          <FieldLabel label="Data Seeding (Heartbeat & Debate)">
            <select
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  research: {
                    ...current.research,
                    dataPacket: event.target.value,
                  },
                }))
              }
              value={config.research?.dataPacket ?? "equities"}
            >
              <option value="equities">Tracked equities rolling 30-day packet</option>
              <option value="crypto">Crypto liquidity packet</option>
              <option value="earnings">Tech earnings calendar packet</option>
              <option value="regulatory">Regulatory catalyst packet</option>
            </select>
          </FieldLabel>
        </div>
        <FieldLabel label="Research Seeding (Exa)">
          <textarea
            onChange={(event) =>
              setConfig((current) => ({
                ...current,
                research: {
                  ...current.research,
                  exaInstruction: event.target.value,
                },
              }))
            }
            value={
              config.research?.exaInstruction ??
              "Find recent, citeable evidence relevant to the branch law. Prefer primary sources and source diversity."
            }
          />
        </FieldLabel>
        <div className="config-grid">
          <FieldLabel label="Heartbeat Interval Minutes">
            <input
              min="1"
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  heartbeat: {
                    ...current.heartbeat,
                    intervalMinutes: Number(event.target.value),
                  },
                }))
              }
              type="number"
              value={heartbeatInterval}
            />
          </FieldLabel>
          <FieldLabel label="Seed Window Days">
            <input
              min="1"
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  heartbeat: {
                    ...current.heartbeat,
                    seedWindowDays: Number(event.target.value),
                  },
                }))
              }
              type="number"
              value={seedWindowDays}
            />
          </FieldLabel>
        </div>
        <div>
          <div className="field-label">EXECUTION THRESHOLDS</div>
          <div className="threshold-wide">
            <Slider
              label="Notification Threshold"
              onChange={(value) =>
                setConfig((current) => ({
                  ...current,
                  thresholds: {
                    ...current.thresholds,
                    notifyConfidence: value / 100,
                  },
                }))
              }
              value={`${notifyConfidence}%`}
            />
            <Slider
              label="Paper Trade Draft Threshold"
              onChange={(value) =>
                setConfig((current) => ({
                  ...current,
                  thresholds: {
                    ...current.thresholds,
                    paperTradeDraftConfidence: value / 100,
                  },
                }))
              }
              value={`${paperTradeDraftConfidence}%`}
            />
          </div>
        </div>
        <button
          className="command-button primary"
          onClick={() => onSave(config)}
          type="button"
        >
          SAVE CONFIGURATION
        </button>
      </div>
    </main>
  );
}

function EvidencePane({
  events,
  run,
}: {
  events: RunEventRecord[];
  run?: RunRecord;
}) {
  const selectedEvidence = events.find(
    (event) =>
      event.type.includes("tool") ||
      event.type.includes("source") ||
      event.type.includes("evidence"),
  );
  const snapshot = selectedEvidence?.payload ?? run?.output ?? run?.input;

  return (
    <section className="evidence pane medium">
      <PaneHeader icon="database" title="EVIDENCE & SOURCE" meta="" actionIcon="close" />
      <div className="evidence-scroll">
        {!snapshot ? (
          <EmptyPanel
            icon="database"
            title="No Evidence Payload"
            message="Tool, source, evidence, run input, or run output payloads will appear here."
          />
        ) : (
          <>
            <div className="source-card">
              <div className="field-label">RECORD IDENTIFIER</div>
              <h1>{selectedEvidence?.id ?? run?.id ?? "RUN PAYLOAD"}</h1>
              <div className="source-tags">
                <span>{selectedEvidence?.type ?? run?.kind ?? "record"}</span>
                <span>{run?.status ?? "loaded"}</span>
              </div>
            </div>
            <div className="field-label">RAW DATA SNAPSHOT</div>
            <pre className="json-block">{JSON.stringify(snapshot, null, 2)}</pre>
            <div className="field-label">TIMELINE ALIGNMENT</div>
            <div className="alignment-row">
              <span>Run Created</span>
              <b>{run ? timeOnly(run.createdAt) : "-"}</b>
            </div>
            <div className="alignment-row">
              <span>Last Event</span>
              <b>{events.at(-1) ? timeOnly(events.at(-1)!.timestamp) : "-"}</b>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function SettingsPanel({ branch }: { branch: BranchRecord }) {
  const thresholds = branch.config?.thresholds;

  return (
    <section className="side-panel">
      <div className="section-title">
        <Icon name="tune" /> BRANCH SETTINGS
      </div>
      <FieldLabel label="Notify Confidence">
        <input
          readOnly
          value={formatConfidence(thresholds?.notifyConfidence)}
        />
      </FieldLabel>
      <FieldLabel label="Paper Trade Draft Threshold">
        <input
          readOnly
          value={formatConfidence(
            thresholds?.paperTradeDraftConfidence ?? thresholds?.buyConfidence,
          )}
        />
      </FieldLabel>
      <FieldLabel label="Operational Mode">
        <div className="mode-list">
          <button className="selected" type="button">DRY RUN <Icon name="check_circle" /></button>
          <button type="button">HUMAN INTERJECTION</button>
          <button type="button">MANUAL ESCALATION</button>
        </div>
      </FieldLabel>
    </section>
  );
}

function EscalationCard({ runs }: { runs: RunRecord[] }) {
  const escalatedRuns = runs.filter(
    (run) => run.kind === "debate" || run.status === "failed",
  );

  return (
    <section className="side-panel grow">
      <div className="section-title">
        <Icon name="warning" /> ACTIVE ESCALATIONS
      </div>
      {escalatedRuns.length === 0 ? (
        <EmptyPanel
          icon="warning"
          title="No Active Escalations"
          message="Debate runs and failed runs for this branch will appear here."
        />
      ) : (
        escalatedRuns.map((run) => (
          <div className="escalation-card" key={run.id}>
            <div>
              <b>{run.kind.toUpperCase()}</b>
              <span>{timeOnly(run.createdAt)}</span>
            </div>
            <p>{String(run.output?.summary ?? run.status)}</p>
            <div className="button-row">
              <button className="command-button" type="button">VIEW RUN</button>
            </div>
          </div>
        ))
      )}
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

function EventRecordCard({ event }: { event: RunEventRecord }) {
  const actor =
    event.type.startsWith("human.") ? "HUMAN" : event.type.split(".")[0].toUpperCase();

  return (
    <article className="agent-card judge">
      <div className="agent-card-head">
        <span>
          <Icon name={event.type.startsWith("human.") ? "person" : "notes"} />
          EVENT: {actor}
        </span>
        <b>{timeOnly(event.timestamp)}</b>
      </div>
      <p>{String(event.payload.summary ?? event.payload.message ?? titleize(event.type))}</p>
      <pre className="event-json">{JSON.stringify(event.payload, null, 2)}</pre>
    </article>
  );
}

function EmptyCanvas({
  icon,
  title,
  message,
}: {
  icon: string;
  title: string;
  message: string;
}) {
  return (
    <main className="empty-canvas">
      <EmptyPanel icon={icon} title={title} message={message} />
    </main>
  );
}

function EmptyPanel({
  icon,
  title,
  message,
}: {
  icon: string;
  title: string;
  message: string;
}) {
  return (
    <div className="empty-panel">
      <Icon name={icon} />
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
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

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange?: (value: number) => void;
}) {
  const numericValue = Number(value.replace("%", ""));
  return (
    <div className="slider-block">
      <div>
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <input
        max="100"
        min="0"
        onChange={(event) => onChange?.(Number(event.target.value))}
        readOnly={!onChange}
        type="range"
        value={numericValue}
      />
      <div>
        <small>0%</small>
        <small>Confidence Score</small>
        <small>100%</small>
      </div>
    </div>
  );
}

function normalizeBranchConfig(branch: BranchRecord): KairosBranchAgentConfig {
  const config = branch.config ?? {};
  const legacyConfig = config as JsonRecord;
  const heartbeat = config.heartbeat ?? {};
  const legacyInterval =
    typeof legacyConfig.heartbeat === "string"
      ? parseHeartbeatIntervalMinutes(legacyConfig.heartbeat)
      : undefined;

  return {
    ...config,
    assets: config.assets ?? readAssets(branch),
    heartbeat: {
      intervalMinutes:
        heartbeat.intervalMinutes ?? legacyInterval ?? 5,
      seedWindowDays: heartbeat.seedWindowDays ?? 30,
      maxToolSteps: heartbeat.maxToolSteps ?? 3,
    },
    tools: {
      ...config.tools,
      information: {
        exa_search: { enabled: true },
        exa_research: { enabled: true },
        exa_contents: { enabled: true },
        finnhub_filings: { enabled: true },
        supermemory_search: { enabled: true },
        ...config.tools?.information,
      },
    },
    thresholds: {
      notifyConfidence: 0.75,
      paperTradeDraftConfidence: 0.9,
      ...config.thresholds,
    },
    research: {
      dataPacket: "equities",
      exaInstruction:
        "Find recent, citeable evidence relevant to the branch law. Prefer primary sources and source diversity.",
      ...config.research,
    },
  };
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
  const interval = branch.config?.heartbeat?.intervalMinutes;
  if (!branch.enabled) return "-";
  return typeof interval === "number" ? `${interval}m` : "Not configured";
}

function formatConfidence(value: number | undefined) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "Not configured";
}

function readAssets(branch: BranchRecord): string[] {
  const assets = branch.config?.assets;
  return Array.isArray(assets)
    ? assets.filter((asset): asset is string => typeof asset === "string")
    : [];
}

function parseHeartbeatIntervalMinutes(value: string): number | undefined {
  const match = value.match(/^(\d+(?:\.\d+)?)(s|m|h)?$/);
  if (!match) return undefined;

  const amount = Number(match[1]);
  const unit = match[2] ?? "m";

  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  if (unit === "s") return amount / 60;
  if (unit === "h") return amount * 60;
  return amount;
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
