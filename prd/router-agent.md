# Router Agent PRD

## 1. Purpose

The router agent is the human-ingestion front door for Kairos.

It lives in one top-level `Router` tab as a simple chat. The user can start a new chat, paste text, paste a URL inside the normal chat box, drag in an image, or drag in a PDF. The router reads the submitted information, uses a small set of tools, looks at all branches, chooses the branch IDs that should receive the information, and then wakes those branches' heartbeat agents with a router-specific prompt.

The router is not a trading agent. It routes information into the right monitoring lanes and tells the human what happened.

## 2. Product Goals

- Add a top-level `Router` tab to the web app.
- Support durable router chats with `New Chat`.
- Treat URLs as ordinary chat text that the agent detects and handles.
- Support attachments as first-class chat inputs.
- Use the existing global tool pattern where possible.
- Give the router three initial tools: `exa_search`, `exa_contents`, and `branch_inventory`.
- Let the router select branch IDs directly.
- Immediately wake selected heartbeat agents with the submitted information and a special router-origin prompt.
- Return a concise human-facing response that says what was routed and why.
- Keep schemas lean and only store fields that affect routing, retrieval, replay, or UI display.

## 3. Non-Goals

The router agent should not:

- Execute trades.
- Create live trade intents.
- Auto-create branches.
- Build a separate URL submission flow.
- Maintain branch scoring records unless the UI or downstream code needs them.
- Persist model-internal reasoning separately from the useful user-facing explanation.
- Add rich metadata fields without a concrete consumer.

## 4. User Experience

The first screen of the `Router` tab is the chat itself.

The user can:

- Click `New Chat`.
- Type or paste text.
- Paste a URL into the same message box.
- Drag and drop one or more attachments.
- Send the message.
- See the router's response.

The router response should be short:

```txt
Thanks. I sent this to:
- branch_pltr_gov_contracts
- branch_ai_infra_demand

I used the pasted article and Exa retrieval. It appears relevant because the source describes a new public-sector deployment and related infrastructure demand.
```

If nothing fits:

```txt
Thanks. I read it, but I did not send it to any branch. It looks market-related, but it does not match the current branch laws closely enough.
```

## 5. Minimal Input Schema

Every router turn starts as one chat message:

```ts
type RouterMessage = {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  text?: string;
  attachments?: RouterAttachment[];
  createdAt: string;
};
```

Attachments are separate because they require different extraction paths:

```ts
type RouterAttachment = {
  id: string;
  name: string;
  mimeType: string;
  path: string;
};
```

No separate URL schema is needed. URLs are detected inside `RouterMessage.text`, retrieved with `exa_contents` when useful, and preserved as extracted source text for the run.

## 6. Source Extraction

The router should keep source text separated by origin because handling and trust differ.

Minimal internal extraction shape:

```ts
type RouterExtractedSource = {
  id: string;
  kind: "chat_text" | "webpage" | "image" | "pdf";
  text: string;
  ref?: string;
};
```

`ref` can be a URL or attachment ID. Avoid title, author, publication date, page count, and other metadata until code actually uses those fields.

### 6.1 Text and URLs

Chat text is always included as `chat_text`.

If the chat text contains URLs:

- Detect URLs from the message text.
- Call `exa_contents` for those URLs.
- Add each retrieved page as `webpage`.
- If retrieval fails, keep the original URL in the chat text and let the router use `exa_search` if needed.

### 6.2 Images

Images should be stored as attachments first.

V1 should support one of two paths:

- If a multimodal OpenRouter model is configured, ask it to extract visible text and describe market-relevant content.
- If no multimodal model is configured, preserve the attachment and tell the user image extraction is not available yet.

Do not add a large image schema. The result becomes one `image` extracted source with text.

### 6.3 PDFs

PDF extraction should be local-first and deterministic before involving a model.

Recommended approach:

1. Store the original PDF attachment.
2. Run a local Bun-compatible PDF text extractor.
3. If text is extracted, chunk it only as needed for model context and create one or more `pdf` extracted sources.
4. If little or no text is extracted, mark it as scanned/unreadable and defer OCR.
5. Only use a model after text extraction, for summarizing or routing, not for raw parsing.

This keeps PDF handling cheap, replayable, and auditable. OCR should be V1.1 or later unless scanned PDFs become a core first-use case.

## 7. Tools

The router should pick from existing global tools rather than inventing a separate tool catalog.

V1 tools:

- `exa_search`: search for supporting or clarifying context.
- `exa_contents`: retrieve content for URLs found in chat text.
- `branch_inventory`: return all current branches in a compact format.

The branch inventory tool should be simple. It should return each branch's ID plus enough text for the model to decide whether the submitted information belongs there.

```ts
type BranchInventoryResult = Array<{
  id: string;
  text: string;
  enabled: boolean;
}>;
```

`text` can be built from the branch name, description, law, and configured assets. Do not create a router-specific branch object unless the router needs a field that cannot fit into this compact representation.

## 8. Router Agent Flow

The router should be a LangGraph workflow, but the graph should stay small.

```txt
START
  -> ingest
  -> extract_sources
  -> route
  -> wake_heartbeats
  -> respond
  -> END
```

### 8.1 `ingest`

- Save the user message.
- Save attachments.
- Emit `router.message.received`.

### 8.2 `extract_sources`

- Keep chat text.
- Detect URLs and call `exa_contents`.
- Extract text from supported attachments.
- Emit `router.sources.extracted`.

### 8.3 `route`

