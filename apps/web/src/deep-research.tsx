import type { KairosReasoningEffort } from "../../../src/global/agent-config.js";

import { useEffect, useMemo, useRef, useState } from "react";
import Select, { components, type StylesConfig } from "react-select";

import type { RouterToolCallRecord } from "./api";
import {
  createDeepResearchChat,
  getDeepResearchChats,
  getDeepResearchMessages,
  deleteDeepResearchChat,
  getDeepResearchModels,
  sendDeepResearchMessage,
  sendDeepResearchMessageStream,
  type DeepResearchChatRecord,
  type DeepResearchImageAttachment,
  type DeepResearchMessageRecord,
  type DeepResearchModelOption,
  type DeepResearchStreamEvent,
} from "./deep-research-api";
import { MarkdownText } from "./MarkdownText";
import "./deep-research.css";

type LoadState = "loading" | "api" | "offline";
type DeepResearchReasoningEffort = "auto" | KairosReasoningEffort;
type DeepResearchModelSelectOption = DeepResearchModelOption & {
  value: string;
};

export function DeepResearchView() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modelState, setModelState] = useState<LoadState>("loading");
  const [chats, setChats] = useState<DeepResearchChatRecord[]>([]);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [messages, setMessages] = useState<DeepResearchMessageRecord[]>([]);
  const [models, setModels] = useState<DeepResearchModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<DeepResearchReasoningEffort>("auto");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<DeepResearchImageAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeModel = useMemo(
    () => models.find((model) => model.id === selectedModel) ?? models[0],
    [models, selectedModel],
  );

  useEffect(() => {
    void refreshModels();
    void refreshChats();
  }, []);

  useEffect(() => {
    setError("");
    if (!selectedChatId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    getDeepResearchMessages(selectedChatId)
      .then((nextMessages) => {
        if (!cancelled) {
          setMessages(nextMessages);
          setLoadState("api");
        }
      })
      .catch(() => {
        if (!cancelled) setLoadState("offline");
      });

    return () => {
      cancelled = true;
    };
  }, [selectedChatId]);

  async function refreshModels() {
    setModelState("loading");
    try {
      const response = await getDeepResearchModels();
      setModels(response.models);
      setSelectedModel((current) =>
        current && response.models.some((model) => model.id === current)
          ? current
          : response.defaultModel,
      );
      setModelState("api");
    } catch {
      setModels([]);
      setModelState("offline");
    }
  }

  async function refreshChats() {
    setLoadState("loading");
    try {
      const nextChats = await getDeepResearchChats();
      setChats(nextChats);
      setSelectedChatId((current) =>
        current && nextChats.some((chat) => chat.id === current)
          ? current
          : nextChats[0]?.id ?? "",
      );
      setLoadState("api");
    } catch {
      setChats([]);
      setLoadState("offline");
    }
  }

  async function startChat() {
    setError("");
    try {
      const chat = await createDeepResearchChat();
      setChats((current) => [chat, ...current]);
      setSelectedChatId(chat.id);
      setMessages([]);
      setLoadState("api");
    } catch {
      setLoadState("offline");
    }
  }

  async function deleteChat(chatId: string) {
    const targetChat = chats.find((chat) => chat.id === chatId);
    const confirmed = window.confirm(
      `Delete deep research chat "${targetChat?.title ?? "Untitled"}"? This will remove its messages too.`,
    );
    if (!confirmed) return;

    try {
      await deleteDeepResearchChat(chatId);
      const remainingChats = chats.filter((chat) => chat.id !== chatId);
      setChats(remainingChats);
      if (selectedChatId === chatId) {
        const nextChatId = remainingChats[0]?.id ?? "";
        setSelectedChatId(nextChatId);
        setMessages([]);
      }
      setLoadState("api");
    } catch {
      setLoadState("offline");
    }
  }

  async function submit() {
    if ((!draft.trim() && attachments.length === 0) || running) return;

    let chatId = selectedChatId;
    const submittedText = draft.trim();
    const submittedAttachments = attachments;
    const submittedReasoningEffort =
      reasoningEffort === "auto" ? undefined : reasoningEffort;
    let pendingUserMessageId = "";
    let pendingAssistantMessageId = "";
    setRunning(true);
    setError("");
    try {
      if (!chatId) {
        const chat = await createDeepResearchChat();
        chatId = chat.id;
        setChats((current) => [chat, ...current]);
        setSelectedChatId(chat.id);
      }

      const pendingUserMessage: DeepResearchMessageRecord = {
        id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        chatId,
        role: "user",
        createdAt: new Date().toISOString(),
        text: submittedText,
        attachments: submittedAttachments,
      };
      pendingUserMessageId = pendingUserMessage.id;
      setMessages((current) => [...current, pendingUserMessage]);

      const pendingAssistantMessage: DeepResearchMessageRecord = {
        id: `pending-assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        chatId,
        role: "assistant",
        createdAt: new Date().toISOString(),
        model: selectedModel,
        reasoningEffort: submittedReasoningEffort,
        text: "",
        reasoning: "",
        toolCalls: [],
      };
      pendingAssistantMessageId = pendingAssistantMessage.id;
      let assistantDraftText = "";
      let assistantDraftReasoning = "";
      setMessages((current) => [...current, pendingAssistantMessage]);

      let finalized = false;
      const setAssistantDraft = (draft: {
        text?: string;
        reasoning?: string;
        toolCalls?: RouterToolCallRecord[];
      }) => {
        setMessages((current) =>
          current.map((message) =>
            message.id === pendingAssistantMessage.id
              ? { ...message, ...draft, role: "assistant", chatId }
              : message,
          ),
        );
      };

      const applyResult = (
        userMessage: DeepResearchMessageRecord,
        assistantMessage: DeepResearchMessageRecord,
        nextChat?: DeepResearchChatRecord,
      ) => {
        finalized = true;
        setDraft("");
        setAttachments([]);
        setMessages((current) => [
          ...current.filter(
            (message) =>
              message.id !== pendingUserMessage.id &&
              message.id !== pendingAssistantMessage.id,
          ),
          userMessage,
          assistantMessage,
        ]);
        if (nextChat) {
          setChats((current) =>
            current.map((chatItem) =>
              chatItem.id === chatId
                ? {
                    ...chatItem,
                    title: nextChat.title ?? chatItem.title ?? buildTitle(userMessage.text),
                    updatedAt: assistantMessage.createdAt,
                  }
                : chatItem,
            ),
          );
        }
        setLoadState("api");
      };

      const applyStreamingEvent = (event: DeepResearchStreamEvent) => {
        if (event.type === "assistant_delta") {
          assistantDraftText += event.text;
          setAssistantDraft({ text: assistantDraftText });
          return;
        }
        if (event.type === "assistant_reasoning") {
          assistantDraftReasoning += event.text;
          setAssistantDraft({
            reasoning: assistantDraftReasoning,
          });
          return;
        }
        if (event.type === "assistant_tool") {
          setMessages((current) =>
            current.map((message) =>
              message.id === pendingAssistantMessage.id
                ? {
                    ...message,
                    toolCalls: [
                      ...(message.toolCalls ?? []).filter((toolCall) => toolCall.id !== event.toolCall.id),
                      event.toolCall,
                    ],
                  }
                : message,
            ),
          );
          return;
        }
        if (event.type === "assistant_final" || event.type === "assistant_error") {
          applyResult(event.userMessage, event.assistantMessage, event.chat);
        }
      };

      try {
        for await (const event of sendDeepResearchMessageStream({
          chatId,
          text: submittedText,
          model: selectedModel,
          reasoningEffort: submittedReasoningEffort,
          attachments: submittedAttachments,
        })) {
          applyStreamingEvent(event);
        }
      } catch {
        const result = await sendDeepResearchMessage({
          chatId,
          text: submittedText,
          model: selectedModel,
          reasoningEffort: submittedReasoningEffort,
          attachments: submittedAttachments,
        });

        applyResult(result.userMessage, result.assistantMessage, result.chat);
      }

      if (!finalized) {
        const recoveredMessages = await getDeepResearchMessages(chatId);
        const userIndex = findSubmittedUserMessageIndex(
          recoveredMessages,
          submittedText,
        );
        const recoveredUserMessage =
          userIndex >= 0 ? recoveredMessages[userIndex] : undefined;
        const recoveredAssistantMessage =
          userIndex >= 0
            ? recoveredMessages
                .slice(userIndex + 1)
                .find((message) => message.role === "assistant")
            : [...recoveredMessages]
                .reverse()
                .find((message) => message.role === "assistant");
        if (recoveredUserMessage && recoveredAssistantMessage) {
          finalized = true;
          setDraft("");
          setAttachments([]);
          setMessages(recoveredMessages);
          const nextChats = await getDeepResearchChats();
          setChats(nextChats);
          setLoadState("api");
        }
      }

      if (!finalized) {
        throw new Error("Deep Research streaming did not complete.");
      }

      setLoadState("api");
    } catch (sendError) {
      setMessages((current) =>
        current.filter(
          (message) =>
            message.id !== pendingUserMessageId &&
            message.id !== pendingAssistantMessageId,
        ),
      );
      setError(sendError instanceof Error ? sendError.message : "Deep Research failed.");
      setLoadState("api");
    } finally {
      setRunning(false);
    }
  }

  async function addImageFiles(files: FileList | File[]) {
    const imageFiles = [...files].filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    setError("");
    const nextAttachments = await Promise.all(
      imageFiles.slice(0, Math.max(0, 6 - attachments.length)).map(fileToAttachment),
    );
    setAttachments((current) => [...current, ...nextAttachments].slice(0, 6));
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  return (
    <main className="deep-research-canvas">
      <aside className="deep-research-sidebar">
        <div className="deep-research-brand">
          <div className="deep-research-logo" aria-hidden="true">
            <span className="material-symbols-outlined">travel_explore</span>
          </div>
          <div>
            <h2>Deep Research</h2>
            <p>Research workspace</p>
          </div>
        </div>
        <button
          className="command-button primary blue deep-research-new"
          onClick={() => void startChat()}
          type="button"
        >
          <span className="material-symbols-outlined">add</span>
          NEW CHAT
        </button>
        <div className="deep-research-chat-list">
          {chats.length === 0 ? (
            <div className="deep-research-empty">
              <span className="material-symbols-outlined">travel_explore</span>
              <b>No Research Chats</b>
              <p>Start a thread to investigate with memory and tools.</p>
            </div>
          ) : (
            chats.map((chat) => (
              <div
                className={`deep-research-chat-row ${chat.id === selectedChatId ? "active" : ""}`}
                key={chat.id}
              >
                <button
                  className={`deep-research-chat ${chat.id === selectedChatId ? "active" : ""}`}
                  onClick={() => setSelectedChatId(chat.id)}
                  type="button"
                >
                  <span>RESEARCH</span>
                  <b>{chat.title ?? "Untitled research"}</b>
                  <em>{formatChatTimestamp(chat.updatedAt)}</em>
                </button>
                <button
                  className="deep-research-chat-delete"
                  onClick={() => deleteChat(chat.id)}
                  type="button"
                  aria-label="Delete deep research chat"
                  title="Delete chat"
                >
                  <span className="material-symbols-outlined">delete</span>
                </button>
              </div>
            ))
          )}
        </div>
      </aside>
      <section className="deep-research-main">
        <header className="deep-research-head">
          <div>
            <h1>Deep Research Agent</h1>
            <p>Isolated chat workspace for market and product research.</p>
          </div>
          <div className="deep-research-controls">
            <span className={`source-pill ${loadState === "offline" || modelState === "offline" ? "warning" : loadState === "api" && modelState === "api" ? "online-blue" : ""}`}>
              {loadState === "loading" || modelState === "loading"
                ? "SYNCING"
                : loadState === "api" && modelState === "api"
                  ? "ONLINE"
                  : "OFFLINE"}
            </span>
            <ModelSelect
              model={activeModel}
              models={models}
              value={selectedModel}
              onChange={setSelectedModel}
            />
            <ReasoningSelect
              value={reasoningEffort}
              onChange={setReasoningEffort}
            />
          </div>
        </header>

        <div className="deep-research-transcript">
          {messages.length === 0 ? (
            <div className="deep-research-start">
              <span className="material-symbols-outlined">psychology_alt</span>
              <h2>Ask for a sourced investigation.</h2>
              <p>
                The agent can search Supermemory globally, inspect branch profiles,
                search current sources, and run deeper context-assisted review.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <DeepResearchMessage
                isProcessing={
                  running &&
                  message.role === "assistant" &&
                  message.id.startsWith("pending-assistant-") &&
                  !message.text?.trim()
                }
                message={message}
                key={message.id}
              />
            ))
          )}
        </div>

        {error && (
          <div className="deep-research-error">
            <span className="material-symbols-outlined">error</span>
            {error}
          </div>
        )}

        <footer
          className={`deep-research-composer ${dragActive ? "drag-active" : ""} ${running ? "processing" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDragActive(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            void addImageFiles(event.dataTransfer.files);
          }}
        >
          {attachments.length > 0 && (
            <div className="deep-attachment-strip">
              {attachments.map((attachment) => (
                <div className="deep-attachment" key={attachment.id}>
                  <img alt={attachment.name} src={attachment.dataUrl} />
                  <button
                    aria-label={`Remove ${attachment.name}`}
                    onClick={() => removeAttachment(attachment.id)}
                    type="button"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="deep-file-input"
            multiple
            onChange={(event) => {
              if (event.target.files) void addImageFiles(event.target.files);
              event.currentTarget.value = "";
            }}
            ref={fileInputRef}
            type="file"
          />
          <textarea
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="Start a new chat with your market research question."
            value={draft}
          />
          <button
            className="icon-button deep-attach-button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach images"
            type="button"
          >
            <span className="material-symbols-outlined">add_photo_alternate</span>
          </button>
          <button
            className="command-button primary blue"
            disabled={(!draft.trim() && attachments.length === 0) || running || !selectedModel}
            onClick={() => void submit()}
            type="button"
          >
            <span className="material-symbols-outlined">
              {running ? "hourglass_top" : "send"}
            </span>
            {running ? "RESEARCHING" : "SEND"}
          </button>
        </footer>
      </section>
    </main>
  );
}

function ModelSelect({
  model,
  models,
  value,
  onChange,
}: {
  model?: DeepResearchModelOption;
  models: DeepResearchModelOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const options = useMemo<DeepResearchModelSelectOption[]>(
    () => models.map((option) => ({ ...option, value: option.id })),
    [models],
  );
  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value],
  );

  return (
    <Select<DeepResearchModelSelectOption, false>
      className="deep-model-select"
      classNamePrefix="deep-model"
      value={selected}
      options={options}
      isSearchable={false}
      isDisabled={models.length === 0}
      onChange={(next) => onChange((next as DeepResearchModelSelectOption | null)?.value ?? "")}
      getOptionLabel={(option) => option.label}
      getOptionValue={(option) => option.value}
      formatOptionLabel={(option, { context }) =>
        context === "menu" ? (
          <span className="deep-model-option">
            <span className="deep-model-logo" aria-hidden="true">
              {option.logo}
            </span>
            <span className="deep-model-option-text">
              <span className="deep-model-option-title">{option.label}</span>
              <span className="deep-model-option-meta">
                {option.reasoningEffort ? `${option.reasoningEffort} effort` : "Model"}
              </span>
            </span>
          </span>
        ) : (
          <span className="deep-model-value">
            <span className="deep-model-logo" aria-hidden="true">
              {option.logo}
            </span>
            <span className="deep-model-option-text">
              <span className="deep-model-option-title">{option.label}</span>
              <span className="deep-model-option-meta">
                {option.reasoningEffort ? `${option.reasoningEffort} effort` : "Model"}
              </span>
            </span>
          </span>
        )
      }
      components={{
        IndicatorSeparator: () => null,
        DropdownIndicator: (props) => (
          <components.DropdownIndicator {...props}>
            <span className="material-symbols-outlined">keyboard_arrow_down</span>
          </components.DropdownIndicator>
        ),
      }}
      styles={deepModelSelectStyles}
      placeholder={model?.label ?? "Choose model"}
    />
  );
}

function ReasoningSelect({
  value,
  onChange,
}: {
  value: DeepResearchReasoningEffort;
  onChange: (value: DeepResearchReasoningEffort) => void;
}) {
  return (
    <label className="deep-research-reasoning-select-wrap">
      <span className="deep-research-reasoning-label">Reasoning</span>
      <select
        className="deep-research-reasoning-select"
        onChange={(event) => onChange(event.target.value as DeepResearchReasoningEffort)}
        value={value}
      >
        <option value="auto">Auto</option>
        <option value="none">None</option>
        <option value="minimal">Minimal</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="xhigh">X-High</option>
      </select>
    </label>
  );
}

function findSubmittedUserMessageIndex(
  messages: DeepResearchMessageRecord[],
  submittedText: string,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === "user" &&
      (message.text ?? "").trim() === submittedText.trim()
    ) {
      return index;
    }
  }

  return -1;
}

const deepModelSelectStyles: StylesConfig<DeepResearchModelSelectOption, false> = {
  control: (base: Record<string, unknown>) => ({
    ...base,
    backgroundColor: "var(--surface-lowest)",
    borderColor: "var(--outline-variant)",
    borderRadius: "var(--radius-md)",
    boxShadow: "none",
    cursor: "pointer",
    minHeight: "54px",
    paddingLeft: "6px",
    "&:hover": {
      borderColor: "var(--outline)",
    },
  }),
  menu: (base: Record<string, unknown>) => ({
    ...base,
    backgroundColor: "var(--surface-lowest)",
    border: "1px solid var(--outline-variant)",
    borderRadius: "var(--radius-md)",
    marginTop: "6px",
    overflow: "hidden",
  }),
  menuList: (base: Record<string, unknown>) => ({
    ...base,
    maxHeight: "280px",
    padding: "4px 4px 4px 6px",
    overflowY: "auto",
  }),
  option: (base: Record<string, unknown>, state: { isFocused: boolean; isSelected: boolean }) => ({
    ...base,
    backgroundColor: state.isFocused || state.isSelected
      ? "color-mix(in srgb, var(--surface) 55%, transparent)"
      : "transparent",
    borderRadius: "8px",
    color: "var(--on-surface)",
    cursor: "pointer",
    marginBottom: "2px",
    padding: "8px",
  }),
  singleValue: (base: Record<string, unknown>) => ({
    ...base,
    margin: "0",
    color: "var(--on-surface)",
  }),
  valueContainer: (base: Record<string, unknown>) => ({
    ...base,
    padding: "0",
  }),
  indicatorSeparator: () => ({
    display: "none",
  }),
  dropdownIndicator: (base: Record<string, unknown>) => ({
    ...base,
    color: "var(--on-variant)",
    padding: "0 8px 0 2px",
  }),
  indicatorsContainer: (base: Record<string, unknown>) => ({
    ...base,
    paddingRight: "2px",
  }),
} as const;

function DeepResearchMessage({
  isProcessing = false,
  message,
}: {
  isProcessing?: boolean;
  message: DeepResearchMessageRecord;
}) {
  const displayText = formatDeepResearchMessageText(message);
  const displayReasoning = formatDeepResearchReasoning(message.reasoning);
  const hasWorkflow =
    message.role === "assistant" &&
    ((typeof displayReasoning === "string" && displayReasoning.trim()) ||
      (message.toolCalls?.length ?? 0) > 0);
  const assistantMeta =
    message.role === "assistant"
      ? [
          message.model,
          message.reasoningEffort ? `${message.reasoningEffort} effort` : undefined,
        ]
          .filter(Boolean)
          .join(" • ") || formatChatTimestamp(message.createdAt)
      : formatChatTimestamp(message.createdAt);

  return (
    <article className={`deep-research-message ${message.role}`}>
      <div className="deep-research-message-head">
        <b>{message.role === "user" ? "YOU" : "DEEP RESEARCH"}</b>
        <span>{assistantMeta}</span>
      </div>
      {isProcessing ? <DeepResearchProcessing /> : <MarkdownText text={displayText} />}
      {message.attachments && message.attachments.length > 0 && (
        <div className="deep-message-images">
          {message.attachments.map((attachment) => (
            <img alt={attachment.name} key={attachment.id} src={attachment.dataUrl} />
          ))}
        </div>
      )}
      {hasWorkflow ? (
        <details className="deep-research-workflow">
          <summary className="deep-research-workflow-summary">
            <span>
              <span className="material-symbols-outlined">visibility</span>
              Workflow
            </span>
            <b>{formatWorkflowSummary(message)}</b>
          </summary>
          <div className="deep-research-workflow-content">
            {typeof displayReasoning === "string" &&
              displayReasoning.trim().length > 0 && (
                <div className="deep-research-reasoning">
                  <div className="deep-research-workflow-label">Thinking</div>
                  <pre>{displayReasoning.trim()}</pre>
                </div>
              )}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="deep-tool-list">
                {message.toolCalls.map((call) => (
                  <DeepToolCall call={call} key={call.id} />
                ))}
              </div>
            )}
          </div>
        </details>
      ) : message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0 ? (
        <div className="deep-tool-list">
          {message.toolCalls.map((call) => (
            <DeepToolCall call={call} key={call.id} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function DeepResearchProcessing() {
  return (
    <div className="deep-research-processing" role="status" aria-live="polite">
      <div className="deep-research-processing-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <span>Researching sources and building an answer</span>
    </div>
  );
}

function DeepToolCall({ call }: { call: RouterToolCallRecord }) {
  const hasPayload =
    call.input !== undefined || call.output !== undefined || call.error !== undefined;
  const summary = formatToolCallSummary(call);

  return (
    <details className={`deep-tool-call ${call.status}`}>
      <summary>
        <span>
          <span className="material-symbols-outlined">
            {call.status === "failed" ? "warning" : "build"}
          </span>
          {humanizeDeepResearchToolName(call.name)}
        </span>
        <b>{call.status}</b>
      </summary>
      <MarkdownText text={summary} />
      {hasPayload && (
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

function formatDeepResearchMessageText(message: DeepResearchMessageRecord): string {
  const text = message.text ?? "";
  if (isClosedControllerFailureText(text)) {
    return "Previous research stream stopped before the final answer was produced. Start a new run to retry the question.";
  }
  return text;
}

function formatDeepResearchReasoning(reasoning: string | undefined): string | undefined {
  if (!reasoning) return reasoning;
  if (isClosedControllerFailureText(reasoning)) return undefined;
  return reasoning;
}

function isClosedControllerFailureText(text: string): boolean {
  return /invalid state:\s*controller is already closed/i.test(text);
}

function formatToolCallSummary(call: RouterToolCallRecord): string {
  if (call.summary !== "Tool completed.") return call.summary;
  const output = call.output;
  if (isJsonRecord(output) && Array.isArray(output.results)) {
    const total = typeof output.total === "number" ? output.total : output.results.length;
    return total === 0
      ? "No matching memory or source results found."
      : `Found ${total} result${total === 1 ? "" : "s"}.`;
  }
  if (isJsonRecord(output) && Array.isArray(output.profiles)) {
    const count = output.profiles.length;
    return `Loaded ${count} branch profile${count === 1 ? "" : "s"}.`;
  }
  return call.summary;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatWorkflowSummary(message: DeepResearchMessageRecord): string {
  const toolCount = message.toolCalls?.length ?? 0;
  const hasReasoning =
    typeof message.reasoning === "string" && message.reasoning.trim().length > 0;
  if (toolCount > 0 && hasReasoning) {
    return `${toolCount} tool${toolCount === 1 ? "" : "s"} + thinking`;
  }
  if (toolCount > 0) return `${toolCount} tool${toolCount === 1 ? "" : "s"}`;
  return "thinking";
}

function humanizeDeepResearchToolName(value: string): string {
  const labels: Record<string, string> = {
    supermemory_context: "Memory Context",
    supermemory_search_all: "Memory Search",
    supermemory_branch_profiles: "Branch Profiles",
    exa_search: "Source Search",
    exa_research: "Source Research",
    exa_contents: "Source Content Reader",
    information_agent: "Information Agent",
  };

  if (labels[value]) return labels[value];
  return humanize(value);
}

function buildTitle(text: string | undefined): string {
  const title = text?.replace(/\s+/g, " ").trim();
  if (!title) return "Untitled research";
  return title.length > 64 ? `${title.slice(0, 61).trimEnd()}...` : title;
}

function formatChatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function fileToAttachment(file: File): Promise<DeepResearchImageAttachment> {
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type,
    dataUrl: await readFileAsDataUrl(file),
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}
