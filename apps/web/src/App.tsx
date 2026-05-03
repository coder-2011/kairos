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
  KairosConfigModelRole,
  KairosReasoningEffort,
} from "../../../src/global/agent-config.js";
import {
  appendInterjection,
  createBranch,
  createRouterChat,
  createDebate,
  getBranches,
  getMessages,
  getOpenRouterModels,
  getPortfolio,
  getRunEvents,
  getRuns,
  getRouterChats,
  getRouterMessages,
  getTradeIntents,
  triggerHeartbeat,
  sendRouterMessage,
  updateBranch,
  type AllowedOrderType,
  type BranchRecord,
  type JsonRecord,
  type MessageRecord,
  type OpenRouterModelRecord,
  type PortfolioSnapshot,
  type RunEventRecord,
  type RunRecord,
  type RouterChatRecord,
  type RouterMessageRecord,
  type RouterToolCallRecord,
  type TradeIntentRecord,
  type WebBranchConfig,
} from "./api";

type View = "branches" | "router" | "monitoring" | "portfolio" | "runDeepDive" | "config";
type LoadState = "loading" | "api" | "offline";
type RunMode = "agent" | "dry";
type ThemeMode = "light" | "dark";
type PromptConfigKey = keyof NonNullable<WebBranchConfig["prompts"]>;

const THEME_STORAGE_KEY = "kairos-theme-v2";

