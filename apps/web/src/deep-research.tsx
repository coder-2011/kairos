import type { KairosReasoningEffort } from "../../../src/global/agent-config.js";

import { useEffect, useMemo, useRef, useState } from "react";
import Select, { components, type StylesConfig } from "react-select";

import type { RouterToolCallRecord } from "./api";
import {
  createDeepResearchChat,
  getDeepResearchChats,
  getDeepResearchMessages,
  getDeepResearchModels,
  sendDeepResearchMessage,
  type DeepResearchChatRecord,
  type DeepResearchImageAttachment,
  type DeepResearchMessageRecord,
  type DeepResearchModelOption,
} from "./deep-research-api";
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
    if (!selectedChatId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    getDeepResearchMessages(selectedChatId)
      .then((nextMessages) => {
        if (!cancelled) setMessages(nextMessages);
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

  async function submit() {
    if ((!draft.trim() && attachments.length === 0) || running) return;

    let chatId = selectedChatId;
    const submittedText = draft.trim();
    const submittedAttachments = attachments;
    setRunning(true);
    setError("");
    try {
      if (!chatId) {
        const chat = await createDeepResearchChat();
        chatId = chat.id;
        setChats((current) => [chat, ...current]);
        setSelectedChatId(chat.id);
      }

      const result = await sendDeepResearchMessage({
        chatId,
        text: submittedText,
        model: selectedModel,
        reasoningEffort: reasoningEffort === "auto" ? undefined : reasoningEffort,
        attachments: submittedAttachments,
      });
      setDraft("");
      setAttachments([]);
      setMessages((current) => [
        ...current,
        result.userMessage,
        result.assistantMessage,
      ]);
      setChats((current) =>
        current.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                title: result.chat?.title ?? chat.title ?? buildTitle(result.userMessage.text),
                updatedAt: result.assistantMessage.createdAt,
              }
            : chat,
        ),
      );
      setLoadState("api");
    } catch (sendError) {
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
          className="command-button primary deep-research-new"
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
              <button
                className={`deep-research-chat ${chat.id === selectedChatId ? "active" : ""}`}
                key={chat.id}
                onClick={() => setSelectedChatId(chat.id)}
                type="button"
              >
                <span>RESEARCH</span>
                <b>{chat.title ?? "Untitled research"}</b>
                <em>{formatChatTimestamp(chat.updatedAt)}</em>
              </button>
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
            <span className={`source-pill ${loadState === "offline" || modelState === "offline" ? "warning" : ""}`}>
              {loadState === "loading" || modelState === "loading"
                ? "SYNCING"
                : loadState === "api" && modelState === "api"
                  ? "RESEARCH ONLINE"
                  : "RESEARCH OFFLINE"}
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
              <DeepResearchMessage message={message} key={message.id} />
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
          className={`deep-research-composer ${dragActive ? "drag-active" : ""}`}
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
            className="command-button primary"
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

function DeepResearchMessage({ message }: { message: DeepResearchMessageRecord }) {
  return (
    <article className={`deep-research-message ${message.role}`}>
      <div className="deep-research-message-head">
        <b>{message.role === "user" ? "YOU" : "DEEP RESEARCH"}</b>
        <span>{message.model ?? formatChatTimestamp(message.createdAt)}</span>
      </div>
      <p>{message.text}</p>
      {message.attachments && message.attachments.length > 0 && (
        <div className="deep-message-images">
          {message.attachments.map((attachment) => (
            <img alt={attachment.name} key={attachment.id} src={attachment.dataUrl} />
          ))}
        </div>
      )}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="deep-tool-list">
          {message.toolCalls.map((call) => (
            <DeepToolCall call={call} key={call.id} />
          ))}
        </div>
      )}
    </article>
  );
}

function DeepToolCall({ call }: { call: RouterToolCallRecord }) {
  return (
    <details className={`deep-tool-call ${call.status}`}>
      <summary>
        <span>
          <span className="material-symbols-outlined">
            {call.status === "failed" ? "warning" : "build"}
          </span>
          {humanize(call.name)}
        </span>
        <b>{call.status}</b>
      </summary>
      <p>{call.summary}</p>
    </details>
  );
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