- Load branch inventory.
- Let the router model use `exa_search` only when it needs more context.
- Produce a final minimal JSON output with selected branch IDs and response text.
- Emit `router.route.selected`.

### 8.4 `wake_heartbeats`

- For each selected branch ID, trigger a heartbeat run immediately.
- Pass the router information as a seed/input packet.
- Use a special prompt or prompt modifier telling the heartbeat: this is human-routed information, evaluate it against your law and decide whether it should escalate.
- Emit `router.heartbeat_triggered` for each branch.

### 8.5 `respond`

- Store and return the assistant message.
- Emit `router.response.created`.

## 9. Final Router Output

The router's final structured output should be minimal:

```ts
type RouterOutput = {
  branchIds: string[];
  response: string;
};
```

Optional later fields can be added only when needed:

- `newBranchIdea` if the UI supports showing proposed new laws.
- `confidence` if thresholding logic depends on it.
- `sourceIds` if the heartbeat wakeup needs source references instead of embedded source text.

Avoid storing branch scores, rejected branch records, or separate reasoning fields in V1.

## 10. Heartbeat Wakeup Contract

The router should call the existing heartbeat trigger path with a router-origin input:

```ts
type RouterHeartbeatInput = {
  origin: "router";
  messageText?: string;
  sources: RouterExtractedSource[];
};
```

The heartbeat prompt modifier should say:

```txt
This run was triggered by human-routed information. Evaluate only whether this information is relevant, novel, and potentially escalation-worthy for this branch's law. Do not trade. Do not assume the human is correct.
```

The heartbeat agent still owns the branch-specific escalation decision.

## 11. Persistence

Use local files first.

Recommended paths:

```txt
data/runtime/router/chats/{chatId}.json
data/runtime/router/messages/{chatId}.jsonl
data/runtime/router/attachments/{attachmentId}/original
```

Router runs should also use normal run/event storage so the UI can replay them:

```txt
data/runtime/runs/{runId}.json
data/runtime/events/{runId}.jsonl
```

Do not create separate route-decision storage in V1 unless replay from run events becomes insufficient.

## 12. Local API Requirements

Minimal endpoints:

```txt
GET  /router/chats
POST /router/chats
GET  /router/chats/:chatId/messages
POST /router/chats/:chatId/messages
GET  /runs/:runId/events
```

`POST /router/chats/:chatId/messages` should support text first. Multipart attachment upload can land in the same endpoint when implemented.

## 13. Frontend Requirements

Add `Router` to the top-level navigation.

The tab should include:

- Chat list or `New Chat` control.
- Message transcript.
- Text composer.
- Drag-and-drop attachment area.
- Send button.
- Router run status.
- A compact list of branch IDs that were woken.

The attachment drop zone should honestly reflect capability:

- Text and URL: enabled in V1.
- PDF: enabled once local text extraction is wired.
- Image: enabled once multimodal extraction is wired.

## 14. Supermemory

When Supermemory is configured, write only compact useful memories:

- The submitted source text or a compact source excerpt.
- The branch IDs it was routed to.
- Human corrections later.

Do not mirror every intermediate field.

## 15. Safety

The router may say:

- "I sent this to branch X."
- "I did not send this anywhere."
- "This looks like it may be relevant, so I woke the heartbeat agent."

The router may not:

- Say a trade should be made.
- Create live or paper trade intents.
- Treat human input as verified fact.
- Trigger anything except heartbeat evaluation.

## 16. Implementation Plan

### Phase 1: Minimal Contracts

- Add router message, attachment, extracted-source, and output schemas.
- Extend local API run kinds to include `router` if needed.
- Add router chat/message local storage.
- Add tests for schema shape and persistence.

### Phase 2: Source Extraction

- Detect URLs in chat text.
- Use `exa_contents` for URL retrieval.
- Add local PDF text extraction.
- Preserve images as attachments and gate multimodal extraction behind model configuration.

### Phase 3: Router Agent

- Build the small LangGraph router workflow.
- Add `branch_inventory` as an internal tool returning `{ id, text, enabled }[]`.
- Use `exa_search` only when the model needs more context.
- Make the final model output exactly `branchIds` and `response`.

### Phase 4: Heartbeat Wakeup

- Trigger heartbeat runs for selected branch IDs.
- Pass router-origin sources into heartbeat input.
- Add the router-specific heartbeat prompt modifier.
- Test that selected branches wake and unselected branches do not.

### Phase 5: Frontend

- Add the `Router` tab.
- Add chat creation and transcript loading.
- Add text/URL sending.
- Add attachment UI with capability-aware states.
- Show which branch IDs were woken.

## 17. Tests

Default tests should not call live APIs.

Required deterministic tests:

- Text-only router message routes to selected branch IDs.
- URL inside chat text calls retrieval through a mocked `exa_contents`.
- Router can select multiple branch IDs.
- Empty selection does not wake any heartbeat.
- Selected branches wake heartbeat with `origin: "router"`.
- Disabled branch behavior is explicit in the branch inventory text or prompt.
- PDF with extractable text becomes a `pdf` source.
- Scanned or unreadable PDF is preserved but not treated as extracted evidence.
- No trade intent or broker action is created.

## 18. Open Questions

- Which Bun-compatible PDF text extractor should be used first?
- Which OpenRouter multimodal model should handle images?
- Should disabled branches be eligible for routing when the model thinks the match is strong, or only visible as context?
- Should router-triggered heartbeat runs use a cheaper development model by default?