const views: Array<{ id: View; label: string; icon: string }> = [
  { id: "branches", label: "Branch List", icon: "account_tree" },
  { id: "router", label: "Router", icon: "route" },
  { id: "monitoring", label: "Monitoring", icon: "monitoring" },
  { id: "portfolio", label: "Portfolio", icon: "account_balance" },
  { id: "runDeepDive", label: "Runs", icon: "timeline" },
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

const modelRoleFields: Array<{
  label: string;
  key: KairosConfigModelRole;
}> = [
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

const informationToolFields: Array<{
  label: string;
  key: InformationConfigToolName;
  access: "free" | "premium" | "mixed";
  purpose: string;
}> = INFORMATION_TOOL_CATALOG.filter((tool) => {
  if (tool.name === "supermemory_search") return false;
  if (tool.provider === "finnhub") return tool.name === "finnhub_api_request";
  return true;
}).map((tool) => ({
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
  { label: "Deep Research", key: "exa_research" },
  { label: "Information Agent", key: "information" },
];

const allowedOrderTypeOptions: AllowedOrderType[] = ["market", "limit", "bracket"];
const dataPacketTypeOptions = ["ticker", "sector", "law", "branch", "source", "catalyst"] as const;

const defaultInformationToolPolicies = Object.fromEntries(
  [
    ...informationToolFields.map((tool) => [tool.key, { enabled: true }] as const),
    ["supermemory_search", { enabled: true }] as const,
  ],
) as NonNullable<WebBranchConfig["tools"]>["information"];

const defaultHeartbeatToolPolicies = Object.fromEntries(
  heartbeatToolFields.map((tool) => [tool.key, { enabled: true }]),
) as NonNullable<WebBranchConfig["tools"]>["heartbeat"];

const defaultDebateToolPolicies = Object.fromEntries(
  debateToolFields.map((tool) => [tool.key, { enabled: true }]),
) as NonNullable<WebBranchConfig["tools"]>["debate"];

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
  const [portfolioLoadState, setPortfolioLoadState] =
    useState<LoadState>("loading");
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot>();
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [tradeIntents, setTradeIntents] = useState<TradeIntentRecord[]>([]);
  const [routerChats, setRouterChats] = useState<RouterChatRecord[]>([]);
  const [selectedRouterChatId, setSelectedRouterChatId] = useState("");
  const [routerMessages, setRouterMessages] = useState<RouterMessageRecord[]>([]);
  const [routerLoadState, setRouterLoadState] = useState<LoadState>("loading");
  const [routerRunning, setRouterRunning] = useState(false);
  const [lastRouterHeartbeatRuns, setLastRouterHeartbeatRuns] = useState<RunRecord[]>([]);

  const selectedBranch =
    branches.find((branch) => branch.id === selectedBranchId) ?? branches[0];
  const selectedRun = runs.find((run) => run.id === selectedRunId);

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
        setSelectedRunId((current) =>
          current && apiRuns.some((run) => run.id === current) ? current : "",
        );
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

  useEffect(() => {
    if (view !== "portfolio") return;
    void refreshPortfolioData();
  }, [view]);

  useEffect(() => {
    if (view !== "router") return;
    void refreshRouterChats();
  }, [view]);

  useEffect(() => {
    if (!selectedRouterChatId || routerLoadState !== "api") {
      setRouterMessages([]);
      return;
    }

    let cancelled = false;
    getRouterMessages(selectedRouterChatId)
      .then((nextMessages) => {
        if (!cancelled) setRouterMessages(nextMessages);
      })
      .catch(() => {
        if (!cancelled) setRouterLoadState("offline");
      });

    return () => {
      cancelled = true;
    };
  }, [routerLoadState, selectedRouterChatId]);

  async function refreshRouterChats() {
    setRouterLoadState("loading");

    try {
      const chats = await getRouterChats();
      setRouterChats(chats);
      setSelectedRouterChatId((current) =>
        current && chats.some((chat) => chat.id === current)
          ? current
          : chats[0]?.id || "",
      );
      setRouterLoadState("api");
    } catch {
      setRouterLoadState("offline");
    }
  }

  async function startRouterChat() {
    try {
      const chat = await createRouterChat();
      setRouterChats((current) => [chat, ...current]);
      setSelectedRouterChatId(chat.id);
      setRouterMessages([]);
      setLastRouterHeartbeatRuns([]);
      setRouterLoadState("api");
    } catch {
      setRouterLoadState("offline");
    }
  }

  async function submitRouterMessage(text: string) {
    if (!selectedRouterChatId || !text.trim()) return;
    setRouterRunning(true);

    try {
      const result = await sendRouterMessage({
        chatId: selectedRouterChatId,
        text: text.trim(),
        dryRun: true,
      });
      setRouterMessages((current) => [
        ...current,
        result.userMessage,
        result.assistantMessage,
      ]);
      setRuns((current) => [
        result.run,
        ...result.heartbeatRuns,
        ...current.filter(
          (run) =>
            run.id !== result.run.id &&
            !result.heartbeatRuns.some((heartbeatRun) => heartbeatRun.id === run.id),
        ),
      ]);
      setSelectedRunId(result.run.id);
      setLastRouterHeartbeatRuns(result.heartbeatRuns);
      setRouterLoadState("api");
      setLoadState("api");
    } catch {
      setRouterLoadState("offline");
    } finally {
      setRouterRunning(false);
    }
  }

  async function refreshPortfolioData() {
    setPortfolioLoadState("loading");

    try {
      const [nextPortfolio, nextMessages, nextTradeIntents] = await Promise.all([
        getPortfolio(),
        getMessages(),
        getTradeIntents(),
      ]);
      setPortfolio(nextPortfolio);
      setMessages(nextMessages);
      setTradeIntents(nextTradeIntents);
      setPortfolioLoadState(nextPortfolio.status === "offline" ? "offline" : "api");
    } catch {
      setPortfolioLoadState("offline");
    }
  }

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
      config: WebBranchConfig;
      branchName: string;
      lawText: string;
    },
  ) {
    try {
      const currentBranch = branches.find((branch) => branch.id === branchId);
      const branch = await updateBranch(branchId, {
        name: input.branchName.trim() || currentBranch?.name || "Untitled Branch",
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

  async function createNewBranch() {
    try {
      const name = nextBranchName(branches);
      const branch = await createBranch({
        id: createBranchId(),
        name,
        description: "",
        enabled: true,
        law: { thesis: "" },
        config: defaultBranchConfig(),
      });
      setBranches((current) => [branch, ...current.filter((item) => item.id !== branch.id)]);
      setSelectedBranchId(branch.id);
      setView("config");
      setLoadState("api");
    } catch {
      setLoadState("offline");
    }
  }

  return (
    <div className="shell" data-theme={themeMode}>
      <SideNav
        setView={setView}
        themeMode={themeMode}
        view={view}
        onThemeModeChange={setThemeMode}
      />
      <div className="workspace">
        <TopBar />
        {view === "branches" && (
          <BranchList
            branches={branches}
            runs={runs}
            onCreate={() => void createNewBranch()}
            onSelect={(branch) => {
              setSelectedBranchId(branch.id);
              setView("config");
            }}
          />
        )}
        {view === "router" && (
          <RouterView
            branchCount={branches.length}
            chats={routerChats}
            heartbeatRuns={lastRouterHeartbeatRuns}
            loadState={routerLoadState}
            messages={routerMessages}
            running={routerRunning}
            selectedChatId={selectedRouterChatId}
            onNewChat={() => void startRouterChat()}
            onSelectChat={setSelectedRouterChatId}
            onSend={(text) => void submitRouterMessage(text)}
          />
        )}
        {view === "monitoring" && (
          <MonitoringView
            events={events}
            onInject={injectHumanContext}
            run={selectedRun}
          />
        )}
        {view === "portfolio" && (
          <PortfolioView
            loadState={portfolioLoadState}
            messages={messages}
            portfolio={portfolio}
            tradeIntents={tradeIntents}
            onRefresh={() => void refreshPortfolioData()}
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
            message="Choose a branch."
            title="No Branch Configuration"
          />
        )}
      </div>
    </div>
  );
}

function SideNav({
  themeMode,
  view,
  setView,
  onThemeModeChange,
}: {
  themeMode: ThemeMode;
  view: View;
  setView: (view: View) => void;
  onThemeModeChange: (mode: ThemeMode) => void;
}) {
  return (
    <nav className="side-nav">
      <div className="brand-block">
        <img
          alt="Kairos Command"
          className="brand-logo"
          src="/kairos-logo.png"
        />
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
        <small>Theme</small>
      </span>
    </button>
  );
}

function TopBar() {
  return (
    <header className="top-bar">
      <div className="status-cluster">
        <span className="top-status">STATUS: BRANCH_ACTIVE</span>
        <span className="status-light" />
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
    (sum, branch) => sum + getEscalations(branch, runs),
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
                  No branches yet. Create a branch to define the first law.
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
                    className={`right ${getEscalations(branch, runs) > 0 ? "danger-text" : ""}`}
                  >
                    {getEscalations(branch, runs)}
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

function RouterView({
  branchCount,
  chats,
  heartbeatRuns,
  loadState,
  messages,
  running,
  selectedChatId,
  onNewChat,
  onSelectChat,
  onSend,
}: {
  branchCount: number;
  chats: RouterChatRecord[];
  heartbeatRuns: RunRecord[];
  loadState: LoadState;
  messages: RouterMessageRecord[];
  running: boolean;
  selectedChatId: string;
  onNewChat: () => void;
  onSelectChat: (chatId: string) => void;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function submit() {
    if (!draft.trim() || running) return;
    onSend(draft);
    setDraft("");
  }

  return (
    <main className="router-canvas">
      <aside className="router-chat-list">
        <PaneHeader
          icon="route"
          meta={`${chats.length} CHATS`}
          title="ROUTER"
        />
        <button
          className="command-button primary router-new-chat"
          onClick={onNewChat}
          type="button"
        >
          <Icon name="add" /> NEW CHAT
        </button>
        <div className="run-list">
          {chats.length === 0 ? (
            <EmptyPanel
              icon="route"
              message="No chats yet."
              title="No Router Chats"
            />
          ) : (
            chats.map((chat) => (
              <button
                className={`run-list-item ${chat.id === selectedChatId ? "active" : ""}`}
                key={chat.id}
                onClick={() => onSelectChat(chat.id)}
                type="button"
              >
                <span>CHAT</span>
                <b>{chat.id}</b>
                <em>{timeOnly(chat.updatedAt)}</em>
              </button>
            ))
          )}
        </div>
      </aside>
      <section className="router-chat-pane">
        <div className="detail-head">
          <div>
            <h1>Router Agent</h1>
          </div>
          <span className={`source-pill ${loadState === "offline" ? "warning" : ""}`}>
            {loadState === "loading"
              ? "SYNCING"
              : loadState === "api"
                ? "ROUTER ONLINE"
                : "ROUTER OFFLINE"}
          </span>
        </div>
        {branchCount === 0 && (
          <div className="router-branch-warning">
            <Icon name="account_tree" />
            <span>
              No branches exist yet. The router can save this chat, but it cannot wake any heartbeat agents until a branch is created.
            </span>
          </div>
        )}
        <div className="router-transcript">
          {messages.length === 0 ? (
            <EmptyPanel
              icon="forum"
              message={
                branchCount === 0
                  ? "Messages will be recorded, but routing needs at least one branch."
                  : "No messages yet."
              }
              title="No Messages"
            />
          ) : (
            messages.map((message) => (
              <RouterMessageBubble message={message} key={message.id} />
            ))
          )}
        </div>
        <div className="router-composer">
          <textarea
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                submit();
              }
            }}
            placeholder="Paste a URL, note, filing excerpt, or source description..."
            value={draft}
          />
          <button
            className="command-button primary"
            disabled={!draft.trim() || running || !selectedChatId}
            onClick={submit}
            type="button"
          >
            <Icon name={running ? "hourglass_top" : "send"} />
            {running ? "ROUTING" : "SEND"}
          </button>
        </div>
      </section>
      <aside className="router-side pane">
        <PaneHeader
          icon="monitor_heart"
          meta={`${heartbeatRuns.length} RUNS`}
          title="HEARTBEATS"
        />
        <div className="portfolio-card-list">
          {heartbeatRuns.length === 0 ? (
            <EmptyPanel
              icon="monitor_heart"
              message="No heartbeat runs yet."
              title="No Runs"
            />
          ) : (
            heartbeatRuns.map((run) => (
              <article className="portfolio-card" key={run.id}>
                <div className="portfolio-card-head">
                  <b>{run.branchId ?? "UNASSIGNED"}</b>
                  <span>{run.status}</span>
                </div>
                <p>{readDisplay(run.output?.summary, "Heartbeat created.")}</p>
                <div className="portfolio-card-grid">
                  <span>{run.kind}</span>
                  <span>{timeOnly(run.createdAt)}</span>
                </div>
              </article>
            ))
          )}
        </div>
      </aside>
    </main>
  );
}

function RouterMessageBubble({ message }: { message: RouterMessageRecord }) {
  return (
    <article className={`router-message ${message.role}`}>
      <div className="router-message-head">
        <b>{message.role === "user" ? "YOU" : "ROUTER"}</b>
        <span>{timeOnly(message.createdAt)}</span>
      </div>
      <p>{message.text}</p>
    </article>
  );
}

function RouterToolCall({ call }: { call: RouterToolCallRecord }) {
  return (
    <details className={`router-tool-call ${call.status}`}>
      <summary>
        <span>
          <Icon name={toolCallIcon(call)} />
          {humanizeRouterToolName(call.name)}
        </span>
        <b>{call.status}</b>
      </summary>
      <p>{call.summary}</p>
      {(call.input || call.output || call.error) && (
        <pre>
          {JSON.stringify(
            {
              input: call.input,
              output: call.output,
              error: call.error,
            },
            null,
            2,
          )}
        </pre>
      )}
    </details>
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
          meta={run ? run.status.toUpperCase() : ""}
          title="EVENTS"
        />
        <div className="timeline-scroll">
          {events.length === 0 ? (
            <EmptyPanel
              icon="stream"
              message="No events yet."
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
          meta=""
          title="DEBATE"
        />
        <div className="transcript-scroll">
          {transcriptEvents.length === 0 ? (
            <EmptyPanel
              icon="forum"
              message="No transcript yet."
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

function PortfolioView({
  loadState,
  messages,
  portfolio,
  tradeIntents,
  onRefresh,
}: {
  loadState: LoadState;
  messages: MessageRecord[];
  portfolio?: PortfolioSnapshot;
  tradeIntents: TradeIntentRecord[];
  onRefresh: () => void;
}) {
  const account = portfolio?.account;
  const positions = portfolio?.positions ?? [];
  const orders = portfolio?.orders ?? [];

  return (
    <main className="portfolio-canvas">
      <section className="portfolio-main">
        <div className="detail-head">
          <div>
            <h1>Portfolio</h1>
          </div>
          <div className="button-row">
            <span className={`source-pill ${loadState === "offline" ? "warning" : ""}`}>
              {loadState === "loading"
                ? "SYNCING"
                : loadState === "api"
                  ? "PAPER ONLINE"
                  : "PORTFOLIO OFFLINE"}
            </span>
            <button className="command-button" onClick={onRefresh} type="button">
              <Icon name="refresh" /> REFRESH
            </button>
          </div>
        </div>
        <div className="portfolio-scroll">
          <div className="portfolio-safety-strip">
            <Icon name="verified_user" />
            <div>
              <b>Paper trading only</b>
              <span>Live orders unavailable.</span>
            </div>
          </div>
          <div className="portfolio-metrics">
            <Metric
              label="PORTFOLIO VALUE"
              value={formatMoneyField(account, "portfolio_value", "portfolioValue")}
            />
            <Metric label="EQUITY" value={formatMoneyField(account, "equity")} />
            <Metric
              label="BUYING POWER"
              value={formatMoneyField(account, "buying_power", "buyingPower")}
            />
            <Metric label="CASH" value={formatMoneyField(account, "cash")} />
            <Metric
              label="OPEN ORDERS"
              value={orders.length.toString()}
              alert={orders.some((order) => isUnresolvedStatus(order.status))}
            />
            <Metric
              label="TRADE INTENTS"
              value={tradeIntents.length.toString()}
              alert={tradeIntents.some((intent) => isUnresolvedStatus(intent.status))}
            />
          </div>
          <PortfolioTable
            columns={["SYMBOL", "QTY", "MARKET VALUE", "UNREALIZED P/L", "SIDE"]}
            emptyMessage="No paper positions."
            rows={positions.map((position) => [
              readDisplay(position.symbol),
              readDisplay(position.qty),
              formatMoneyField(position, "market_value", "marketValue"),
              formatMoneyField(position, "unrealized_pl", "unrealizedPl"),
              readDisplay(position.side),
            ])}
            title="PAPER POSITIONS"
          />
          <PortfolioTable
            columns={["SYMBOL", "SIDE", "TYPE", "STATUS", "NOTIONAL", "SUBMITTED"]}
            emptyMessage="No paper orders."
            rows={orders.map((order) => [
              readDisplay(order.symbol),
              readDisplay(order.side),
              readDisplay(order.type ?? order.order_type ?? order.orderType),
              readDisplay(order.status),
              formatMoneyValue(order.notional ?? order.filled_notional ?? order.filledNotional),
              formatTimestamp(order.submitted_at ?? order.submittedAt ?? order.createdAt ?? order.created_at),
            ])}
            title="PAPER ORDERS"
          />
        </div>
      </section>
      <aside className="portfolio-side">
        <PaneHeader
          icon="receipt_long"
          meta={`${tradeIntents.length} INTENTS`}
          title="TRADE INTENTS"
        />
        <div className="portfolio-card-list">
          {tradeIntents.length === 0 ? (
            <EmptyPanel
              icon="receipt_long"
              message="No trade intents yet."
              title="No Trade Intents"
            />
          ) : (
            tradeIntents.map((intent, index) => (
              <TradeIntentCard intent={intent} key={intent.id ?? index} />
            ))
          )}
        </div>
        <PaneHeader
          icon="mark_unread_chat_alt"
          meta={`${messages.length} MESSAGES`}
          title="MESSAGES"
        />
        <div className="portfolio-card-list messages">
          {messages.length === 0 ? (
            <EmptyPanel
              icon="mark_unread_chat_alt"
              message="No messages yet."
              title="No Messages"
            />
          ) : (
            messages.map((message, index) => (
              <MessageCard message={message} key={message.id ?? index} />
            ))
          )}
        </div>
      </aside>
    </main>
  );
}

function PortfolioTable({
  columns,
  emptyMessage,
  rows,
  title,
}: {
  columns: string[];
  emptyMessage: string;
  rows: string[][];
  title: string;
}) {
  return (
    <section className="portfolio-section">
      <div className="section-title">{title}</div>
      <div className="data-panel compact-panel">
        <table className="branch-table portfolio-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="empty-table-cell" colSpan={columns.length}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => (
                <tr key={`${title}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${title}-${rowIndex}-${cellIndex}`}>{cell}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TradeIntentCard({ intent }: { intent: TradeIntentRecord }) {
  return (
    <article className="portfolio-card">
      <div className="portfolio-card-head">
        <b>{readDisplay(intent.symbol, "UNKNOWN")}</b>
        <span>{readDisplay(intent.status, "pending")}</span>
      </div>
      <p>{readDisplay(intent.summary ?? intent.rationale ?? intent.reasoning, "No rationale supplied.")}</p>
      <div className="portfolio-card-grid">
        <span>{readDisplay(intent.side, "side")}</span>
        <span>{readDisplay(intent.orderType, "order")}</span>
        <span>{formatMoneyValue(intent.notional)}</span>
        <span>{formatConfidenceValue(intent.confidence)}</span>
      </div>
    </article>
  );
}

function MessageCard({ message }: { message: MessageRecord }) {
  return (
    <article className="portfolio-card message-card">
      <div className="portfolio-card-head">
        <b>{readDisplay(message.title ?? message.type ?? message.level, "MESSAGE")}</b>
        <span>{formatTimestamp(message.timestamp ?? message.createdAt)}</span>
      </div>
      <p>{readDisplay(message.summary ?? message.message ?? message.body, "No message body supplied.")}</p>
    </article>
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
          title="RUNS"
        />
        <div className="run-list">
          {runs.length === 0 ? (
            <EmptyPanel
              icon="history"
              message="No runs yet."
              title="No Runs"
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
            <h1>{selectedRun ? selectedRun.id : "Runs"}</h1>
            <p>
              {selectedRun
                ? `${selectedRun.kind.toUpperCase()} | ${selectedRun.status} | ${selectedBranch?.name ?? "No branch"}`
                : "Choose a run."}
            </p>
          </div>
        </div>
        {!selectedRun ? (
          <EmptyPanel
            icon="timeline"
            message="Choose a run."
            title="No Run Selected"
          />
        ) : (
          <div className="run-deep-grid">
            <section className="trace-section">
              <div className="section-title">INPUT</div>
              <pre className="json-block">
                {JSON.stringify(selectedRun.input, null, 2)}
              </pre>
            </section>
            <section className="trace-section">
              <div className="section-title">OUTPUT</div>
              <pre className="json-block">
                {JSON.stringify(selectedRun.output ?? {}, null, 2)}
              </pre>
            </section>
            <section className="trace-section full">
              <div className="section-title">EVENTS</div>
              {events.length === 0 ? (
                <EmptyPanel
                  icon="stream"
                  message="No events yet."
                  title="No Events"
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
    <div className="run-mode-switch">
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
    config: WebBranchConfig;
    branchName: string;
    lawText: string;
  }) => void;
}) {
  const [config, setConfig] = useState<WebBranchConfig>(() =>
    normalizeBranchConfig(branch),
  );
  const [branchName, setBranchName] = useState(branch.name);
  const [lawText, setLawText] = useState(readLawText(branch));

  useEffect(() => {
    setConfig(normalizeBranchConfig(branch));
    setBranchName(branch.name);
    setLawText(readLawText(branch));
  }, [branch.id, branch.name, branch.config, branch.description, branch.law]);

  const heartbeatInterval = config.heartbeat?.intervalMinutes ?? 5;
  const seedWindowDays = config.heartbeat?.seedWindowDays ?? 30;
  const heartbeatMaxToolSteps = config.heartbeat?.maxToolSteps ?? 3;
  const debateMaxTurns = config.budgets?.debateMaxTurns ?? 6;
  const debateMaxToolCalls = config.budgets?.debateMaxToolCalls ?? 3;
  const informationMaxToolCalls = config.budgets?.informationMaxToolCalls ?? 5;
  const branchAssets = config.assets ?? [];
  const tradingConfig = config.trading ?? {};
  const tradingMode = tradingConfig.mode ?? "disabled";
  const paperAutoBuyEnabled = tradingConfig.paperAutoBuyEnabled ?? false;
  const notifyOnBuySignal = tradingConfig.notifyOnBuySignal ?? true;
  const tradeSymbol = tradingConfig.symbol ?? branchAssets[0] ?? "";
  const maxNotionalPerOrder = tradingConfig.maxNotionalPerOrder ?? 500;
  const maxOpenPositionNotionalPerSymbol =
    tradingConfig.maxOpenPositionNotionalPerSymbol ?? 1_500;
  const allowedOrderType = tradingConfig.allowedOrderType ?? "market";
  const dataPacketType = config.research?.dataPacketType ?? "ticker";
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
        <div>
          <h1>Branch Configuration</h1>
        </div>
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
              setBranchName(branch.name);
              setLawText(readLawText(branch));
            }}
            type="button"
          >
            DISCARD
          </button>
          <button
            className="command-button primary"
            onClick={() => onSave({ branchName, config, lawText })}
            type="button"
          >
            SAVE CONFIGURATION
          </button>
        </div>
      </div>
      <div className="config-body">
        <FieldLabel label="Branch Name">
          <input
            onChange={(event) => setBranchName(event.target.value)}
            placeholder="Name this monitoring branch."
            value={branchName}
          />
        </FieldLabel>
        <FieldLabel label="The Law (Primary Thesis)">
          <textarea
            onChange={(event) => setLawText(event.target.value)}
            placeholder="Describe what this branch watches, what counts as signal, and what should be ignored."
            value={lawText}
          />
        </FieldLabel>
        <FieldLabel label="Tracked Tickers">
          <input
            onChange={(event) => {
              const assets = parseAssetList(event.target.value);
              setConfig((current) => ({
                ...current,
                assets,
                trading: {
                  ...current.trading,
                  symbol: current.trading?.symbol || assets[0] || undefined,
                },
              }));
            }}
            placeholder="PLTR, NVDA, CRWV"
            value={branchAssets.join(", ")}
          />
        </FieldLabel>
        <div>
          <div className="field-label">AGENT SYSTEM PROMPTS</div>
          <div className="prompt-grid">
            {promptFields.map((field) => (
              <FieldLabel label={field.role} key={field.key}>
                <textarea
                  className="prompt-area"
                  rows={5}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      prompts: {
                        ...current.prompts,
                        [field.key]: event.target.value,
                      },
                    }))
                  }
                  placeholder=""
                  value={config.prompts?.[field.key] ?? field.defaultText}
                />
              </FieldLabel>
            ))}
          </div>
        </div>
        <section className={`trading-panel ${paperAutoBuyEnabled ? "auto-buy" : ""}`}>
          <div className="trading-panel-head">
            <div>
              <div className="field-label">PAPER TRADING CONTROLS</div>
              <h2>
                {tradingMode === "paper"
                  ? "Paper trading enabled"
                  : "Trading disabled"}
              </h2>
            </div>
          </div>
          <div className="trading-grid">
            <FieldLabel label="Trade Symbol">
              <input
                list={`branch-assets-${branch.id}`}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    trading: {
                      ...current.trading,
                      symbol: normalizeTickerInput(event.target.value) || undefined,
                    },
                  }))
                }
                placeholder="Pick a tracked ticker"
                value={tradeSymbol}
              />
              <datalist id={`branch-assets-${branch.id}`}>
                {branchAssets.map((asset) => (
                  <option key={asset} value={asset} />
                ))}
              </datalist>
            </FieldLabel>
            <label className="checkbox-card">
              <input
                checked={tradingMode === "paper"}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    trading: {
                      ...current.trading,
                      mode: event.target.checked ? "paper" : "disabled",
                      paperAutoBuyEnabled: event.target.checked
                        ? current.trading?.paperAutoBuyEnabled ?? false
                        : false,
                    },
                  }))
                }
                type="checkbox"
              />
              <span>
                <b>Paper trading enabled</b>
              </span>
            </label>
            <label className="checkbox-card">
              <input
                checked={paperAutoBuyEnabled}
                disabled={tradingMode !== "paper"}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    trading: {
                      ...current.trading,
                      paperAutoBuyEnabled: event.target.checked,
                      mode: event.target.checked ? "paper" : current.trading?.mode ?? "disabled",
                    },
                  }))
                }
                type="checkbox"
              />
              <span>
                <b>Submit paper orders automatically</b>
              </span>
            </label>
            <label className="checkbox-card">
              <input
                checked={notifyOnBuySignal}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    trading: {
                      ...current.trading,
                      notifyOnBuySignal: event.target.checked,
                    },
                  }))
                }
                type="checkbox"
              />
              <span>
                <b>Notify on buy signal</b>
              </span>
            </label>
            <FieldLabel label="Max Notional Per Order">
              <input
                min="0"
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    trading: {
                      ...current.trading,
                      maxNotionalPerOrder: Number(event.target.value),
                    },
                  }))
                }
                type="number"
                value={maxNotionalPerOrder}
              />
            </FieldLabel>
            <FieldLabel label="Max Open Position Notional Per Symbol">
              <input
                min="0"
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    trading: {
                      ...current.trading,
                      maxOpenPositionNotionalPerSymbol: Number(event.target.value),
                    },
                  }))
                }
                type="number"
                value={maxOpenPositionNotionalPerSymbol}
              />
            </FieldLabel>
            <FieldLabel label="Allowed Order Type">
              <select
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    trading: {
                      ...current.trading,
                      allowedOrderType: event.target.value as AllowedOrderType,
                    },
                  }))
                }
                value={allowedOrderType}
              >
                {allowedOrderTypeOptions.map((orderType) => (
                  <option key={orderType} value={orderType}>
                    {orderType.toUpperCase()}
                  </option>
                ))}
              </select>
            </FieldLabel>
            <div className="threshold-inline">
              <Slider
                label="Buy Signal Threshold"
                onChange={(value) =>
                  setConfig((current) => ({
                    ...current,
                    thresholds: {
                      ...current.thresholds,
                      buyConfidence: value / 100,
                      paperTradeDraftConfidence: value / 100,
                    },
                  }))
                }
                value={`${paperTradeDraftConfidence}%`}
              />
            </div>
          </div>
        </section>
        <div>
          <div className="field-label">MODEL ROLE CONFIGURATION</div>
          <div className="model-grid">
            {modelRoleFields.map((field) => (
              <div className="model-row" key={field.key}>
                <span>
                  <b>{field.label}</b>
                </span>
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
                  placeholder="Model"
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
          {openRouterModels.length === 0 && (
            <p className="config-note">
              Model list unavailable.
            </p>
          )}
        </div>
        <div className="config-grid">
          <FieldLabel label="Information Agent Tools">
            <div className="tool-picker">
              {informationToolFields.map((tool) => (
                <label key={tool.key}>
                  <input
                    checked={config.tools?.information?.[tool.key]?.enabled ?? true}
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
                  <span>{toolAccessLabel(tool)}</span>
                  <input
                    checked={config.tools?.information?.[tool.key]?.required ?? false}
                    disabled={config.tools?.information?.[tool.key]?.enabled === false}
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
              ))}
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
          <FieldLabel label="Data Packet Type">
            <select
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  research: {
                    ...current.research,
                    dataPacketType: event.target.value as typeof dataPacketTypeOptions[number],
                  },
                }))
              }
              value={dataPacketType}
            >
              {dataPacketTypeOptions.map((type) => (
                <option key={type} value={type}>
                  {titleize(type)}
                </option>
              ))}
            </select>
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
              placeholder="Ticker or sector"
              value={config.research?.dataPacket ?? ""}
            />
          </FieldLabel>
        </div>
        <FieldLabel label="Search & Deep Research Instruction">
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
            placeholder="Research notes for this branch."
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
              label="Buy Signal Threshold"
              onChange={(value) =>
                setConfig((current) => ({
                  ...current,
                  thresholds: {
                    ...current.thresholds,
                    buyConfidence: value / 100,
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
  const snapshot = selectedEvidence?.payload;

  return (
    <section className="evidence pane medium">
      <PaneHeader icon="database" title="EVIDENCE" meta="" actionIcon="close" />
      <div className="evidence-scroll">
        {!snapshot ? (
          <EmptyPanel
            icon="database"
            title="No Evidence"
            message="No evidence yet."
          />
        ) : (
          <>
            <div className="source-card">
              <div className="field-label">SOURCE</div>
              <h1>{selectedEvidence?.id ?? run?.id ?? "RUN PAYLOAD"}</h1>
              <div className="source-tags">
                <span>{selectedEvidence?.type ?? run?.kind ?? "record"}</span>
                <span>{run?.status ?? "loaded"}</span>
              </div>
            </div>
            <div className="field-label">DETAILS</div>
            <pre className="json-block">{JSON.stringify(snapshot, null, 2)}</pre>
            <div className="field-label">TIMELINE</div>
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
      <FieldLabel label="Buy Signal Threshold">
        <input
          readOnly
          value={formatConfidence(
            thresholds?.paperTradeDraftConfidence ?? thresholds?.buyConfidence,
          )}
        />
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
          message="No escalations yet."
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

function createBranchId(): string {
  return `branch_${Date.now().toString(36)}`;
}

function nextBranchName(branches: BranchRecord[]): string {
  const existingNames = new Set(branches.map((branch) => branch.name));
  let index = branches.length + 1;
  let name = `Untitled Branch ${index}`;

  while (existingNames.has(name)) {
    index += 1;
    name = `Untitled Branch ${index}`;
  }

  return name;
}

function defaultBranchConfig(): WebBranchConfig {
  return {
    assets: [],
    heartbeat: {
      intervalMinutes: 5,
      seedWindowDays: 30,
      maxToolSteps: 3,
    },
    prompts: {
      heartbeatSystemPrompt: HEARTBEAT_SYSTEM_PROMPT,
      debateJudgeSystemPrompt: JUDGE_SYSTEM_PROMPT,
      debateBullSystemPrompt: BULL_SYSTEM_PROMPT,
      debateBearSystemPrompt: BEAR_SYSTEM_PROMPT,
    },
    tools: {
      heartbeat: defaultHeartbeatToolPolicies,
      debate: defaultDebateToolPolicies,
      information: defaultInformationToolPolicies,
      finnhubPremiumAccess: false,
    },
    budgets: {
      debateMaxTurns: 6,
      debateMaxToolCalls: 3,
      informationMaxToolCalls: 5,
    },
    thresholds: {
      notifyConfidence: 0.75,
      paperTradeDraftConfidence: 0.9,
    },
    trading: {
      mode: "disabled",
      paperAutoBuyEnabled: false,
      notifyOnBuySignal: true,
      maxNotionalPerOrder: 500,
      maxOpenPositionNotionalPerSymbol: 1_500,
      allowedOrderType: "market",
    },
    research: {},
  };
}

function normalizeBranchConfig(branch: BranchRecord): WebBranchConfig {
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
    trading: {
      mode: "disabled",
      paperAutoBuyEnabled: false,
      notifyOnBuySignal: true,
      maxNotionalPerOrder: 500,
      maxOpenPositionNotionalPerSymbol: 1_500,
      allowedOrderType: "market",
      ...config.trading,
    },
    research: {
      ...config.research,
    },
  };
}

function withFinnhubPremiumAccess(
  config: WebBranchConfig,
  enabled: boolean,
): WebBranchConfig {
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

function humanizeRouterToolName(toolName: string): string {
  return toolName
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toolCallIcon(call: RouterToolCallRecord): string {
  if (call.status === "failed") return "error";
  if (call.name.includes("heartbeat")) return "monitor_heart";
  if (call.name.includes("inventory")) return "account_tree";
  if (call.name.includes("exa")) return "travel_explore";
  return "build";
}

function readStoredThemeMode(): ThemeMode {
  return localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
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

function getEscalations(branch: BranchRecord, runs: RunRecord[]) {
  return runs.filter(
    (run) => run.branchId === branch.id && run.kind === "debate",
  ).length;
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

function formatConfidenceValue(value: unknown) {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : undefined;

  return typeof numberValue === "number" && Number.isFinite(numberValue)
    ? `${Math.round(numberValue * 100)}%`
    : "-";
}

function formatMoneyField(record: JsonRecord | undefined, ...keys: string[]) {
  return formatMoneyValue(keys.map((key) => record?.[key]).find((value) => value !== undefined));
}

function formatMoneyValue(value: unknown) {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : undefined;

  return typeof numberValue === "number" && Number.isFinite(numberValue)
    ? new Intl.NumberFormat("en-US", {
        currency: "USD",
        maximumFractionDigits: 2,
        style: "currency",
      }).format(numberValue)
    : "-";
}

function formatTimestamp(value: unknown) {
  return typeof value === "string" && value.length > 0 ? timeOnly(value) : "-";
}

function readDisplay(value: unknown, fallback = "-") {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function isUnresolvedStatus(value: unknown) {
  if (typeof value !== "string") return false;
  return !["filled", "canceled", "cancelled", "closed", "complete", "completed"].includes(
    value.toLowerCase(),
  );
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
