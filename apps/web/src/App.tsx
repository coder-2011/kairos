import { useEffect, useState, type ReactNode } from "react";

import {
  BEAR_SYSTEM_PROMPT,
  BULL_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
} from "../../../src/agents/debate/prompt.js";
import { HEARTBEAT_SYSTEM_PROMPT } from "../../../src/agents/heartbeat/prompt.js";
import { INFORMATION_TOOL_CATALOG } from "../../../src/agents/information/tool-catalog.js";
import type {
  DebateConfigToolName,
  HeartbeatToolName,
  InformationConfigToolName,
  KairosBranchAgentConfig,
  KairosConfigModelRole,
  KairosReasoningEffort,
} from "../../../src/global/agent-config.js";
import {
  appendInterjection,
  createDebate,
  getBranches,
  getOpenRouterModels,
  getRunEvents,
  getRuns,
  triggerHeartbeat,
  updateBranch,
  type BranchRecord,
  type JsonRecord,
  type OpenRouterModelRecord,
  type RunEventRecord,
  type RunRecord,
} from "./api";

type View = "branches" | "monitoring" | "runDeepDive" | "config";
type LoadState = "loading" | "api" | "offline";
type RunMode = "agent" | "dry";
type ThemeMode = "light" | "dark";
type PromptConfigKey = keyof NonNullable<KairosBranchAgentConfig["prompts"]>;

const THEME_STORAGE_KEY = "kairos-theme";

const views: Array<{ id: View; label: string; icon: string }> = [
  { id: "branches", label: "Branch List", icon: "account_tree" },
  { id: "monitoring", label: "Monitoring", icon: "monitoring" },
  { id: "runDeepDive", label: "Run Deep-Dive", icon: "timeline" },
  { id: "config", label: "Branch Configuration", icon: "settings" },
];

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
    description: "Noise, stale-evidence, source risk, and priced-in argument instructions.",
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

const informationToolFields: Array<{
  label: string;
  key: InformationConfigToolName;
  access: "free" | "premium" | "mixed";
  purpose: string;
}> = INFORMATION_TOOL_CATALOG.map((tool) => ({
  label: humanizeToolName(tool.name),
  key: tool.name,
  access: tool.access,
  purpose: tool.purpose,
}));

const heartbeatToolFields: Array<{ label: string; key: HeartbeatToolName }> = [
  { label: "Supermemory Profile", key: "supermemory_profile" },
  { label: "Supermemory Search", key: "supermemory_search" },
  { label: "Exa News Search", key: "exa_news_search" },
];

const debateToolFields: Array<{ label: string; key: DebateConfigToolName }> = [
  { label: "Exa Search", key: "exa_search" },
  { label: "Exa Research", key: "exa_research" },
  { label: "Information Agent", key: "information" },
];

const defaultInformationToolPolicies = Object.fromEntries(
  informationToolFields.map((tool) => [tool.key, { enabled: true }]),
) as NonNullable<KairosBranchAgentConfig["tools"]>["information"];

const defaultHeartbeatToolPolicies = Object.fromEntries(
  heartbeatToolFields.map((tool) => [tool.key, { enabled: true }]),
) as NonNullable<KairosBranchAgentConfig["tools"]>["heartbeat"];

const defaultDebateToolPolicies = Object.fromEntries(
  debateToolFields.map((tool) => [tool.key, { enabled: true }]),
) as NonNullable<KairosBranchAgentConfig["tools"]>["debate"];

