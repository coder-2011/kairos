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
import type { KairosSession } from "./auth";
import {
  getSupabaseAuthConfiguredError,
  getSupabaseSession,
  isSupabaseAuthEnabled,
  isSupabaseAuthConfigured,
  isAuthorizedEmail,
  onSupabaseAuthStateChange,
  signInWithGoogle,
  signOutFromGoogle,
} from "./auth";
import {
  appendInterjection,
  cancelRun,
  createBranch,
  createRouterChat,
  createDebate,
  deleteBranch,
  getBranches,
  getCapabilityPreflight,
  getMessages,
  getOpenRouterModels,
  getPortfolio,
  getRun,
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
  type CapabilityPreflight,
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
import { DeepResearchView } from "./deep-research";

type View = "branches" | "router" | "deepResearch" | "monitoring" | "portfolio" | "runDeepDive" | "config";
type LoadState = "loading" | "api" | "offline";
type ThemeMode = "light" | "dark";
type PromptConfigKey = keyof NonNullable<WebBranchConfig["prompts"]>;

const THEME_STORAGE_KEY = "kairos-theme-v2";

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

const routeViews: View[] = ["branches", "router", "deepResearch", "monitoring", "portfolio", "runDeepDive", "config"];

const views: Array<{ id: Exclude<View, "config">; label: string; icon: string }> = [
  { id: "branches", label: "Branch List", icon: "account_tree" },
  { id: "router", label: "Router", icon: "route" },
  { id: "deepResearch", label: "Deep Research", icon: "travel_explore" },
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
  purpose: string;
}> = [
  { label: "Heartbeat", key: "heartbeat", purpose: "Cheap frequent monitoring model for this branch law." },
  { label: "Information Planner", key: "informationPlanner", purpose: "Plans research steps and selects relevant information tools." },
  { label: "Information Synthesis", key: "informationSynthesis", purpose: "Summarizes retrieved evidence into compact branch context." },
  { label: "Debate Judge", key: "debateJudge", purpose: "Controls the debate loop and final decision framing." },
  { label: "Debate Bull", key: "debateBull", purpose: "Argues the constructive or ownership case for the event." },
  { label: "Debate Bear", key: "debateBear", purpose: "Argues risks, noise, priced-in evidence, and downside cases." },
  { label: "Debate Final", key: "debateFinal", purpose: "Produces the final synthesis after debate." },
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

const heartbeatToolFields: Array<{ label: string; key: HeartbeatToolName; purpose: string }> = [
  { label: "Supermemory Profile", key: "supermemory_profile", purpose: "Retrieves branch-specific user profile context and durable preferences." },
  { label: "Supermemory Search", key: "supermemory_search", purpose: "Searches branch memory for prior observations and duplicate context." },
  { label: "Exa News Search", key: "exa_news_search", purpose: "Finds recent web/news evidence relevant to the branch law." },
];

const debateToolFields: Array<{ label: string; key: DebateConfigToolName; purpose: string }> = [
  { label: "Exa Search", key: "exa_search", purpose: "Lets debate agents search current web evidence." },
  { label: "Deep Research", key: "exa_research", purpose: "Runs deeper Exa research for higher-effort evidence gathering." },
  { label: "Information Agent", key: "information", purpose: "Delegates targeted source and market-data lookup to the information workflow." },
  { label: "Portfolio", key: "portfolio", purpose: "Injects current paper portfolio context into debate reasoning." },
];

const allowedOrderTypeOptions: AllowedOrderType[] = ["market", "limit"];

type TradingActionMode = "enable_trading" | "notify" | "both";

const tradingActionOptions: Array<{
  label: string;
  value: TradingActionMode;
}> = [
  { label: "Enable Trading", value: "enable_trading" },
  { label: "Notify", value: "notify" },
  { label: "Both", value: "both" },
];

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
  const [tradeSymbols, setTradeSymbols] = useState<TradeSymbolRecord[]>([]);
  const [tradeSymbolLoadState, setTradeSymbolLoadState] =
    useState<LoadState>("loading");
  const [routerChats, setRouterChats] = useState<RouterChatRecord[]>([]);
  const [selectedRouterChatId, setSelectedRouterChatId] = useState("");
  const [routerMessages, setRouterMessages] = useState<RouterMessageRecord[]>([]);
  const [routerLoadState, setRouterLoadState] = useState<LoadState>("loading");
  const [routerRunning, setRouterRunning] = useState(false);
  const [lastRouterHeartbeatRuns, setLastRouterHeartbeatRuns] = useState<RunRecord[]>([]);
  const [capabilityPreflight, setCapabilityPreflight] = useState<CapabilityPreflight>();
  const [capabilityLoadState, setCapabilityLoadState] = useState<LoadState>("loading");
  const [authSession, setAuthSession] = useState<KairosSession>(null);
  const [authStatus, setAuthStatus] = useState<"initializing" | "ready">("initializing");
  const [authError, setAuthError] = useState("");
  const authEnabled = isSupabaseAuthEnabled;
  const hasActiveSession = authEnabled
    ? Boolean(authSession && isAuthorizedEmail(authSession.user?.email))
    : true;
  const canLoadBackendData = authEnabled
    ? authStatus === "ready" && hasActiveSession
    : true;

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

  const userLabel = authSession?.user
    ? authSession.user.user_metadata?.full_name ||
      authSession.user.user_metadata?.name ||
      authSession.user.email ||
      "Signed in user"
    : "Not signed in";

  useEffect(() => {
    let cancelled = false;

    async function initializeAuth() {
      try {
        if (!authEnabled) {
          setAuthStatus("ready");
          return;
        }

        if (!isSupabaseAuthConfigured) {
          setAuthError(getSupabaseAuthConfiguredError());
          setAuthStatus("ready");
          return;
        }

        const session = await getSupabaseSession();
        if (cancelled) return;
        const sessionEmail = session?.user?.email;
        if (
          session &&
          sessionEmail &&
          !isAuthorizedEmail(sessionEmail)
        ) {
          setAuthError("This Google account is not authorized for Kairos.");
          await signOutFromGoogle();
          setAuthSession(null);
          return;
        }

        setAuthError("");
        setAuthSession(session);
      } catch (error) {
        if (!cancelled) {
          setAuthError(error instanceof Error ? error.message : "Auth initialization failed.");
        }
      } finally {
        if (!cancelled) {
          setAuthStatus("ready");
        }
      }
    }

    void initializeAuth();

    if (!authEnabled) {
      return () => {
        cancelled = true;
      };
    }

    const authChange = onSupabaseAuthStateChange((nextSession) => {
      if (!cancelled) {
        const nextSessionEmail = nextSession?.user?.email;
        if (
          nextSession &&
          nextSessionEmail &&
          !isAuthorizedEmail(nextSessionEmail)
        ) {
          setAuthError("This Google account is not authorized for Kairos.");
          setAuthSession(null);
          void signOutFromGoogle();
          return;
        }

        if (!nextSession) {
          setAuthError("");
        }
        setAuthSession(nextSession);
      }
    });

    return () => {
      cancelled = true;
      authChange.data.subscription.unsubscribe();
    };
  }, []);

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

    if (!canLoadBackendData) {
      setBranches([]);
      setRuns([]);
      setEvents([]);
      setLoadState("loading");
      return;
    }

    async function load() {
      try {
        const [apiBranches, apiRuns] = await Promise.all([
          getBranches(),
          getRuns(),
        ]);

        if (cancelled) return;
        setBranches(apiBranches);
        const sortedRuns = sortRunsByCreatedAt(apiRuns);
        setRuns(sortedRuns);
        const route = readRouteFromHash();
        setSelectedBranchId(
          route.branchId && apiBranches.some((branch) => branch.id === route.branchId)
            ? route.branchId
            : apiBranches[0]?.id ?? "",
        );
        setSelectedRunId((current) => {
          const routeRunId = route.runId && sortedRuns.some((run) => run.id === route.runId)
            ? route.runId
            : undefined;
          if (routeRunId) return routeRunId;
          return current && sortedRuns.some((run) => run.id === current) ? current : "";
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
  }, [canLoadBackendData]);

  useEffect(() => {
    if (!canLoadBackendData) {
      setCapabilityPreflight(undefined);
      setCapabilityLoadState("offline");
      return;
    }

    if (!selectedBranch?.id) {
      setCapabilityPreflight(undefined);
      setCapabilityLoadState("offline");
      return;
    }

    let cancelled = false;
    setCapabilityLoadState("loading");
    getCapabilityPreflight(selectedBranch.id)
      .then((preflight) => {
        if (cancelled) return;
        setCapabilityPreflight(preflight);
        setCapabilityLoadState("api");
      })
      .catch(() => {
        if (cancelled) return;
        setCapabilityPreflight(undefined);
        setCapabilityLoadState("offline");
      });

    return () => {
      cancelled = true;
    };
  }, [canLoadBackendData, selectedBranch?.id, selectedBranch?.updatedAt]);

  useEffect(() => {
    let cancelled = false;
    if (!canLoadBackendData) {
      setOpenRouterModels([]);
      setModelDefaults({});
      return;
    }

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
  }, [canLoadBackendData]);

  useEffect(() => {
    let cancelled = false;
    if (!canLoadBackendData) {
      setTradeSymbols([]);
      setTradeSymbolLoadState("offline");
      return;
    }

    setTradeSymbolLoadState("loading");
    getTradeSymbols({ limit: 500 })
      .then((symbols) => {
        if (!cancelled) {
          setTradeSymbols(symbols);
          setTradeSymbolLoadState("api");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTradeSymbols([]);
          setTradeSymbolLoadState("offline");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canLoadBackendData]);

  useEffect(() => {
    if (!canLoadBackendData || !selectedRun?.id || loadState !== "api") {
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
  }, [canLoadBackendData, loadState, selectedRun?.id]);

  useEffect(() => {
    if (
      !canLoadBackendData ||
      !selectedRun?.id ||
      selectedRun.status !== "running"
    )
      return;

    const interval = window.setInterval(() => {
      void Promise.all([
        getRun(selectedRun.id),
        getRunEvents(selectedRun.id),
      ]).then(([nextRun, nextEvents]) => {
        setRuns((current) => [
          nextRun,
          ...current.filter((item) => item.id !== nextRun.id),
        ]);
        setEvents(nextEvents);
      }).catch(() => {
        setLoadState("offline");
      });
    }, 1500);

    return () => window.clearInterval(interval);
  }, [canLoadBackendData, selectedRun?.id, selectedRun?.status]);

  useEffect(() => {
    if (!canLoadBackendData) {
      setSelectedRunId("");
      return;
    }

    if (
      loadState === "api" &&
      (view === "monitoring" || view === "runDeepDive") &&
      !selectedRunId &&
      runs[0]?.id
    ) {
      setSelectedRunId(runs[0].id);
      window.history.replaceState(null, "", routeHash({ view, runId: runs[0].id }));
    }
  }, [canLoadBackendData, loadState, runs, selectedRunId, view]);

  useEffect(() => {
    if (!canLoadBackendData || view !== "portfolio") return;
    void refreshPortfolioData();
  }, [canLoadBackendData, view]);

  useEffect(() => {
    if (!canLoadBackendData || view !== "router") return;
    void refreshRouterChats();
  }, [canLoadBackendData, view]);

  useEffect(() => {
    if (
      !canLoadBackendData ||
      !selectedRouterChatId ||
      routerLoadState !== "api"
    ) {
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
  }, [canLoadBackendData, routerLoadState, selectedRouterChatId]);

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
      const heartbeatAttemptRuns =
        result.heartbeatAttemptRuns ?? result.heartbeatRuns;
      setRuns((current) => [
        result.run,
        ...heartbeatAttemptRuns,
        ...current.filter(
          (run) =>
            run.id !== result.run.id &&
            !heartbeatAttemptRuns.some((heartbeatRun) => heartbeatRun.id === run.id),
        ),
      ]);
      setSelectedRunId(result.run.id);
      setLastRouterHeartbeatRuns(heartbeatAttemptRuns);
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
        async: true,
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

  async function cancelSelectedRun(runId: string) {
    try {
      const run = await cancelRun(runId);
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setLoadState("api");
      const nextEvents = await getRunEvents(run.id);
      setEvents(nextEvents);
    } catch {
      setLoadState("offline");
    }
  }

  async function injectHumanContext(message: string, metadata?: JsonRecord) {
    if (!selectedRun?.id || !message.trim()) return;

    try {
      const event = await appendInterjection(selectedRun.id, message.trim(), {
        metadata,
      });
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
      enabled: boolean;
      lawText: string;
    },
  ) {
    try {
      const currentBranch = branches.find((branch) => branch.id === branchId);
      const branchInput = {
        name: input.branchName.trim() || currentBranch?.name || "Untitled Branch",
        enabled: input.enabled,
        description: input.lawText,
        law: {
          ...currentBranch?.law,
          thesis: input.lawText,
        },
        config: input.config,
      };
      const branch = isLocalDraftBranch(currentBranch)
        ? await createBranch({
            id: branchId,
            ...branchInput,
          })
        : await updateBranch(branchId, branchInput);
      setBranches((current) =>
        current.map((item) => (item.id === branch.id ? branch : item)),
      );
      setSelectedBranchId(branch.id);
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
      const branch = createDraftBranch(nextBranchName(branches));
      setBranches((current) => [branch, ...current.filter((item) => item.id !== branch.id)]);
      setSelectedBranchId(branch.id);
      navigate("config", { branchId: branch.id });
      setLoadState("offline");
    }
  }

  async function discardBranch(branchId: string) {
    const branch = branches.find((item) => item.id === branchId);
    if (isLocalDraftBranch(branch)) {
      const nextBranches = branches.filter((item) => item.id !== branchId);
      setBranches(nextBranches);
      setSelectedBranchId(nextBranches[0]?.id ?? "");
      navigate("branches");
      return;
    }

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

  async function startGoogleSignIn() {
    setAuthError("");
    try {
      setAuthStatus("initializing");
      await signInWithGoogle();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sign in.";
      setAuthError(
        message.includes("provider is not enabled")
          ? "Google auth is not enabled in Supabase. Enable Google in Supabase Auth Providers."
          : message,
      );
      setAuthStatus("ready");
    }
  }

  async function handleSignOut() {
    setAuthError("");
    try {
      await signOutFromGoogle();
      setAuthSession(null);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Sign out failed.");
      setAuthStatus("ready");
    }
  }

  if (authEnabled && !isSupabaseAuthConfigured) {
    return (
      <AuthGate
        status="Missing Supabase auth configuration."
        subtitle={
          authError ||
          "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before enabling Google login."
        }
      />
    );
  }

  if (authEnabled && authStatus === "initializing") {
    return <AuthGate status="Checking Google auth state..." />;
  }

  if (authEnabled && !authSession) {
    return (
      <AuthGate
        onSignIn={startGoogleSignIn}
        onSignOut={handleSignOut}
        onRetry={() => void startGoogleSignIn()}
        ready={false}
        signedInUser={userLabel}
        status="Sign in to continue."
        subtitle={authError || "Authenticate with Google to unlock the Kairos dashboard."}
      />
    );
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
        {authEnabled ? (
          <TopBar onSignOut={handleSignOut} signedInUser={userLabel} />
        ) : null}
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
        {view === "deepResearch" && <DeepResearchView />}
        {view === "monitoring" && (
          <MonitoringView
            branches={branches}
            events={events}
            loadState={loadState}
            onInject={injectHumanContext}
            onSelectRun={(runId) => navigate("monitoring", { runId })}
            onCancelRun={(runId) => void cancelSelectedRun(runId)}
            onStartDebateFromEscalation={(branchId, escalation) =>
              void startDebate(branchId, {
                ...escalation,
                ...(selectedRun?.id ? { sourceRunId: selectedRun.id } : {}),
              })
            }
            run={selectedRun}
            runs={runs}
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
            loadState={loadState}
            onSelectRun={(runId) => navigate("runDeepDive", { runId })}
            onCancelRun={(runId) => void cancelSelectedRun(runId)}
            runs={runs}
            selectedRun={selectedRun}
          />
        )}
        {view === "config" && selectedBranch && (
          <BranchConfig
            branch={selectedBranch}
            capabilityLoadState={capabilityLoadState}
            capabilityPreflight={capabilityPreflight}
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

function AuthGate({
  onSignIn,
  onRetry,
  onSignOut,
  ready = false,
  signedInUser,
  status,
  subtitle,
}: {
  onSignIn?: () => void;
  onRetry?: () => void;
  onSignOut?: () => void;
  ready?: boolean;
  signedInUser?: string;
  status: string;
  subtitle?: string;
}) {
  return (
    <main className="auth-guard">
      <section className="auth-card">
        <div className="auth-logo">K</div>
        <h1>KAIROS</h1>
        <p>{status}</p>
        {subtitle ? <p className="auth-subtitle">{subtitle}</p> : null}
        {signedInUser ? <p className="auth-user">{signedInUser}</p> : null}

        <div className="auth-actions">
          {onSignIn ? (
            <button
              className="command-button primary"
              onClick={() => void onSignIn()}
              type="button"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                login
              </span>
              Continue with Google
            </button>
          ) : null}
          {ready && onRetry ? (
            <button
              className="command-button compact"
              onClick={() => void onRetry()}
              type="button"
            >
              Retry
            </button>
          ) : null}
          {onSignOut ? (
            <button
              className="command-button compact"
              onClick={() => void onSignOut()}
              type="button"
            >
              Sign Out
            </button>
          ) : null}
        </div>
      </section>
    </main>
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

function TopBar({
  onSignOut,
  signedInUser,
}: {
  onSignOut: () => void;
  signedInUser: string;
}) {
  return (
    <header className="top-bar">
      <div className="top-status">
        <span className="status-light" />
        <span>{signedInUser}</span>
      </div>
      <div className="top-actions">
        <button
          className="command-button compact"
          onClick={() => void onSignOut()}
          type="button"
        >
          <Icon name="logout" />
          LOG OUT
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
                  <td data-label="Branch ID">{branch.id}</td>
                  <td className="muted truncate-cell" data-label="Linked Law">{branch.name}</td>
                  <td className="muted" data-label="Heartbeat">{formatHeartbeat(branch)}</td>
                  <td data-label="Last Run">
                    {String(branch.metadata?.lastRun ?? timeOnly(branch.updatedAt))}
                  </td>
                  <td
                    className={`right ${getEscalations(branch, runs) > 0 ? "danger-text" : ""}`}
                    data-label="Escalations"
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
                <p>
                  {readDisplay(
                    run.output?.summary ?? run.output?.error,
                    "Heartbeat created.",
                  )}
                </p>
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
  branches,
  events,
  loadState,
  onCancelRun,
  onSelectRun,
  onStartDebateFromEscalation,
  run,
  runs,
  onInject,
}: {
  branches: BranchRecord[];
  events: RunEventRecord[];
  loadState: LoadState;
  onCancelRun: (runId: string) => void;
  onSelectRun: (runId: string) => void;
  run?: RunRecord;
  runs: RunRecord[];
  onStartDebateFromEscalation: (branchId: string, escalation: JsonRecord) => void;
  onInject: (message: string, metadata?: JsonRecord) => void | Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [feedbackPending, setFeedbackPending] = useState<"wrong" | "stale" | "useful" | null>(null);
  const [lastFeedback, setLastFeedback] = useState<"wrong" | "stale" | "useful" | null>(null);
  const [showEvidence, setShowEvidence] = useState(true);
  const heartbeatEscalation = getHeartbeatEscalation(run);
  const runSummary = run ? summarizeRun(run, branches.find((branch) => branch.id === run.branchId)) : undefined;
  const branchName = run ? selectedBranchName(branches, run.branchId) : undefined;
  const branchBreakdowns = createBranchRunBreakdowns(branches, runs);
  const monitoringStats = createMonitoringStats(runs, branchBreakdowns);
  const transcriptEvents = events.filter(
    (event) => event.type.startsWith("debate.")
      || event.type.startsWith("human.")
      || event.type.startsWith("participant.")
      || event.type.startsWith("model.")
      || event.type.startsWith("tool.call.")
      || event.type.startsWith("tool.")
      || event.type.startsWith("run."),
  );
  const monitoringPayload = {
    run,
    events,
    exportedAt: new Date().toISOString(),
  };

  async function injectFeedback(label: "wrong" | "stale" | "useful") {
    if (!run || feedbackPending) return;

    setFeedbackPending(label);
    try {
      await onInject(`Feedback: marked this run as ${label}.`, {
        feedback: label,
        source: "monitoring_decision_control",
      });
      setLastFeedback(label);
    } finally {
      setFeedbackPending(null);
    }
  }

  async function exportRun() {
    if (!run) return;
    await navigator.clipboard?.writeText(JSON.stringify(monitoringPayload, null, 2));
    onInject("Exported run packet from Monitoring.", {
      source: "monitoring_export",
      exportedRunId: run.id,
      eventCount: events.length,
    });
  }

  return (
    <main className={`split-canvas ${showEvidence ? "" : "evidence-closed"}`}>
      <section className="event-stream pane narrow">
        <PaneHeader
          icon="receipt_long"
          meta={`${runs.length} TOTAL`}
          title="RUNS"
        />
        <div className="monitoring-run-strip">
          <div className="section-title">RECENT ACTIVITY</div>
          {loadState === "loading" ? (
            <EmptyPanel
              icon="hourglass_top"
              message="Loading run history."
              title="Loading Runs"
            />
          ) : runs.length === 0 ? (
            <EmptyPanel
              icon="history"
              message="Run a heartbeat or debate to populate Monitoring."
              title="No Runs"
            />
          ) : (
            <div className="monitoring-run-list">
              {runs.slice(0, 8).map((item) => (
                <button
                  className={`monitoring-run-item ${item.id === run?.id ? "active" : ""} ${item.status}`}
                  key={item.id}
                  onClick={() => onSelectRun(item.id)}
                  type="button"
                >
                  <span>{item.kind}</span>
                  <b>{summarizeRun(item).outcome}</b>
                  <small>{selectedBranchName(branches, item.branchId) ?? item.branchId ?? "No branch"} / {timeOnly(item.createdAt)}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="monitoring-timeline-head">
          <span>EVENT TIMELINE</span>
          <b>{run ? `${events.length} EVENTS` : "NO RUN"}</b>
        </div>
        <div className="timeline-scroll">
          {!run ? (
            <EmptyPanel
              icon="touch_app"
              message={loadState === "loading" ? "Loading timeline..." : "Select a run to inspect its timeline."}
              title="No Run Selected"
            />
          ) : events.length === 0 ? (
            <EmptyPanel
              icon="stream"
              message="This run has no event records yet. The run summary still appears in the center pane."
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
          onActionClick={() => void exportRun()}
          icon="forum"
          meta={branchName ?? runSummary?.branchLabel ?? ""}
          title={run ? "RUN DETAIL" : "MONITORING"}
        />
        <div className="transcript-scroll">
          <MonitoringSummaryBar
            branchBreakdowns={branchBreakdowns}
            stats={monitoringStats}
            onSelectRun={onSelectRun}
          />
          {run && runSummary ? (
            <MonitoringRunDetail
              escalation={heartbeatEscalation}
              events={events}
              eventCount={events.length}
              run={run}
              runs={runs}
              summary={runSummary}
              onCancelRun={onCancelRun}
              onStartDebate={onStartDebateFromEscalation}
            />
          ) : (
            <EmptyPanel
              icon="touch_app"
              message={
                loadState === "loading"
                  ? "Loading monitoring data..."
                  : "Select a run from the left column to inspect the decision packet."
              }
              title="No Run Selected"
            />
          )}
          {run && transcriptEvents.length === 0 ? (
            <EmptyPanel
              icon="forum"
              message={
                run?.kind === "heartbeat"
                  ? "Heartbeat results appear here first. If it escalates, start the debate from the heartbeat packet."
                  : "No transcript yet."
              }
              title={run?.kind === "heartbeat" ? "No Debate Started" : "No Debate Transcript"}
            />
          ) : run ? (
            transcriptEvents.map((event) => (
              <EventRecordCard event={event} key={event.id} />
            ))
          ) : null}
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
              disabled={!run || !message.trim()}
              type="button"
            >
              INJECT
            </button>
          </div>
          <div className="decision-row">
            <span>DECISION CONTROL</span>
            <div>
              <button
                className={`command-button compact feedback-button danger-outline ${lastFeedback === "wrong" ? "active" : ""}`}
                disabled={!run || feedbackPending !== null}
                onClick={() => void injectFeedback("wrong")}
                type="button"
              >
                <Icon name={feedbackPending === "wrong" ? "progress_activity" : "thumb_down"} /> WRONG
              </button>
              <button
                className={`command-button compact feedback-button warning-outline ${lastFeedback === "stale" ? "active" : ""}`}
                disabled={!run || feedbackPending !== null}
                onClick={() => void injectFeedback("stale")}
                type="button"
              >
                <Icon name={feedbackPending === "stale" ? "progress_activity" : "update"} /> STALE
              </button>
              <button
                className={`command-button compact feedback-button success-outline ${lastFeedback === "useful" ? "active" : ""}`}
                disabled={!run || feedbackPending !== null}
                onClick={() => void injectFeedback("useful")}
                type="button"
              >
                <Icon name={feedbackPending === "useful" ? "progress_activity" : "thumb_up"} /> USEFUL
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

function MonitoringRunDetail({
  escalation,
  events,
  eventCount,
  run,
  runs,
  summary,
  onCancelRun,
  onStartDebate,
}: {
  escalation?: JsonRecord;
  events: RunEventRecord[];
  eventCount: number;
  run: RunRecord;
  runs: RunRecord[];
  summary: ReturnType<typeof summarizeRun>;
  onCancelRun: (runId: string) => void;
  onStartDebate: (branchId: string, escalation: JsonRecord) => void;
}) {
  const output = run.output ?? {};
  const input = run.input ?? {};
  const finalDecision = isJsonRecord(output.finalDecision)
    ? output.finalDecision
    : undefined;
  const error = readDisplay(output.error, "");
  const decision = readDisplay(output.decision, "");
  const action = readDisplay(finalDecision?.action ?? output.action, "");
  const confidence = formatConfidenceValue(finalDecision?.confidence ?? output.confidence);
  const escalationSummary = escalation
    ? compactValue(
        escalation.summary ??
          escalation.heartbeatSummary ??
          (isJsonRecord(escalation.heartbeatOutput)
            ? escalation.heartbeatOutput.summary
            : undefined),
        "Escalation packet available.",
      )
    : "No escalation packet.";
  const statusTone = run.status === "failed" ? "danger" : "default";

  return (
    <article className={`monitoring-detail-card ${run.status}`}>
      <div className="monitoring-detail-hero">
        <div>
          <span className="section-kicker">
            <Icon name={run.status === "failed" ? "error" : run.kind === "debate" ? "forum" : "monitor_heart"} />
            {run.kind.toUpperCase()} / {run.status.toUpperCase()}
          </span>
          <h3>{summary.outcomeTitle}</h3>
          <p>{summary.outcome}</p>
        </div>
        <div className="monitoring-status-stack">
          <RunFact label="Decision" tone={statusTone} value={decision || action || "-"} />
          <RunFact label="Confidence" value={confidence} />
        </div>
      </div>

      <RunLifecyclePanel run={run} />
      {run.lifecycle?.cancelable && (
        <button
          className="command-button danger-outline"
          onClick={() => onCancelRun(run.id)}
          type="button"
        >
          <Icon name="cancel" /> CANCEL RUN
        </button>
      )}
      <TruthLedgerPanel events={events} run={run} runs={runs} summary={summary} />

      <div className="monitoring-detail-grid">
        <section className="monitoring-detail-section">
          <div className="section-title">RUN</div>
          <div className="monitoring-detail-list">
            <DetailRow label="Branch" value={summary.branchLabel} />
            <DetailRow label="Run ID" value={run.id} />
            <DetailRow label="Created" value={formatDateTime(run.createdAt)} />
            <DetailRow label="Updated" value={formatDateTime(run.updatedAt)} />
            <DetailRow label="Events" value={String(eventCount)} />
          </div>
        </section>

        <section className="monitoring-detail-section">
          <div className="section-title">CONTEXT</div>
          <div className="monitoring-detail-list">
            <DetailRow label="Input Source" value={compactValue(run.metadata?.source ?? input.source)} />
            <DetailRow label="Branch ID" value={readDisplay(run.branchId, "-")} />
            <DetailRow label="Escalation" value={escalationSummary} />
            {error && <DetailRow label="Error" tone="danger" value={error} />}
          </div>
        </section>
      </div>

      {run.kind === "heartbeat" && (
        <HeartbeatHandoffPanel
          escalation={escalation}
          run={run}
          onStartDebate={onStartDebate}
        />
      )}

      <details className="raw-details compact">
        <summary>Raw run packet</summary>
        <pre className="event-json">
          {JSON.stringify({ input: run.input, output: run.output ?? {} }, null, 2)}
        </pre>
      </details>
    </article>
  );
}

function DetailRow({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "default" | "danger";
  value: string;
}) {
  return (
    <div className={`monitoring-detail-row ${tone}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function TruthLedgerPanel({
  events,
  run,
  runs,
  summary,
}: {
  events: RunEventRecord[];
  run: RunRecord;
  runs: RunRecord[];
  summary: ReturnType<typeof summarizeRun>;
}) {
  const childRunIds = run.lifecycle?.childRunIds ?? [];
  const childRuns = childRunIds
    .map((id) => runs.find((item) => item.id === id))
    .filter((item): item is RunRecord => Boolean(item));
  const failedEvents = events.filter((event) =>
    event.type.includes("failed") || event.type === "run.failed",
  );
  const routerBranches = Array.isArray(run.output?.branchIds)
    ? run.output.branchIds.filter((item): item is string => typeof item === "string")
    : [];
  const heartbeatFailures = Array.isArray(run.output?.heartbeatFailures)
    ? run.output.heartbeatFailures.filter(isJsonRecord)
    : [];
  const affected = [
    run.branchId ? summary.branchLabel : undefined,
    routerBranches.length > 0 ? `${routerBranches.length} routed branches` : undefined,
    childRuns.length > 0 ? `${childRuns.length} child runs` : undefined,
  ].filter(Boolean).join(" / ") || "-";
  const nextAction = nextActionForRun(run, failedEvents, childRuns);

  return (
    <section className="truth-ledger">
      <div className="section-title">TRUTH LEDGER</div>
      <div className="truth-ledger-grid">
        <DetailRow label="What happened" value={summary.outcome} />
        <DetailRow
          label="What failed"
          tone={failedEvents.length > 0 || run.status === "failed" ? "danger" : "default"}
          value={
            run.status === "failed"
              ? readDisplay(run.output?.error, "Run failed.")
              : failedEvents.length > 0
                ? `${failedEvents.length} failure event${failedEvents.length === 1 ? "" : "s"}`
                : "No failures recorded."
          }
        />
        <DetailRow label="Affected" value={affected} />
        <DetailRow label="What can I do" value={nextAction} />
      </div>
      {(heartbeatFailures.length > 0 || childRuns.length > 0) && (
        <div className="child-run-list">
          {heartbeatFailures.map((failure, index) => (
            <div className="child-run-row failed" key={`failure-${index}`}>
              <span>{readDisplay(failure.branchId, "Branch")}</span>
              <b>{readDisplay(failure.error, "Heartbeat failed.")}</b>
            </div>
          ))}
          {childRuns.map((childRun) => (
            <div className={`child-run-row ${childRun.status}`} key={childRun.id}>
              <span>{childRun.kind} {childRun.id.slice(0, 8)}</span>
              <b>{summarizeRun(childRun).outcome}</b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function nextActionForRun(
  run: RunRecord,
  failedEvents: RunEventRecord[],
  childRuns: RunRecord[],
): string {
  if (run.lifecycle?.cancelable) return "Cancel if this is stale, or wait for the next event.";
  if (run.status === "failed") return "Inspect the failure, fix readiness/configuration, then retry.";
  if (failedEvents.length > 0) return "Inspect failed child events before trusting this run.";
  if (run.kind === "heartbeat" && getHeartbeatEscalation(run)) return "Start debate from the heartbeat packet.";
  if (run.kind === "router" && childRuns.some((child) => child.status === "failed")) {
    return "Open failed child heartbeats and fix branch/model readiness.";
  }
  if (run.kind === "debate") return "Review the final decision, transcript, and trading policy events.";
  return "No immediate action required.";
}

function MonitoringSummaryBar({
  branchBreakdowns,
  stats,
  onSelectRun,
}: {
  branchBreakdowns: ReturnType<typeof createBranchRunBreakdowns>;
  stats: ReturnType<typeof createMonitoringStats>;
  onSelectRun: (runId: string) => void;
}) {
  return (
    <section className="monitoring-summary">
      <div className="monitoring-health-grid">
        <RunFact label="Runs" value={String(stats.totalRuns)} />
        <RunFact label="Branches" value={String(stats.activeBranches)} />
        <RunFact label="Debates" value={String(stats.debateRuns)} />
        <RunFact label="Failures" tone={stats.failedRuns > 0 ? "danger" : "default"} value={String(stats.failedRuns)} />
      </div>
      {branchBreakdowns.length > 0 && (
        <div className="monitoring-branch-row">
          {branchBreakdowns.slice(0, 5).map((item) => (
            <button
              className="monitoring-branch-chip"
              disabled={!item.latestRun}
              key={item.branchId}
              onClick={() => {
                if (item.latestRun) onSelectRun(item.latestRun.id);
              }}
              type="button"
            >
              <span>{item.branchLabel}</span>
              <b>{item.totalCount}</b>
            </button>
          ))}
        </div>
      )}
    </section>
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

function RunOverviewPanel({
  eventCount,
  run,
  summary,
}: {
  eventCount: number;
  run: RunRecord;
  summary: ReturnType<typeof summarizeRun>;
}) {
  return (
    <article className={`monitoring-overview ${run.status}`}>
      <div className="monitoring-overview-head">
        <span>
          <Icon name={run.status === "failed" ? "error" : run.kind === "debate" ? "forum" : "monitor_heart"} />
          {run.kind.toUpperCase()} RUN
        </span>
        <b>{run.status}</b>
      </div>
      <p>{summary.outcome}</p>
      <div className="monitoring-facts">
        <RunFact label="Branch" value={summary.branchLabel} />
        <RunFact label="Events" value={String(eventCount)} />
        <RunFact label="Updated" value={formatDateTime(run.updatedAt)} />
      </div>
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
                  ? "TRADING ONLINE"
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
            emptyMessage="No positions."
            rows={positions.map((position) => [
              readDisplay(position.symbol),
              readDisplay(position.qty),
              formatMoneyField(position, "market_value", "marketValue"),
              formatMoneyField(position, "unrealized_pl", "unrealizedPl"),
              readDisplay(position.side),
            ])}
            title="POSITIONS"
          />
          <PortfolioTable
            columns={["SYMBOL", "SIDE", "TYPE", "STATUS", "NOTIONAL", "SUBMITTED"]}
            emptyMessage="No orders."
            rows={orders.map((order) => [
              readDisplay(order.symbol),
              readDisplay(order.side),
              readDisplay(order.type ?? order.order_type ?? order.orderType),
              readDisplay(order.status),
              formatMoneyValue(order.notional ?? order.filled_notional ?? order.filledNotional),
              formatTimestamp(order.submitted_at ?? order.submittedAt ?? order.createdAt ?? order.created_at),
            ])}
            title="ORDERS"
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
  loadState,
  onCancelRun,
  runs,
  selectedRun,
  onSelectRun,
}: {
  branches: BranchRecord[];
  events: RunEventRecord[];
  loadState: LoadState;
  onCancelRun: (runId: string) => void;
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
          {loadState === "loading" ? (
            <EmptyPanel
              icon="hourglass_top"
              message="Loading run records."
              title="Loading Runs"
            />
          ) : runs.length === 0 ? (
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
            message={
              loadState === "loading"
                ? "Loading selected run..."
                : "Choose a run."
            }
            title="No Run Selected"
          />
        ) : (
          <div className="run-deep-grid">
            <section className="trace-section full">
              <div className="section-title">RUN SUMMARY</div>
              <div className="run-summary-grid">
                <RunFact label="Status" tone={selectedRun.status === "failed" ? "danger" : "default"} value={selectedRun.status} />
                <RunFact label="Kind" value={selectedRun.kind} />
                <RunFact label="Stage" value={selectedRun.lifecycle?.stage ?? selectedRun.status} />
                <RunFact label="Branch" value={selectedRunSummary.branchLabel} />
                <RunFact label="Created" value={formatDateTime(selectedRun.createdAt)} />
                <RunFact label="Updated" value={formatDateTime(selectedRun.updatedAt)} />
              </div>
              <RunLifecyclePanel run={selectedRun} />
              {selectedRun.lifecycle?.cancelable && (
                <button
                  className="command-button danger-outline"
                  onClick={() => onCancelRun(selectedRun.id)}
                  type="button"
                >
                  <Icon name="cancel" /> CANCEL RUN
                </button>
              )}
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

function RunLifecyclePanel({ run }: { run: RunRecord }) {
  const lifecycle = run.lifecycle;
  const childRunIds = lifecycle?.childRunIds ?? [];
  const stage = lifecycle?.stage ?? run.status;
  const currentOperation =
    lifecycle?.currentOperation ?? `${run.kind} workflow is ${run.status}.`;

  return (
    <section className="run-lifecycle-panel">
      <div className="section-title">LIFECYCLE</div>
      <div className="run-lifecycle-grid">
        <RunFact label="Stage" value={stage} />
        <RunFact label="Operation" value={currentOperation} />
        <RunFact
          label="Elapsed"
          value={formatDuration(lifecycle?.elapsedMs ?? elapsedMs(run))}
        />
        <RunFact
          label="Last Event"
          value={lifecycle?.lastEventAt ? formatDateTime(lifecycle.lastEventAt) : "-"}
        />
        <RunFact
          label="Parent"
          value={lifecycle?.parentRunId ?? "-"}
        />
        <RunFact
          label="Children"
          value={String(childRunIds.length)}
        />
        <RunFact
          label="Blocking Service"
          tone={lifecycle?.blockingExternalService ? "danger" : "default"}
          value={lifecycle?.blockingExternalService ?? "-"}
        />
        <RunFact
          label="Retryable"
          value={lifecycle?.retryable ? "yes" : "no"}
        />
        <RunFact
          label="Cancelable"
          value={lifecycle?.cancelable ? "yes" : "no"}
        />
      </div>
      {(lifecycle?.parentRunId || childRunIds.length > 0) && (
        <div className="run-lifecycle-links">
          {lifecycle?.parentRunId && (
            <span>Parent run: {lifecycle.parentRunId}</span>
          )}
          {childRunIds.length > 0 && (
            <span>Child runs: {childRunIds.join(", ")}</span>
          )}
        </div>
      )}
    </section>
  );
}

function CapabilityPreflightPanel({
  loadState,
  preflight,
}: {
  loadState: LoadState;
  preflight?: CapabilityPreflight;
}) {
  const status = loadState === "loading"
    ? "checking"
    : preflight?.status ?? "offline";
  const checks = preflight?.checks ?? [];

  return (
    <section className={`capability-panel ${status}`}>
      <div className="capability-head">
        <div>
          <div className="section-title">ACTION READINESS</div>
          <h2>{status === "ready" ? "Ready" : status === "warning" ? "Ready with warnings" : status === "blocked" ? "Blocked" : status}</h2>
        </div>
        <span>{preflight?.checkedAt ? formatDateTime(preflight.checkedAt) : "-"}</span>
      </div>
      <div className="capability-grid">
        {loadState === "loading" ? (
          <RunFact label="Preflight" value="checking" />
        ) : checks.length === 0 ? (
          <RunFact label="Preflight" tone="danger" value="unavailable" />
        ) : (
          checks.map((check) => (
            <div className={`capability-check ${check.status}`} key={check.id}>
              <b>{check.label}</b>
              <span>{check.status}</span>
              <p>{check.detail}</p>
            </div>
          ))
        )}
      </div>
    </section>
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
  const summary = compactValue(output.summary, "");
  const decision = compactValue(output.decision, "");
  const finalDecision = isJsonRecord(output.finalDecision)
    ? output.finalDecision
    : undefined;
  const action = compactValue(finalDecision?.action ?? output.action, "");
  const confidence = formatConfidenceValue(finalDecision?.confidence ?? output.confidence);
  const routerResponse = run.kind === "router" ? compactValue(output.response, "") : "";
  const routedBranches = Array.isArray(output.branchIds)
    ? output.branchIds.filter((branchId): branchId is string => typeof branchId === "string")
    : [];
  const heartbeatFailures = Array.isArray(output.heartbeatFailures)
    ? output.heartbeatFailures.length
    : 0;
  const outcome =
    error ||
    summary ||
    routerResponse ||
    decision ||
    action ||
    (run.kind === "router" && routedBranches.length > 0
      ? `Routed to ${routedBranches.length} branch${routedBranches.length === 1 ? "" : "es"}.`
      : "No output recorded.");

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
      { label: "Summary", value: summary || routerResponse || "-" },
      ...(run.kind === "router"
        ? [
            { label: "Branches Routed", value: String(routedBranches.length) },
            { label: "Heartbeat Failures", value: String(heartbeatFailures) },
          ]
        : []),
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
  capabilityLoadState,
  capabilityPreflight,
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
  capabilityLoadState: LoadState;
  capabilityPreflight?: CapabilityPreflight;
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
    enabled: boolean;
    lawText: string;
  }) => void;
}) {
  const [config, setConfig] = useState<WebBranchConfig>(() =>
    normalizeBranchConfig(branch),
  );
  const [branchName, setBranchName] = useState(branch.name);
  const [lawText, setLawText] = useState(readLawText(branch));
  const [enabled, setEnabled] = useState(branch.enabled);
  const [draftVersion, setDraftVersion] = useState(0);

  function resetDraft() {
    const nextConfig = cloneBranchConfig(normalizeBranchConfig(branch));
    setConfig(nextConfig);
    setBranchName(branch.name);
    setLawText(readLawText(branch));
    setEnabled(branch.enabled);
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
  const heartbeatBlocked = capabilityPreflight?.checks.some((check) =>
    check.status === "blocked" &&
    ["branch", "law", "openrouter_key"].includes(check.id)
  ) ?? capabilityLoadState !== "api";
  const debateBlocked = capabilityPreflight?.checks.some((check) =>
    check.status === "blocked" &&
    ["branch", "law", "openrouter_key"].includes(check.id)
  ) ?? capabilityLoadState !== "api";

  return (
    <main className="config-canvas">
      <div className="editor-head sticky">
        <div>
          <h1>Branch Configuration</h1>
        </div>
        <div className="button-row">
          <button className="command-button" disabled={heartbeatBlocked} onClick={onRunHeartbeat} type="button">
            <Icon name="play_arrow" /> RUN HEARTBEAT
          </button>
          <button className="command-button primary-outline" disabled={debateBlocked} onClick={onEscalate} type="button">
            <Icon name="forum" /> START DEBATE
          </button>
          <button
            className="command-button danger-outline"
            onClick={resetDraft}
            type="button"
          >
            DISCARD
          </button>
          <button
            className="command-button primary"
            onClick={() => onSave({ branchName, config, enabled, lawText })}
            type="button"
          >
            SAVE CONFIGURATION
          </button>
        </div>
      </div>
      <div className="config-body" key={draftVersion}>
        <CapabilityPreflightPanel
          loadState={capabilityLoadState}
          preflight={capabilityPreflight}
        />
        <div className="config-grid">
          <FieldLabel label="Branch Name">
            <input
              onChange={(event) => setBranchName(event.target.value)}
              placeholder="Name this monitoring branch."
              value={branchName}
            />
          </FieldLabel>
          <label className="checkbox-card compact">
            <input
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              type="checkbox"
            />
            <span>
              <b>Branch enabled</b>
              <small>Allows scheduled monitoring and router wakeups.</small>
            </span>
          </label>
        </div>
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
  const canAddQuery =
    normalizedQuery.length > 0 &&
    !options.some((option) => option.symbol === normalizedQuery);
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
    onChange(normalizeSymbolSelection(next, mergeSymbolSelection(optionSymbols, [symbol])));
  }

  return (
    <div className="trade-symbol-lookup">
      <input
        className="multi-select-search"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search Nasdaq symbols"
        value={query}
      />
      <details className="multi-select" open={Boolean(normalizedQuery)}>
        <summary>{summary}</summary>
        <div className="multi-select-menu">
        {activeLoadState === "loading" && (
          <span className="empty-option">Looking up symbols.</span>
        )}
        {activeLoadState === "offline" && activeCatalog.length === 0 && (
          <span className="empty-option">Symbol lookup unavailable. Add tracked tickers manually.</span>
        )}
        {canAddQuery && (
          <label className="symbol-option">
            <input
              checked={selectedSet.has(normalizedQuery)}
              onChange={(event) => toggle(normalizedQuery, event.target.checked)}
              type="checkbox"
            />
            <span className="symbol-option-main">
              <b>{normalizedQuery}</b>
              <small>Add custom ticker</small>
            </span>
          </label>
        )}
        {visibleOptions.length === 0 && !canAddQuery ? (
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
    </div>
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
  const snapshot =
    selectedEvidence?.payload ??
    (run?.output
      ? {
          kind: "run_output",
          output: run.output,
          input: run.input,
        }
      : run?.input
        ? {
            kind: "run_input",
            input: run.input,
          }
        : undefined);
  const sourceTitle =
    selectedEvidence?.id ??
    (run ? `${run.kind} ${run.id.slice(0, 8)}` : "RUN PAYLOAD");
  const sourceType = selectedEvidence?.type ?? (run?.output ? "run.output" : run?.kind ?? "record");

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
            message="Select a run to inspect its output, input, or tool evidence."
          />
        ) : (
          <>
            <div className="source-card">
              <div className="field-label">SOURCE</div>
              <h1>{sourceTitle}</h1>
              <div className="source-tags">
                <span>{sourceType}</span>
                <span>{run?.status ?? "loaded"}</span>
              </div>
            </div>
            <div className="field-label">TIMELINE</div>
            <div className="alignment-row">
              <span>Run Created</span>
              <b>{run ? formatDateTime(run.createdAt) : "-"}</b>
            </div>
            <div className="alignment-row">
              <span>Last Event</span>
              <b>{events.at(-1) ? formatDateTime(events.at(-1)!.timestamp) : "-"}</b>
            </div>
            <details className="raw-details evidence-raw" open>
              <summary>Details</summary>
              <pre className="json-block">{JSON.stringify(snapshot, null, 2)}</pre>
            </details>
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

function EventRecordCard({ event }: { event: RunEventRecord }) {
  const actor = eventActor(event);
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
  if (event.type === "debate.message" && isJsonRecord(event.payload)) {
    const messageType = readDisplay(event.payload.messageType, "message");
    const argument = readDisplay(event.payload.argument, "");
    const summary = readDisplay(event.payload.summary, "");
    return compactValue(
      argument.length > 0
        ? argument
        : summary.length > 0
          ? summary
          : `${messageType} from ${readDisplay(event.payload.agentName, "agent")}`,
      `DEBATE ${messageType}`,
    );
  }

  if (event.type === "participant.responded" && isJsonRecord(event.payload)) {
    const role = readDisplay(event.payload.role, "participant");
    const argumentLength = readDisplay(event.payload.argumentLength, "0");
    const confidence = readDisplay(event.payload.confidence, "");
    return compactValue(
      `Role=${role}, arguments=${argumentLength} chars` + (confidence ? `, confidence=${confidence}` : ""),
      `Response from ${role}`,
    );
  }

  if (event.type.startsWith("model.call.") && isJsonRecord(event.payload)) {
    const role = readDisplay(event.payload.role, "model");
    return compactValue(
      `${role} model call ${event.type.includes("completed") ? "completed" : "started"}`,
      `${titleize(event.type)} (${role})`,
    );
  }

  if (event.type.startsWith("tool.call.") && isJsonRecord(event.payload)) {
    const toolName = readDisplay(event.payload.toolName, "tool");
    const requestedBy = readDisplay(event.payload.requestedBy, "");
    return compactValue(
      `Tool ${toolName} ${event.type.includes("completed") ? "completed" : "started"}` +
        (requestedBy ? ` for ${requestedBy}` : ""),
      `${titleize(event.type)} (${toolName})`,
    );
  }

  if (event.type.startsWith("run.")) {
    const status = readDisplay(event.payload.status, "");
    return compactValue(status || event.payload.reason, titleize(event.type));
  }

  return compactValue(
    event.payload.summary ??
      event.payload.message ??
      event.payload.error ??
      event.payload.decision ??
      event.payload.status,
    titleize(event.type),
  );
}

function eventActor(event: RunEventRecord): string {
  if (event.type.startsWith("human.")) {
    return "HUMAN";
  }

  if (event.type === "participant.responded" && isJsonRecord(event.payload)) {
    return String(event.payload.role ?? "participant").toUpperCase();
  }

  if (event.type === "debate.message" && isJsonRecord(event.payload)) {
    return String(event.payload.agentName ?? "debate").toUpperCase();
  }

  return event.type.split(".")[0].toUpperCase();
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
  onActionClick,
  onActionIconClick,
}: {
  icon?: string;
  title: string;
  meta: string;
  action?: string;
  actionIcon?: string;
  actionIconLabel?: string;
  onActionClick?: () => void;
  onActionIconClick?: () => void;
}) {
  return (
    <div className="pane-head">
      <div>
        <h2>{icon && <Icon name={icon} />} {title}</h2>
        {meta && <div>{meta}</div>}
      </div>
      {action && (
        <button
          className="command-button compact"
          disabled={!onActionClick}
          onClick={onActionClick}
          type="button"
        >
          {action}
        </button>
      )}
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
  info,
  children,
}: {
  label: string;
  info?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <InfoLabel info={info} label={label} />
      {children}
    </label>
  );
}

function InfoLabel({ label, info }: { label: string; info?: string }) {
  return (
    <span className="field-label info-label">
      {label}
      {info && <InfoIcon label={info} />}
    </span>
  );
}

function InfoIcon({ label }: { label: string }) {
  return (
    <span className="info-icon" aria-label={label} role="img" tabIndex={0}>
      <Icon name="info" />
    </span>
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
  info,
  onChange,
}: {
  label: string;
  value: string;
  info?: string;
  onChange?: (value: number) => void;
}) {
  const numericValue = Number(value.replace("%", ""));
  return (
    <div className="slider-block">
      <div>
        <InfoLabel info={info} label={label} />
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

function createDraftBranch(name: string): BranchRecord {
  const timestamp = new Date().toISOString();
  return {
    id: createBranchId(),
    name,
    description: "",
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    law: { thesis: "" },
    config: defaultBranchConfig(),
    metadata: { localDraft: true },
  };
}

function isLocalDraftBranch(branch: BranchRecord | undefined): boolean {
  return branch?.metadata?.localDraft === true;
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

function sortRunsByCreatedAt(runs: RunRecord[]): RunRecord[] {
  return [...runs].sort(
    (left, right) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
      right.id.localeCompare(left.id),
  );
}

function createBranchRunBreakdowns(branches: BranchRecord[], runs: RunRecord[]) {
  const branchMap = new Map(branches.map((branch) => [branch.id, branch]));
  const branchIds = new Set([
    ...branches.map((branch) => branch.id),
    ...runs.map((run) => run.branchId).filter((branchId): branchId is string => Boolean(branchId)),
  ]);

  return [...branchIds]
    .map((branchId) => {
      const branchRuns = sortRunsByCreatedAt(runs.filter((run) => run.branchId === branchId));
      return {
        branchId,
        branchLabel: branchMap.get(branchId)?.name ?? branchId,
        latestRun: branchRuns[0],
        totalCount: branchRuns.length,
        heartbeatCount: branchRuns.filter((run) => run.kind === "heartbeat").length,
        debateCount: branchRuns.filter((run) => run.kind === "debate").length,
        runningCount: branchRuns.filter((run) => run.status === "running").length,
      };
    })
    .filter((item) => item.totalCount > 0)
    .sort(
      (left, right) =>
        Date.parse(right.latestRun?.createdAt ?? "0") -
          Date.parse(left.latestRun?.createdAt ?? "0") ||
        left.branchLabel.localeCompare(right.branchLabel),
    );
}

function createMonitoringStats(
  runs: RunRecord[],
  branchBreakdowns: ReturnType<typeof createBranchRunBreakdowns>,
) {
  return {
    totalRuns: runs.length,
    activeBranches: branchBreakdowns.length,
    debateRuns: runs.filter((run) => run.kind === "debate").length,
    failedRuns: runs.filter((run) => run.status === "failed").length,
  };
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
      autoTradeEnabled:
        config.trading?.autoTradeEnabled ?? config.trading?.paperAutoBuyEnabled ?? false,
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
  if (Array.isArray(value)) {
    if (value.length === 0) return fallback;
    return `${value.length} items`;
  }
  if (isJsonRecord(value)) {
    const summary =
      "summary" in value && value.summary
        ? compactString(value.summary, 90)
        : "error" in value && value.error
          ? compactString(value.error, 90)
          : "message" in value && value.message
            ? compactString(value.message, 90)
            : "name" in value && value.name
              ? compactString(value.name, 90)
              : "id" in value && value.id
                ? compactString(value.id, 90)
                : "branchId" in value && value.branchId
                  ? compactString(value.branchId, 90)
                  : undefined;

    if (summary) return summary;

    const keys = Object.keys(value);
    return keys.length === 0 ? fallback : `${keys.length} fields`;
  }
  return fallback;
}

function compactString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
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

function getTradingActionMode(trading: BranchTradingConfig): TradingActionMode {
  const mode = trading.mode ?? "disabled";
  const tradingEnabled = mode === "enabled" || mode === "paper";
  const notifyEnabled = trading.notifyOnBuySignal ?? !tradingEnabled;

  if (tradingEnabled && notifyEnabled) return "both";
  if (tradingEnabled) return "enable_trading";
  return "notify";
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

function elapsedMs(run: RunRecord): number {
  return Math.max(0, Date.parse(run.updatedAt) - Date.parse(run.createdAt));
}

function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "-";
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function titleize(value: string) {
  return value
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
