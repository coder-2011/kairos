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
  deleteBranch,
  getBranches,
  getMessages,
  getOpenRouterModels,
  getPortfolio,
  getRunEvents,
  getRuns,
  getRouterChats,
  getRouterMessages,
  getTradeSymbols,
  getTradeIntents,
  KairosApiError,
  triggerHeartbeat,
  sendRouterMessage,
  updateBranch,
  type AllowedOrderType,
  type BranchRecord,
  type JsonRecord,
  type MessageRecord,
  type ModelRoleDefaults,
  type OpenRouterModelRecord,
  type PortfolioSnapshot,
  type RunEventRecord,
  type RunRecord,
  type RouterChatRecord,
  type RouterMessageRecord,
  type RouterToolCallRecord,
  type TradeIntentRecord,
  type TradeSymbolRecord,
  type WebBranchConfig,
} from "./api";

type View = "branches" | "router" | "monitoring" | "portfolio" | "runDeepDive" | "config";
type LoadState = "loading" | "api" | "offline";
type ThemeMode = "light" | "dark";
type PromptConfigKey = keyof NonNullable<WebBranchConfig["prompts"]>;

const THEME_STORAGE_KEY = "kairos-theme-v2";
const starterTradeSymbols: TradeSymbolRecord[] = [
  { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "MSFT", name: "Microsoft Corporation", exchange: "NASDAQ", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "NVDA", name: "NVIDIA Corporation", exchange: "NASDAQ", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "PLTR", name: "Palantir Technologies Inc.", exchange: "NASDAQ", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "CRWV", name: "CoreWeave, Inc.", exchange: "NASDAQ", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "AMD", name: "Advanced Micro Devices, Inc.", exchange: "NASDAQ", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "AVGO", name: "Broadcom Inc.", exchange: "NASDAQ", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "TSLA", name: "Tesla, Inc.", exchange: "NASDAQ", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "AMZN", name: "Amazon.com, Inc.", exchange: "NASDAQ", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "GOOGL", name: "Alphabet Inc.", exchange: "NASDAQ", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "META", name: "Meta Platforms, Inc.", exchange: "NASDAQ", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "COIN", name: "Coinbase Global, Inc.", exchange: "NASDAQ", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "MSTR", name: "Strategy Inc.", exchange: "NASDAQ", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "HOOD", name: "Robinhood Markets, Inc.", exchange: "NASDAQ", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "SOFI", name: "SoFi Technologies, Inc.", exchange: "NASDAQ", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "TSM", name: "Taiwan Semiconductor Manufacturing Company Limited", exchange: "NYSE", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "SMCI", name: "Super Micro Computer, Inc.", exchange: "NASDAQ", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "JPM", name: "JPMorgan Chase & Co.", exchange: "NYSE", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", exchange: "NYSEARCA", assetClass: "us_equity", tradable: true, source: "fallback" },
  { symbol: "QQQ", name: "Invesco QQQ Trust", exchange: "NASDAQ", assetClass: "us_equity", tradable: true, source: "fallback" },
];

type AppRoute = {
  view: View;
  branchId?: string;
  runId?: string;
};

function readRouteFromHash(): AppRoute {
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  const [viewSegment, idSegment] = hash.replace(/^#\/?/, "").split("/");
  const view = routeViews.includes(viewSegment as View)
    ? (viewSegment as View)
    : "branches";

  return {
    view,
    branchId: view === "config" ? idSegment : undefined,
    runId: view === "monitoring" || view === "runDeepDive" ? idSegment : undefined,
  };
}

function routeHash(route: AppRoute): string {
  if (route.view === "config" && route.branchId) {
    return `#/config/${encodeURIComponent(route.branchId)}`;
  }
  if ((route.view === "monitoring" || route.view === "runDeepDive") && route.runId) {
    return `#/${route.view}/${encodeURIComponent(route.runId)}`;
  }
  return `#/${route.view}`;
}

const routeViews: View[] = ["branches", "router", "monitoring", "portfolio", "runDeepDive", "config"];

const views: Array<{ id: Exclude<View, "config">; label: string; icon: string }> = [
  { id: "branches", label: "Branch List", icon: "account_tree" },
  { id: "router", label: "Router", icon: "route" },
  { id: "monitoring", label: "Monitoring", icon: "monitoring" },
  { id: "portfolio", label: "Portfolio", icon: "account_balance" },
  { id: "runDeepDive", label: "Runs", icon: "timeline" },
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

const allowedOrderTypeOptions: AllowedOrderType[] = ["market", "limit"];

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
  const initialRoute = readRouteFromHash();
  const [view, setView] = useState<View>(initialRoute.view);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [events, setEvents] = useState<RunEventRecord[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selectedBranchId, setSelectedBranchId] = useState(initialRoute.branchId ?? "");
  const [selectedRunId, setSelectedRunId] = useState(initialRoute.runId ?? "");
  const [openRouterModels, setOpenRouterModels] = useState<OpenRouterModelRecord[]>([]);
  const [modelDefaults, setModelDefaults] = useState<ModelRoleDefaults>({});
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readStoredThemeMode());
  const [portfolioLoadState, setPortfolioLoadState] =
    useState<LoadState>("loading");
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot>();
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [tradeIntents, setTradeIntents] = useState<TradeIntentRecord[]>([]);
  const [tradeSymbols, setTradeSymbols] = useState<TradeSymbolRecord[]>(starterTradeSymbols);
  const [tradeSymbolLoadState, setTradeSymbolLoadState] =
    useState<LoadState>("loading");
  const [routerChats, setRouterChats] = useState<RouterChatRecord[]>([]);
  const [selectedRouterChatId, setSelectedRouterChatId] = useState("");
  const [routerMessages, setRouterMessages] = useState<RouterMessageRecord[]>([]);
  const [routerLoadState, setRouterLoadState] = useState<LoadState>("loading");
  const [routerRunning, setRouterRunning] = useState(false);
  const [lastRouterHeartbeatRuns, setLastRouterHeartbeatRuns] = useState<RunRecord[]>([]);

  const selectedBranch =
    branches.find((branch) => branch.id === selectedBranchId) ?? branches[0];
  const selectedRun = runs.find((run) => run.id === selectedRunId);

  function navigate(nextView: View, options: { branchId?: string; runId?: string } = {}) {
    setView(nextView);
    if (options.branchId) setSelectedBranchId(options.branchId);
    if (options.runId) setSelectedRunId(options.runId);

    const nextHash = routeHash({
      view: nextView,
      branchId: options.branchId,
      runId: options.runId,
    });
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, "", nextHash);
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    function applyRoute() {
      const route = readRouteFromHash();
      setView(route.view);
      if (route.branchId) setSelectedBranchId(route.branchId);
      if (route.runId) setSelectedRunId(route.runId);
    }

    window.addEventListener("hashchange", applyRoute);
    window.addEventListener("popstate", applyRoute);
    return () => {
      window.removeEventListener("hashchange", applyRoute);
      window.removeEventListener("popstate", applyRoute);
    };
  }, []);

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
        const route = readRouteFromHash();
        setSelectedBranchId(
          route.branchId && apiBranches.some((branch) => branch.id === route.branchId)
            ? route.branchId
            : apiBranches[0]?.id ?? "",
        );
        setSelectedRunId((current) => {
          const routeRunId = route.runId && apiRuns.some((run) => run.id === route.runId)
            ? route.runId
            : undefined;
          if (routeRunId) return routeRunId;
          return current && apiRuns.some((run) => run.id === current) ? current : "";
        });
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
      .then((response) => {
        if (!cancelled) {
          setOpenRouterModels(response.models);
          setModelDefaults(response.defaults);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOpenRouterModels([]);
          setModelDefaults({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setTradeSymbolLoadState("loading");
    getTradeSymbols({ limit: 500 })
      .then((symbols) => {
        if (!cancelled) {
          setTradeSymbols(mergeTradeSymbolRecords(starterTradeSymbols, symbols));
          setTradeSymbolLoadState("api");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTradeSymbols(starterTradeSymbols);
          setTradeSymbolLoadState("offline");
        }
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
      });
      setRouterChats((current) =>
        current.map((chat) =>
          chat.id === selectedRouterChatId
            ? {
                ...chat,
                title: result.chat?.title ?? chat.title ?? buildChatTitle(text.trim()),
                updatedAt: result.userMessage.createdAt,
              }
            : chat,
        ),
      );
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
      );
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setSelectedRunId(run.id);
      navigate("monitoring", { runId: run.id });
      setLoadState("api");
    } catch (error) {
      const failedRun = getRunFromApiError(error);
      if (failedRun) {
        setRuns((current) => [
          failedRun,
          ...current.filter((item) => item.id !== failedRun.id),
        ]);
        setSelectedRunId(failedRun.id);
        navigate("monitoring", { runId: failedRun.id });
        setLoadState("api");
        return;
      }
      navigate("monitoring");
      setLoadState("offline");
    }
  }

  async function startDebate(branchId: string, escalation?: JsonRecord) {
    try {
      const run = await createDebate({
        branchId,
        escalation,
      });
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setSelectedRunId(run.id);
      navigate("monitoring", { runId: run.id });
      setLoadState("api");
    } catch {
      navigate("monitoring");
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
      navigate("config", { branchId: branch.id });
      setLoadState("api");
    } catch {
      setLoadState("offline");
    }
  }

  async function discardBranch(branchId: string) {
    const branch = branches.find((item) => item.id === branchId);
    const confirmed = window.confirm(
      `Discard branch "${branch?.name ?? branchId}"? This removes the branch configuration.`,
    );
    if (!confirmed) return;

    try {
      await deleteBranch(branchId);
      const nextBranches = await getBranches();
      setBranches(nextBranches);
      setSelectedBranchId(nextBranches[0]?.id ?? "");
      navigate("branches");
      setLoadState("api");
    } catch {
      setLoadState("offline");
    }
  }

  return (
    <div className="shell" data-theme={themeMode}>
      <SideNav
        setView={(nextView) => navigate(nextView)}
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
              navigate("config", { branchId: branch.id });
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
            onStartDebateFromEscalation={(branchId, escalation) =>
              void startDebate(branchId, escalation)
            }
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
            onSelectRun={(runId) => navigate("runDeepDive", { runId })}
            runs={runs}
            selectedRun={selectedRun}
          />
        )}
        {view === "config" && selectedBranch && (
          <BranchConfig
            branch={selectedBranch}
            modelDefaults={modelDefaults}
            openRouterModels={openRouterModels}
            tradeSymbolLoadState={tradeSymbolLoadState}
            tradeSymbols={tradeSymbols}
            onEscalate={() => void startDebate(selectedBranch.id)}
            onDiscard={() => void discardBranch(selectedBranch.id)}
            onRunHeartbeat={() => void runHeartbeat(selectedBranch.id)}
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
          src="/kairos-logo.svg"
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
  return <header className="top-bar" />;
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
              <th>HEARTBEAT</th>
              <th>LAST RUN</th>
              <th className="right">ESCALATIONS</th>
            </tr>
          </thead>
          <tbody>
            {branches.length === 0 ? (
              <tr>
                <td className="empty-table-cell" colSpan={5}>
                  No branches yet. Create a branch to define the first law.
                </td>
              </tr>
            ) : (
              branches.map((branch) => (
                <tr key={branch.id} onClick={() => onSelect(branch)}>
                  <td>{branch.id}</td>
                  <td className="muted truncate-cell">{branch.name}</td>
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
                <b>{chatDisplayTitle(chat)}</b>
                <em>{formatChatTimestamp(chat.updatedAt)}</em>
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
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
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
        <span>{formatChatTimestamp(message.createdAt)}</span>
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
  onStartDebateFromEscalation,
  run,
  onInject,
}: {
  events: RunEventRecord[];
  run?: RunRecord;
  onStartDebateFromEscalation: (branchId: string, escalation: JsonRecord) => void;
  onInject: (message: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [showEvidence, setShowEvidence] = useState(true);
  const heartbeatEscalation = getHeartbeatEscalation(run);
  const transcriptEvents = events.filter(
    (event) => event.type.startsWith("debate.") || event.type.startsWith("human."),
  );

  return (
    <main className={`split-canvas ${showEvidence ? "" : "evidence-closed"}`}>
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
          actionIcon={showEvidence ? undefined : "database"}
          actionIconLabel="Show evidence"
          onActionIconClick={() => setShowEvidence(true)}
          icon="forum"
          meta=""
          title="DEBATE"
        />
        <div className="transcript-scroll">
          {run?.kind === "heartbeat" && (
            <HeartbeatHandoffPanel
              escalation={heartbeatEscalation}
              run={run}
              onStartDebate={onStartDebateFromEscalation}
            />
          )}
          {transcriptEvents.length === 0 ? (
            <EmptyPanel
              icon="forum"
              message={
                run?.kind === "heartbeat"
                  ? "Heartbeat results appear here first. If it escalates, start the debate from the heartbeat packet."
                  : "No transcript yet."
              }
              title={run?.kind === "heartbeat" ? "No Debate Started" : "No Debate Transcript"}
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
      {showEvidence && (
        <EvidencePane
          events={events}
          onClose={() => setShowEvidence(false)}
          run={run}
        />
      )}
    </main>
  );
}

function HeartbeatHandoffPanel({
  escalation,
  run,
  onStartDebate,
}: {
  escalation?: JsonRecord;
  run: RunRecord;
  onStartDebate: (branchId: string, escalation: JsonRecord) => void;
}) {
  const decision = readDisplay(run.output?.decision, "unknown");
  const branchId = readDisplay(run.branchId, "");
  const canStartDebate = Boolean(escalation && branchId);

  return (
    <article className={`heartbeat-handoff ${canStartDebate ? "escalated" : ""}`}>
      <div>
        <span>
          <Icon name={canStartDebate ? "alt_route" : "monitor_heart"} />
          HEARTBEAT RESULT
        </span>
        <b>{decision}</b>
      </div>
      <p>{readDisplay(run.output?.summary, "Heartbeat completed without a summary.")}</p>
      {escalation && branchId ? (
        <button
          className="command-button primary"
          onClick={() => {
            if (escalation) onStartDebate(branchId, escalation);
          }}
          type="button"
        >
          <Icon name="forum" /> START DEBATE FROM HEARTBEAT
        </button>
      ) : (
        <small>
          No escalation packet was produced, so this heartbeat does not have a
          debate handoff.
        </small>
      )}
    </article>
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
  const selectedRunSummary = selectedRun
    ? summarizeRun(selectedRun, selectedBranch)
    : undefined;

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
              <RunListItem
                branchName={selectedBranchName(branches, run.branchId)}
                key={run.id}
                onSelect={() => onSelectRun(run.id)}
                run={run}
                selected={run.id === selectedRun?.id}
              />
            ))
          )}
        </div>
      </section>
      <section className="run-trace-pane">
        <div className="detail-head">
          <div>
            <h1>{selectedRun ? selectedRunSummary?.title : "Runs"}</h1>
            <p>
              {selectedRun
                ? selectedRunSummary?.subtitle
                : "Choose a run."}
            </p>
          </div>
        </div>
        {!selectedRun || !selectedRunSummary ? (
          <EmptyPanel
            icon="timeline"
            message="Choose a run."
            title="No Run Selected"
          />
        ) : (
          <div className="run-deep-grid">
            <section className="trace-section full">
              <div className="section-title">RUN SUMMARY</div>
              <div className="run-summary-grid">
                <RunFact label="Status" tone={selectedRun.status === "failed" ? "danger" : "default"} value={selectedRun.status} />
                <RunFact label="Kind" value={selectedRun.kind} />
                <RunFact label="Branch" value={selectedRunSummary.branchLabel} />
                <RunFact label="Created" value={formatDateTime(selectedRun.createdAt)} />
                <RunFact label="Updated" value={formatDateTime(selectedRun.updatedAt)} />
              </div>
              <div className={`run-outcome ${selectedRun.status === "failed" ? "danger" : ""}`}>
                <b>{selectedRunSummary.outcomeTitle}</b>
                <p>{selectedRunSummary.outcome}</p>
              </div>
            </section>
            <section className="trace-section">
              <div className="section-title">INPUT CONTEXT</div>
              <div className="run-field-list">
                {selectedRunSummary.inputFacts.map((fact) => (
                  <div className="alignment-row" key={fact.label}>
                    <span>{fact.label}</span>
                    <b>{fact.value}</b>
                  </div>
                ))}
              </div>
              <details className="raw-details">
                <summary>Raw Input</summary>
                <pre className="json-block">
                  {JSON.stringify(selectedRun.input, null, 2)}
                </pre>
              </details>
            </section>
            <section className="trace-section">
              <div className="section-title">OUTPUT</div>
              <div className="run-field-list">
                {selectedRunSummary.outputFacts.map((fact) => (
                  <div className="alignment-row" key={fact.label}>
                    <span>{fact.label}</span>
                    <b>{fact.value}</b>
                  </div>
                ))}
              </div>
              <details className="raw-details">
                <summary>Raw Output</summary>
                <pre className="json-block">
                  {JSON.stringify(selectedRun.output ?? {}, null, 2)}
                </pre>
              </details>
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

function RunListItem({
  branchName,
  onSelect,
  run,
  selected,
}: {
  branchName: string | undefined;
  onSelect: () => void;
  run: RunRecord;
  selected: boolean;
}) {
  const summary = summarizeRun(run);

  return (
    <button
      className={`run-list-item ${selected ? "active" : ""} ${run.status}`}
      onClick={onSelect}
      type="button"
    >
      <span>{run.kind.toUpperCase()}</span>
      <b>{summary.shortId}</b>
      <em>{branchName ?? summary.branchLabel}</em>
      <small>{run.status} · {timeOnly(run.createdAt)}</small>
      <p>{summary.outcome}</p>
    </button>
  );
}

function RunFact({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "default" | "danger";
  value: string;
}) {
  return (
    <div className={`run-fact ${tone}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function summarizeRun(run: RunRecord, branch?: BranchRecord) {
  const output = run.output ?? {};
  const inputBranch = isJsonRecord(run.input.branch) ? run.input.branch : undefined;
  const inputBranchName = readDisplay(inputBranch?.name, undefined);
  const branchLabel =
    branch?.name ??
    inputBranchName ??
    readDisplay(run.branchId, "No branch");
  const error = readDisplay(output.error, "");
  const summary = readDisplay(output.summary, "");
  const decision = readDisplay(output.decision, "");
  const finalDecision = isJsonRecord(output.finalDecision)
    ? output.finalDecision
    : undefined;
  const action = readDisplay(finalDecision?.action ?? output.action, "");
  const confidence = formatConfidenceValue(finalDecision?.confidence ?? output.confidence);
  const outcome = error || summary || decision || action || "No output recorded.";

  return {
    branchLabel,
    shortId: run.id.slice(0, 8),
    subtitle: `${run.kind.toUpperCase()} · ${run.status} · ${branchLabel}`,
    title: `${titleize(run.kind)} ${run.id.slice(0, 8)}`,
    outcomeTitle: error ? "Failure" : "Result",
    outcome,
    inputFacts: [
      { label: "Run ID", value: run.id },
      { label: "Branch ID", value: readDisplay(run.branchId, "-") },
      { label: "Input Source", value: compactValue(run.metadata?.source ?? run.input.source) },
      { label: "Escalation", value: compactValue(run.input.escalation, "None") },
    ],
    outputFacts: [
      { label: "Decision", value: decision || action || "-" },
      { label: "Confidence", value: confidence },
      { label: "Summary", value: summary || "-" },
      { label: "Error", value: error || "-" },
    ],
  };
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRunFromApiError(error: unknown): RunRecord | undefined {
  if (!(error instanceof KairosApiError) || !isJsonRecord(error.body)) {
    return undefined;
  }

  const run = error.body.run;
  if (
    !isJsonRecord(run) ||
    typeof run.id !== "string" ||
    typeof run.kind !== "string" ||
    typeof run.status !== "string"
  ) {
    return undefined;
  }

  return run as RunRecord;
}

function BranchConfig({
  branch,
  modelDefaults,
  openRouterModels,
  tradeSymbolLoadState,
  tradeSymbols,
  onRunHeartbeat,
  onEscalate,
  onDiscard,
  onSave,
}: {
  branch: BranchRecord;
  modelDefaults: ModelRoleDefaults;
  openRouterModels: OpenRouterModelRecord[];
  tradeSymbolLoadState: LoadState;
  tradeSymbols: TradeSymbolRecord[];
  onRunHeartbeat: () => void;
  onEscalate: () => void;
  onDiscard: () => void;
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
  const [draftVersion, setDraftVersion] = useState(0);

  function resetDraft() {
    const nextConfig = cloneBranchConfig(normalizeBranchConfig(branch));
    setConfig(nextConfig);
    setBranchName(branch.name);
    setLawText(readLawText(branch));
    setDraftVersion((current) => current + 1);
  }

  useEffect(() => {
    resetDraft();
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
  const tradeSymbolUniverse = mergeSymbolSelection(
    branchAssets,
    tradeSymbols.map((symbol) => symbol.symbol),
  );
  const selectedTradeSymbols = normalizeSymbolSelection(
    tradingConfig.symbols ??
      (tradingConfig.symbol ? [tradingConfig.symbol] : branchAssets.slice(0, 1)),
    tradeSymbolUniverse,
  );
  const maxNotionalPerOrder = tradingConfig.maxNotionalPerOrder ?? 500;
  const maxOpenPositionNotionalPerSymbol =
    tradingConfig.maxOpenPositionNotionalPerSymbol ?? 1_500;
  const allowedOrderType = tradingConfig.allowedOrderType ?? "market";
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
          <button className="command-button" onClick={onRunHeartbeat} type="button">
            <Icon name="play_arrow" /> RUN HEARTBEAT CHECK
          </button>
          <button className="command-button primary-outline" onClick={onEscalate} type="button">
            <Icon name="forum" /> START MANUAL DEBATE
          </button>
          <button
            className="command-button danger-outline"
            onClick={onDiscard}
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
      <div className="config-body" key={draftVersion}>
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
                  symbols: normalizeSymbolSelection(current.trading?.symbols ?? [], assets),
                  symbol:
                    normalizeSymbolSelection(current.trading?.symbols ?? [], assets)[0] ??
                    assets[0],
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
            <div className="trading-section full">
              <div className="field-label">Mode</div>
              <div className="trading-card-row">
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
                    <b>Enable paper trading</b>
                    <small>Allows Kairos to create paper trade intents.</small>
                  </span>
                </label>
                <label className="checkbox-card">
                  <input
                    checked={paperAutoBuyEnabled}
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
                    <b>Auto-submit paper orders</b>
                    <small>Enables paper mode when switched on.</small>
                  </span>
                </label>
              </div>
            </div>
            <div className="trading-section full">
              <div className="field-label">Execution</div>
              <div className="trading-fields-row">
                <FieldLabel label="Symbols">
                  <TradeSymbolDropdown
                    assets={branchAssets}
                    catalog={tradeSymbols}
                    loadState={tradeSymbolLoadState}
                    selected={selectedTradeSymbols}
                    onChange={(symbols) =>
                      setConfig((current) => ({
                        ...current,
                        assets: mergeSymbolSelection(current.assets ?? [], symbols),
                        trading: {
                          ...current.trading,
                          symbols,
                          symbol: symbols[0],
                        },
                      }))
                    }
                  />
                </FieldLabel>
                <FieldLabel label="Order Type">
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
              </div>
            </div>
            <div className="trading-section full">
              <div className="field-label">Limits</div>
              <div className="trading-fields-row">
                <FieldLabel label="Max Order">
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
                <FieldLabel label="Max Position">
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
              </div>
            </div>
            <div className="threshold-inline">
              <Slider
                label="Paper Trade Threshold"
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
                  placeholder={modelDefaults[field.key]?.model ?? "Model"}
                  value={config.models?.[field.key]?.model ?? modelDefaults[field.key]?.model ?? ""}
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
                  value={
                    config.models?.[field.key]?.reasoningEffort ??
                    modelDefaults[field.key]?.reasoningEffort ??
                    ""
                  }
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

function TradeSymbolDropdown({
  assets,
  catalog,
  loadState,
  selected,
  onChange,
}: {
  assets: string[];
  catalog: TradeSymbolRecord[];
  loadState: LoadState;
  selected: string[];
  onChange: (symbols: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [searchCatalog, setSearchCatalog] = useState<TradeSymbolRecord[]>([]);
  const [searchLoadState, setSearchLoadState] = useState<LoadState>("api");
  const normalizedQuery = normalizeTickerInput(query);
  const activeCatalog = normalizedQuery
    ? mergeTradeSymbolRecords(catalog, searchCatalog)
    : catalog;
  const activeLoadState = normalizedQuery ? searchLoadState : loadState;
  const options = mergeTradeSymbolOptions(activeCatalog, assets, selected);
  const optionSymbols = options.map((option) => option.symbol);
  const visibleOptions = options.filter((option) => {
    if (!normalizedQuery) return true;
    return (
      option.symbol.includes(normalizedQuery) ||
      option.name?.toUpperCase().includes(normalizedQuery)
    );
  });
  const selectedSet = new Set(selected);
  const summary =
    selected.length === 0
      ? "No trade symbols selected"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} symbols selected`;

  useEffect(() => {
    if (!normalizedQuery) {
      setSearchCatalog([]);
      setSearchLoadState("api");
      return;
    }

    let cancelled = false;
    setSearchLoadState("loading");
    getTradeSymbols({ query: normalizedQuery, limit: 50 })
      .then((symbols) => {
        if (!cancelled) {
          setSearchCatalog(symbols);
          setSearchLoadState("api");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSearchCatalog([]);
          setSearchLoadState("offline");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedQuery]);

  function toggle(symbol: string, checked: boolean) {
    const next = checked
      ? [...selectedSet, symbol]
      : selected.filter((item) => item !== symbol);
    onChange(normalizeSymbolSelection(next, optionSymbols));
  }

  return (
    <details className="multi-select">
      <summary>{summary}</summary>
      <div className="multi-select-menu">
        <input
          className="multi-select-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tickers"
          value={query}
        />
        {activeLoadState === "loading" && (
          <span className="empty-option">Updating symbol catalog.</span>
        )}
        {activeLoadState === "offline" && activeCatalog.length === 0 && (
          <span className="empty-option">Symbol lookup unavailable. Add tracked tickers manually.</span>
        )}
        {visibleOptions.length === 0 ? (
          <span className="empty-option">No matching symbols.</span>
        ) : (
          visibleOptions.map((option) => (
            <label className="symbol-option" key={option.symbol}>
              <input
                checked={selectedSet.has(option.symbol)}
                onChange={(event) => toggle(option.symbol, event.target.checked)}
                type="checkbox"
              />
              <span className="symbol-option-main">
                <b>{option.symbol}</b>
                <small>{option.name ?? option.exchange ?? "Tracked ticker"}</small>
              </span>
              <span className="symbol-option-meta">
                <b>{formatMoneyValue(option.price)}</b>
                <small>{formatPercentValue(option.dayChangePercent)}</small>
              </span>
            </label>
          ))
        )}
      </div>
    </details>
  );
}

function EvidencePane({
  events,
  onClose,
  run,
}: {
  events: RunEventRecord[];
  onClose?: () => void;
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
      <PaneHeader
        actionIcon={onClose ? "close" : undefined}
        actionIconLabel={onClose ? "Close evidence" : undefined}
        icon="database"
        meta=""
        onActionIconClick={onClose}
        title="EVIDENCE"
      />
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
  const summary = eventSummary(event);
  const isFailure = event.type.includes("failed") || Boolean(event.payload.error);

  return (
    <article className={`agent-card event-card ${isFailure ? "danger" : ""}`}>
      <div className="agent-card-head">
        <span>
          <Icon name={isFailure ? "error" : event.type.startsWith("human.") ? "person" : "notes"} />
          {actor}: {titleize(event.type)}
        </span>
        <b>{timeOnly(event.timestamp)}</b>
      </div>
      <p>{summary}</p>
      <details className="raw-details compact">
        <summary>Payload</summary>
        <pre className="event-json">{JSON.stringify(event.payload, null, 2)}</pre>
      </details>
    </article>
  );
}

function eventSummary(event: RunEventRecord): string {
  return compactValue(
    event.payload.summary ??
      event.payload.message ??
      event.payload.error ??
      event.payload.decision ??
      event.payload.status,
    titleize(event.type),
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
  const summary = String(
    event.payload.summary ??
      event.payload.message ??
      event.payload.error ??
      event.payload.status ??
      event.type,
  );

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
  actionIconLabel,
  onActionIconClick,
}: {
  icon?: string;
  title: string;
  meta: string;
  action?: string;
  actionIcon?: string;
  actionIconLabel?: string;
  onActionIconClick?: () => void;
}) {
  return (
    <div className="pane-head">
      <div>
        <h2>{icon && <Icon name={icon} />} {title}</h2>
        {meta && <div>{meta}</div>}
      </div>
      {action && <button className="command-button compact" type="button">{action}</button>}
      {actionIcon && (
        <IconButton
          icon={actionIcon}
          label={actionIconLabel ?? actionIcon}
          onClick={onActionIconClick}
        />
      )}
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

function IconButton({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button className="icon-button" onClick={onClick} title={label} type="button">
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
        supermemory_search: {
          ...config.tools?.information?.supermemory_search,
          enabled: true,
        },
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
      symbol: config.trading?.symbol || config.assets?.[0] || readAssets(branch)[0],
      symbols: config.trading?.symbols ?? [],
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

function cloneBranchConfig(config: WebBranchConfig): WebBranchConfig {
  return JSON.parse(JSON.stringify(config)) as WebBranchConfig;
}

function readLawText(branch: BranchRecord): string {
  return typeof branch.law?.thesis === "string"
    ? branch.law.thesis
    : branch.description ?? "";
}

function humanizeToolName(toolName: InformationConfigToolName): string {
  const labels: Partial<Record<InformationConfigToolName, string>> = {
    exa_search: "Search",
    exa_research: "Deep Research",
    exa_contents: "Read URL Contents",
    finnhub_api_request: "Finnhub API Request",
    finnhub_quote: "Quote",
    finnhub_company_news: "News",
    finnhub_stock_candles: "Candles",
    finnhub_aggregate_indicator: "Aggregate Indicator",
    finnhub_basic_financials: "Basic Financials",
    finnhub_company_earnings: "Earnings",
    finnhub_company_eps_estimates: "EPS Estimates",
    finnhub_company_peers: "Peers",
    finnhub_company_profile: "Profile",
    finnhub_earnings_calendar: "Earnings Calendar",
    finnhub_filings: "Filings",
    finnhub_financials_reported: "Financials Reported",
    finnhub_insider_transactions: "Insider Transactions",
    finnhub_news_sentiment: "News Sentiment",
    finnhub_ownership: "Ownership",
    finnhub_press_releases: "Press Releases",
    finnhub_recommendation_trends: "Recommendation Trends",
    finnhub_social_sentiment: "Social Sentiment",
    finnhub_supply_chain_relationships: "Supply Chain Relationships",
    finnhub_upgrade_downgrade: "Upgrade Downgrade",
    supermemory_search: "Memory Search",
  };

  if (labels[toolName]) return labels[toolName];

  return toolName
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toolAccessLabel(tool: (typeof informationToolFields)[number]): string {
  return tool.key === "finnhub_api_request"
    ? `${tool.label} (${tool.access})`
    : tool.label;
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

function formatPercentValue(value: unknown) {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : undefined;

  if (typeof numberValue !== "number" || !Number.isFinite(numberValue)) return "-";
  const sign = numberValue > 0 ? "+" : "";
  return `${sign}${numberValue.toFixed(2)}%`;
}

function formatTimestamp(value: unknown) {
  return typeof value === "string" && value.length > 0 ? timeOnly(value) : "-";
}

function chatDisplayTitle(chat: RouterChatRecord): string {
  return chat.title?.trim() || `Router chat from ${formatChatTimestamp(chat.createdAt)}`;
}

function buildChatTitle(text: string): string | undefined {
  const title = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return undefined;
  return title.length > 64 ? `${title.slice(0, 61).trimEnd()}...` : title;
}

function formatChatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (sameDay) return `Today, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;

  return date.toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function readDisplay(value: unknown, fallback = "-") {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function compactValue(value: unknown, fallback = "-") {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? fallback : `${value.length} items`;
  if (isJsonRecord(value)) {
    const keys = Object.keys(value);
    return keys.length === 0 ? fallback : keys.slice(0, 4).join(", ");
  }
  return fallback;
}

function getHeartbeatEscalation(run: RunRecord | undefined): JsonRecord | undefined {
  const outputEscalation = run?.output?.escalationEvent;
  if (isJsonRecord(outputEscalation)) return outputEscalation;

  const inputEscalation = run?.input?.escalation;
  return isJsonRecord(inputEscalation) ? inputEscalation : undefined;
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

function parseAssetList(value: string): string[] {
  return [...new Set(
    value
      .split(/[,\s]+/)
      .map(normalizeTickerInput)
      .filter(Boolean),
  )];
}

function normalizeTickerInput(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function mergeSymbolSelection(...groups: string[][]): string[] {
  return [...new Set(groups.flat().map(normalizeTickerInput).filter(Boolean))];
}

function normalizeSymbolSelection(symbols: string[], assets: string[]): string[] {
  const assetSet = new Set(assets.map(normalizeTickerInput));
  return [...new Set(symbols.map(normalizeTickerInput).filter(Boolean))]
    .filter((symbol) => assetSet.size === 0 || assetSet.has(symbol));
}

type TradeSymbolOption = Partial<TradeSymbolRecord> & {
  symbol: string;
};

function mergeTradeSymbolRecords(
  ...groups: TradeSymbolRecord[][]
): TradeSymbolRecord[] {
  const records = new Map<string, TradeSymbolRecord>();
  for (const record of groups.flat()) {
    const symbol = normalizeTickerInput(record.symbol);
    if (symbol) records.set(symbol, { ...record, symbol });
  }
  return [...records.values()];
}

function mergeTradeSymbolOptions(
  catalog: TradeSymbolRecord[],
  assets: string[],
  selected: string[],
): TradeSymbolOption[] {
  const selectedSet = new Set(selected.map(normalizeTickerInput));
  const options = new Map<string, TradeSymbolOption>();
  const order = new Map<string, number>();

  for (const record of catalog) {
    const symbol = normalizeTickerInput(record.symbol);
    if (symbol) {
      options.set(symbol, { ...record, symbol });
      if (!order.has(symbol)) order.set(symbol, order.size);
    }
  }

  for (const symbol of mergeSymbolSelection(assets, selected)) {
    if (!options.has(symbol)) {
      options.set(symbol, {
        symbol,
        name: assets.includes(symbol) ? "Tracked ticker" : "Selected ticker",
      });
      order.set(symbol, order.size);
    }
  }

  return [...options.values()].sort((left, right) => {
    const selectedDelta =
      Number(selectedSet.has(right.symbol)) - Number(selectedSet.has(left.symbol));
    if (selectedDelta !== 0) return selectedDelta;
    const tradableDelta = Number(right.tradable) - Number(left.tradable);
    if (tradableDelta !== 0) return tradableDelta;
    return (order.get(left.symbol) ?? 0) - (order.get(right.symbol) ?? 0);
  });
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

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

function titleize(value: string) {
  return value
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