export function App() {
  const [view, setView] = useState<View>("branches");
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [events, setEvents] = useState<RunEventRecord[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [openRouterModels, setOpenRouterModels] = useState<OpenRouterModelRecord[]>([]);
  const [runMode, setRunMode] = useState<RunMode>("agent");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readStoredThemeMode());

  const selectedBranch =
    branches.find((branch) => branch.id === selectedBranchId) ?? branches[0];
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0];
  const premiumAccessEnabled = branches.some(
    (branch) => normalizeBranchConfig(branch).tools?.finnhubPremiumAccess === true,
  );

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

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
    let cancelled = false;
    getOpenRouterModels()
      .then((models) => {
        if (!cancelled) setOpenRouterModels(models);
      })
      .catch(() => {
        if (!cancelled) setOpenRouterModels([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedRun?.id || loadState !== "api") {
      setEvents([]);
      return;
    }

    let cancelled = false;
    getRunEvents(selectedRun.id)
      .then((nextEvents) => {
        if (!cancelled) setEvents(nextEvents);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });

    return () => {
      cancelled = true;
    };
  }, [loadState, selectedRun?.id]);

  async function runHeartbeat(branchId: string) {
    try {
      const run = await triggerHeartbeat(
        branchId,
        { source: "web_command" },
        { dryRun: runMode === "dry" },
      );
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setSelectedRunId(run.id);
      setView("monitoring");
      setLoadState("api");
    } catch {
      setView("monitoring");
      setLoadState("offline");
    }
  }

  async function startDebate(branchId: string) {
    try {
      const run = await createDebate({
        branchId,
        dryRun: runMode === "dry",
      });
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setSelectedRunId(run.id);
      setView("monitoring");
      setLoadState("api");
    } catch {
      setView("monitoring");
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

  async function setPremiumAccess(enabled: boolean) {
    if (branches.length === 0) return;

    try {
      const updatedBranches = await Promise.all(
        branches.map((branch) =>
          updateBranch(branch.id, {
            config: withFinnhubPremiumAccess(
              normalizeBranchConfig(branch),
              enabled,
            ),
          }),
        ),
      );
      setBranches((current) =>
        current.map((branch) =>
          updatedBranches.find((updated) => updated.id === branch.id) ?? branch,
        ),
      );
      setLoadState("api");
    } catch {
      setLoadState("offline");
    }
  }

  return (
    <div className="shell" data-theme={themeMode}>
      <SideNav
        premiumAccessDisabled={branches.length === 0}
        premiumAccessEnabled={premiumAccessEnabled}
        setView={setView}
        themeMode={themeMode}
        view={view}
        onPremiumAccessChange={(enabled) => void setPremiumAccess(enabled)}
        onThemeModeChange={setThemeMode}
      />
      <div className="workspace">
        <TopBar loadState={loadState} />
        {view === "branches" && (
          <BranchList
            branches={branches}
            runs={runs}
            onCreate={() => setView("config")}
            onSelect={(branch) => {
              setSelectedBranchId(branch.id);
              setView("config");
            }}
          />
        )}
        {view === "monitoring" && (
          <MonitoringView
            events={events}
            onInject={injectHumanContext}
            run={selectedRun}
          />
        )}
        {view === "runDeepDive" && (
          <RunDeepDive
            branches={branches}
            events={events}
            onSelectRun={setSelectedRunId}
            runs={runs}
            selectedRun={selectedRun}
          />
        )}
        {view === "config" && selectedBranch && (
          <BranchConfig
            branch={selectedBranch}
            openRouterModels={openRouterModels}
            runMode={runMode}
            onEscalate={() => void startDebate(selectedBranch.id)}
            onRunHeartbeat={() => void runHeartbeat(selectedBranch.id)}
            onRunModeChange={setRunMode}
            onSave={(input) =>
              void saveBranchSettings(selectedBranch.id, input)
            }
          />
        )}
        {view === "config" && !selectedBranch && (
          <EmptyCanvas
            icon="settings"
            message="Select a branch from Branch List. Branch Configuration is where laws and branch-agent settings are edited."
            title="No Branch Configuration"
          />
        )}
        <Footer
          active={
            view === "monitoring"
              ? "human"
              : view === "runDeepDive"
                ? "manual"
                : "dry"
          }
        />
      </div>
    </div>
  );
}

function SideNav({
  premiumAccessDisabled,
  premiumAccessEnabled,
  themeMode,
  view,
  setView,
  onPremiumAccessChange,
  onThemeModeChange,
}: {
  premiumAccessDisabled: boolean;
  premiumAccessEnabled: boolean;
  themeMode: ThemeMode;
  view: View;
  setView: (view: View) => void;
  onPremiumAccessChange: (enabled: boolean) => void;
  onThemeModeChange: (mode: ThemeMode) => void;
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
      <ThemeSwitch
        mode={themeMode}
        onChange={(mode) => onThemeModeChange(mode)}
      />
      <button
        className={`premium-access-button ${premiumAccessEnabled ? "enabled" : ""}`}
        disabled={premiumAccessDisabled}
        onClick={() => onPremiumAccessChange(!premiumAccessEnabled)}
        title={
          premiumAccessEnabled
            ? "Finnhub premium endpoints are enabled"
            : "Enable Finnhub premium endpoint access"
        }
        type="button"
      >
        <Icon name={premiumAccessEnabled ? "workspace_premium" : "lock_open"} />
        <span>
          <b>{premiumAccessEnabled ? "Premium User" : "Free User"}</b>
          <small>
            {premiumAccessEnabled
              ? "Premium endpoints enabled"
              : "I'm a premium user"}
          </small>
        </span>
      </button>
      <div className="operator-block">
        <div className="operator-chip">SO</div>
        <span>System Operator</span>
      </div>
    </nav>
  );
}

function ThemeSwitch({
  mode,
  onChange,
}: {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}) {
  const nextMode = mode === "dark" ? "light" : "dark";

  return (
    <button
      aria-label={`Switch to ${nextMode} mode`}
      className={`theme-toggle ${mode}`}
      onClick={() => onChange(nextMode)}
      title={`Switch to ${nextMode} mode`}
      type="button"
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <Icon name="light_mode" />
        <Icon name="dark_mode" />
        <span className="theme-toggle-thumb">
          <Icon name={mode === "dark" ? "dark_mode" : "light_mode"} />
        </span>
      </span>
      <span className="theme-toggle-copy">
        <b>{mode === "dark" ? "Dark Mode" : "Light Mode"}</b>
        <small>Flick display theme</small>
      </span>
    </button>
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
              <option>ALL ASSETS</option>
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
          <Metric
            alert={totalEscalations > 0}
            label="ESCALATIONS"
            value={totalEscalations.toString()}
          />
          <button
            className="command-button primary create-button"
            onClick={onCreate}
            type="button"
          >
            <Icon name="settings" />
            OPEN BRANCH CONFIG
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
                  <td>
                    {String(branch.metadata?.lastRun ?? timeOnly(branch.updatedAt))}
                  </td>
                  <td
                    className={`right ${getEscalations(branch) > 0 ? "danger-text" : ""}`}
                  >
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

function MonitoringView({
  events,
  run,
  onInject,
}: {
  events: RunEventRecord[];
  run?: RunRecord;
  onInject: (message: string) => void;
}) {
  const [message, setMessage] = useState("");
  const transcriptEvents = events.filter(
    (event) => event.type.startsWith("debate.") || event.type.startsWith("human."),
  );

  return (
    <main className="split-canvas">
      <section className="event-stream pane narrow">
        <PaneHeader
          icon="stream"
          meta={`ID: ${run?.id ?? "NO RUN"}`}
          title="RUN EVENT STREAM"
        />
        <div className="timeline-scroll">
          {events.length === 0 ? (
            <EmptyPanel
              icon="stream"
              message="Select or create a real run to populate the event stream."
              title="No Run Events"
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
        <PaneHeader
          action="EXPORT"
          icon="forum"
          meta="PROTOCOL: DELPHI-3"
          title="DEBATE TRANSCRIPT"
        />
        <div className="transcript-scroll">
          {transcriptEvents.length === 0 ? (
            <EmptyPanel
              icon="forum"
              message="Debate and human interjection events from the selected run will appear here."
              title="No Debate Transcript"
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
              <button
                className="command-button compact primary-outline"
                type="button"
              >
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

function RunDeepDive({
  branches,
  events,
  runs,
  selectedRun,
  onSelectRun,
}: {
  branches: BranchRecord[];
  events: RunEventRecord[];
  runs: RunRecord[];
  selectedRun?: RunRecord;
  onSelectRun: (runId: string) => void;
}) {
  const selectedBranch = branches.find(
    (branch) => branch.id === selectedRun?.branchId,
  );

  return (
    <main className="run-deep-dive">
      <section className="run-list-pane">
        <PaneHeader
          icon="receipt_long"
          meta={`${runs.length} RUNS`}
          title="RECORDED RUNS"
        />
        <div className="run-list">
          {runs.length === 0 ? (
            <EmptyPanel
              icon="history"
              message="Heartbeat and debate runs recorded by the local API will appear here for trace review."
              title="No Recorded Runs"
            />
          ) : (
            runs.map((run) => (
              <button
                className={`run-list-item ${run.id === selectedRun?.id ? "active" : ""}`}
                key={run.id}
                onClick={() => onSelectRun(run.id)}
                type="button"
              >
                <span>{run.kind.toUpperCase()}</span>
                <b>{run.id}</b>
                <em>{selectedBranchName(branches, run.branchId)}</em>
                <small>
                  {run.status} | {timeOnly(run.createdAt)}
                </small>
              </button>
            ))
          )}
        </div>
      </section>
      <section className="run-trace-pane">
        <div className="detail-head">
          <div>
            <h1>{selectedRun ? selectedRun.id : "Run Deep-Dive"}</h1>
            <p>
              {selectedRun
                ? `${selectedRun.kind.toUpperCase()} | ${selectedRun.status} | ${selectedBranch?.name ?? "No branch"}`
                : "Select a recorded run to review agent trace events, inputs, and outputs."}
            </p>
          </div>
        </div>
        {!selectedRun ? (
          <EmptyPanel
            icon="timeline"
            message="Run Deep-Dive is for reviewing previous agent traces and durable run payloads."
            title="No Run Selected"
          />
        ) : (
          <div className="run-deep-grid">
            <section className="trace-section">
              <div className="section-title">RUN INPUT</div>
              <pre className="json-block">
                {JSON.stringify(selectedRun.input, null, 2)}
              </pre>
            </section>
            <section className="trace-section">
              <div className="section-title">RUN OUTPUT</div>
              <pre className="json-block">
                {JSON.stringify(selectedRun.output ?? {}, null, 2)}
              </pre>
            </section>
            <section className="trace-section full">
              <div className="section-title">AGENT TRACE EVENTS</div>
              {events.length === 0 ? (
                <EmptyPanel
                  icon="stream"
                  message="No events were recorded for this run."
                  title="No Trace Events"
                />
              ) : (
                <div className="trace-event-list">
                  {events.map((event) => (
                    <EventRecordCard event={event} key={event.id} />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </section>
      <EvidencePane events={events} run={selectedRun} />
    </main>
  );
}

function RunModeSwitch({
  mode,
  onChange,
}: {
  mode: RunMode;
  onChange: (mode: RunMode) => void;
}) {
  return (
    <div
      className="run-mode-switch"
      title="Choose whether branch actions run the real agent path or deterministic dry-run fixtures."
    >
      <button
        className={mode === "agent" ? "active" : ""}
        onClick={() => onChange("agent")}
        type="button"
      >
        AGENT
      </button>
      <button
        className={mode === "dry" ? "active" : ""}
        onClick={() => onChange("dry")}
        type="button"
      >
        DRY
      </button>
    </div>
  );
}

function BranchConfig({
  branch,
  openRouterModels,
  runMode,
  onRunHeartbeat,
  onEscalate,
  onRunModeChange,
  onSave,
}: {
  branch: BranchRecord;
  openRouterModels: OpenRouterModelRecord[];
  runMode: RunMode;
  onRunHeartbeat: () => void;
  onEscalate: () => void;
  onRunModeChange: (mode: RunMode) => void;
  onSave: (input: {
    config: KairosBranchAgentConfig;
    lawText: string;
  }) => void;
}) {
  const [config, setConfig] = useState<KairosBranchAgentConfig>(() =>
    normalizeBranchConfig(branch),
  );
  const [lawText, setLawText] = useState(readLawText(branch));

  useEffect(() => {
    setConfig(normalizeBranchConfig(branch));
    setLawText(readLawText(branch));
  }, [branch.id, branch.config, branch.description, branch.law]);

  const heartbeatInterval = config.heartbeat?.intervalMinutes ?? 5;
  const seedWindowDays = config.heartbeat?.seedWindowDays ?? 30;
  const heartbeatMaxToolSteps = config.heartbeat?.maxToolSteps ?? 3;
  const debateMaxTurns = config.budgets?.debateMaxTurns ?? 6;
  const debateMaxToolCalls = config.budgets?.debateMaxToolCalls ?? 3;
  const informationMaxToolCalls = config.budgets?.informationMaxToolCalls ?? 5;
  const finnhubPremiumAccess = config.tools?.finnhubPremiumAccess ?? false;
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
          <RunModeSwitch mode={runMode} onChange={onRunModeChange} />
          <button className="command-button" onClick={onRunHeartbeat} type="button">
            <Icon name="play_arrow" /> {runMode === "dry" ? "DRY" : "AGENT"} HEARTBEAT
          </button>
          <button className="command-button primary-outline" onClick={onEscalate} type="button">
            <Icon name="warning" /> {runMode === "dry" ? "DRY" : "AGENT"} ESCALATION
          </button>
          <button
            className="command-button"
            onClick={() => {
              setConfig(normalizeBranchConfig(branch));
              setLawText(readLawText(branch));
            }}
            type="button"
          >
            DISCARD
          </button>
          <button
            className="command-button primary"
            onClick={() => onSave({ config, lawText })}
            type="button"
          >
            SAVE CONFIGURATION
          </button>
        </div>
      </div>
      <div className="config-body">
        <FieldLabel label="The Law (Primary Thesis)">
          <textarea
            onChange={(event) => setLawText(event.target.value)}
            placeholder="Describe what this branch watches, what counts as signal, and what should be ignored."
            value={lawText}
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
                  value={config.prompts?.[field.key] ?? field.defaultText}
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
                  list="openrouter-models"
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
          <datalist id="openrouter-models">
            {openRouterModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </datalist>
        </div>
        <div className="config-grid">
          <FieldLabel label="Finnhub Access">
            <div className="tool-picker">
              <label>
                <input
                  checked={finnhubPremiumAccess}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      tools: {
                        ...current.tools,
                        finnhubPremiumAccess: event.target.checked,
                      },
                    }))
                  }
                  type="checkbox"
                />
                <span>Premium endpoints enabled for this branch</span>
              </label>
            </div>
          </FieldLabel>
          <FieldLabel label="Information Agent Tools">
            <div className="tool-picker">
              {informationToolFields.map((tool) => {
                const gatedByPremium =
                  tool.access === "premium" && !finnhubPremiumAccess;

                return (
                  <label key={tool.key} title={tool.purpose}>
                    <input
                      checked={
                        !gatedByPremium &&
                        (config.tools?.information?.[tool.key]?.enabled ?? true)
                      }
                      disabled={gatedByPremium}
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
                    <span>
                      {tool.label} ({tool.access})
                    </span>
                    <input
                      checked={config.tools?.information?.[tool.key]?.required ?? false}
                      disabled={
                        gatedByPremium ||
                        (config.tools?.information?.[tool.key]?.enabled === false)
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
                                required: event.target.checked,
                              },
                            },
                          },
                        }))
                      }
                      type="checkbox"
                    />
                    <em>Required</em>
                  </label>
                );
              })}
            </div>
          </FieldLabel>
          <FieldLabel label="Debate Tools">
            <div className="tool-picker">
              {debateToolFields.map((tool) => (
                <label key={tool.key}>
                  <input
                    checked={config.tools?.debate?.[tool.key]?.enabled ?? true}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        tools: {
                          ...current.tools,
                          debate: {
                            ...current.tools?.debate,
                            [tool.key]: {
                              ...current.tools?.debate?.[tool.key],
                              enabled: event.target.checked,
                            },
                          },
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  <span>{tool.label}</span>
                  <input
                    checked={config.tools?.debate?.[tool.key]?.required ?? false}
                    disabled={config.tools?.debate?.[tool.key]?.enabled === false}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        tools: {
                          ...current.tools,
                          debate: {
                            ...current.tools?.debate,
                            [tool.key]: {
                              ...current.tools?.debate?.[tool.key],
                              required: event.target.checked,
                            },
                          },
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  <em>Required</em>
                </label>
              ))}
            </div>
          </FieldLabel>
          <FieldLabel label="Heartbeat Tools">
            <div className="tool-picker">
              {heartbeatToolFields.map((tool) => (
                <label key={tool.key}>
                  <input
                    checked={config.tools?.heartbeat?.[tool.key]?.enabled ?? true}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        tools: {
                          ...current.tools,
                          heartbeat: {
                            ...current.tools?.heartbeat,
                            [tool.key]: {
                              ...current.tools?.heartbeat?.[tool.key],
                              enabled: event.target.checked,
                            },
                          },
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  <span>{tool.label}</span>
                  <input
                    checked={config.tools?.heartbeat?.[tool.key]?.required ?? false}
                    disabled={config.tools?.heartbeat?.[tool.key]?.enabled === false}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        tools: {
                          ...current.tools,
                          heartbeat: {
                            ...current.tools?.heartbeat,
                            [tool.key]: {
                              ...current.tools?.heartbeat?.[tool.key],
                              required: event.target.checked,
                            },
                          },
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  <em>Required</em>
                </label>
              ))}
            </div>
          </FieldLabel>
          <FieldLabel label="Data Packet">
            <input
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  research: {
                    ...current.research,
                    dataPacket: event.target.value || undefined,
                  },
                }))
              }
              placeholder="ticker, sector, law, or custom packet id"
              value={config.research?.dataPacket ?? ""}
            />
          </FieldLabel>
        </div>
        <FieldLabel label="Research Seeding (Exa)">
          <textarea
            onChange={(event) =>
              setConfig((current) => ({
                ...current,
                research: {
                  ...current.research,
                  exaInstruction: event.target.value || undefined,
                },
              }))
            }
            placeholder="Persistent research instruction for this branch."
            value={config.research?.exaInstruction ?? ""}
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
          <FieldLabel label="Heartbeat Max Tool Steps">
            <input
              min="0"
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  heartbeat: {
                    ...current.heartbeat,
                    maxToolSteps: Number(event.target.value),
                  },
                }))
              }
              type="number"
              value={heartbeatMaxToolSteps}
            />
          </FieldLabel>
          <FieldLabel label="Debate Max Turns">
            <input
              min="1"
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  budgets: {
                    ...current.budgets,
                    debateMaxTurns: Number(event.target.value),
                  },
                }))
              }
              type="number"
              value={debateMaxTurns}
            />
          </FieldLabel>
          <FieldLabel label="Debate Max Tool Calls">
            <input
              min="0"
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  budgets: {
                    ...current.budgets,
                    debateMaxToolCalls: Number(event.target.value),
                  },
                }))
              }
              type="number"
              value={debateMaxToolCalls}
            />
          </FieldLabel>
          <FieldLabel label="Information Max Tool Calls">
            <input
              min="0"
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  budgets: {
                    ...current.budgets,
                    informationMaxToolCalls: Number(event.target.value),
                  },
                }))
              }
              type="number"
              value={informationMaxToolCalls}
            />
          </FieldLabel>
        </div>
        <div>
          <div className="field-label">ESCALATION AND REVIEW THRESHOLDS</div>
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
        <input readOnly value={formatConfidence(thresholds?.notifyConfidence)} />
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
      intervalMinutes: heartbeat.intervalMinutes ?? legacyInterval ?? 5,
      seedWindowDays: heartbeat.seedWindowDays ?? 30,
      maxToolSteps: heartbeat.maxToolSteps ?? 3,
    },
    prompts: {
      ...config.prompts,
      heartbeatSystemPrompt:
        config.prompts?.heartbeatSystemPrompt ?? HEARTBEAT_SYSTEM_PROMPT,
      debateJudgeSystemPrompt:
        config.prompts?.debateJudgeSystemPrompt ?? JUDGE_SYSTEM_PROMPT,
      debateBullSystemPrompt:
        config.prompts?.debateBullSystemPrompt ?? BULL_SYSTEM_PROMPT,
      debateBearSystemPrompt:
        config.prompts?.debateBearSystemPrompt ?? BEAR_SYSTEM_PROMPT,
    },
    tools: {
      ...config.tools,
      heartbeat: {
        ...defaultHeartbeatToolPolicies,
        ...config.tools?.heartbeat,
      },
      debate: {
        ...defaultDebateToolPolicies,
        ...config.tools?.debate,
      },
      information: {
        ...defaultInformationToolPolicies,
        ...config.tools?.information,
      },
      finnhubPremiumAccess: config.tools?.finnhubPremiumAccess ?? false,
    },
    budgets: {
      debateMaxTurns: 6,
      debateMaxToolCalls: 3,
      informationMaxToolCalls: 5,
      ...config.budgets,
    },
    thresholds: {
      notifyConfidence: 0.75,
      paperTradeDraftConfidence: 0.9,
      ...config.thresholds,
    },
    research: {
      ...config.research,
    },
  };
}

function withFinnhubPremiumAccess(
  config: KairosBranchAgentConfig,
  enabled: boolean,
): KairosBranchAgentConfig {
  return {
    ...config,
    tools: {
      ...config.tools,
      finnhubPremiumAccess: enabled,
    },
  };
}

function readLawText(branch: BranchRecord): string {
  return typeof branch.law?.thesis === "string"
    ? branch.law.thesis
    : branch.description ?? "";
}

function humanizeToolName(toolName: InformationConfigToolName): string {
  return toolName
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function readStoredThemeMode(): ThemeMode {
  return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
}

function selectedBranchName(branches: BranchRecord[], branchId: string | undefined) {
  if (!branchId) return "No branch";
  return branches.find((branch) => branch.id === branchId)?.name ?? branchId;
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
  return typeof value === "number"
    ? `${Math.round(value * 100)}%`
    : "Not configured";
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
