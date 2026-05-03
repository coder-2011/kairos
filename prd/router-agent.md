# Router Agent PRD

## 1. Purpose

The router agent is the human-ingestion front door for Kairos.

It should accept links, pasted text, images, and PDFs in a simple frontend chat. It should inspect the submitted information, ground itself with search and retrieval tools, compare the evidence against every active branch, and route the information to the branch or branches where it is useful.

The router agent does not decide whether to trade. Its job is source intake, evidence extraction, branch matching, provenance preservation, and human-facing confirmation.

The user experience should feel like sending something to an analyst:

> "Thanks. I read the source, checked the supporting context, and routed it to these branches because it appears relevant to these laws."

## 2. Product Goals

- Add a `Router` tab to the web app with a durable chat thread.
- Support paste-in URLs, freeform notes, image drag-and-drop, and PDF drag-and-drop.
- Let the router agent use online search, Exa search, Exa research/answer, and Exa retrieval/content extraction.
- Give the router agent access to every branch's law, purpose, assets, enabled status, metadata, and recent context needed for routing.
- Produce an explicit route decision for every relevant branch.
- Preserve evidence provenance: source URL, uploaded artifact metadata, extracted claims, search results, citations, timestamps, and model rationale.
- Write routed information into local storage and Supermemory where configured.
- Tell the human what was routed, where it was routed, and why.
- Recommend a new branch or law when the information is useful but no existing branch fits.
- Keep all actions inspectable through local run events.

## 3. Non-Goals

The router agent should not:

- Execute trades.
- Create live trade intents.
- Trigger broker actions.
- Auto-create branches without human confirmation.
- Treat a human-uploaded document as authoritative without source/risk annotation.
- Hide low-confidence routing behind a friendly chat message.
- Run expensive deep research by default for every upload.
- Replace heartbeat monitoring or debate workflows.

## 4. Core User Experience

The first `Router` tab should be a compact chat surface.

The user can:

- Paste a URL.
- Paste a note or claim.
- Drag and drop an image.
- Drag and drop a PDF.
- Send multiple attachments with a short instruction.
- See the router's final answer.
- See expandable evidence and routing details.

The router response should include:

- A short acknowledgement.
- What kind of information it processed.
- The most important extracted claims.
- Which branch or branches received the information.
- Why each branch matched.
- Any branches considered but rejected when useful to show.
- Confidence and unresolved uncertainty.
- Source/citation references when available.

Example response shape:

```txt
Thanks. I read the filing and checked recent coverage.

I routed it to:
- PLTR government-contract-expansion: the filing mentions a new multi-year public-sector deployment.
- AI infrastructure demand: the source includes capex language relevant to that branch's law.

I did not route it to earnings-revision branches because the source does not change guidance, margin, revenue, or analyst-estimate evidence.
```

## 5. Inputs

### 5.1 Chat Message

Every router turn starts with a user message:

```ts
type RouterUserMessage = {
  messageId: string;
  sessionId: string;
  author: "human";
  text?: string;
  attachments: RouterAttachment[];
  createdAt: string;
};
```

### 5.2 URL Input

URL input should be normalized into a source record:

```ts
type RouterUrlInput = {
  kind: "url";
  url: string;
  normalizedUrl: string;
  submittedText?: string;
};
```

URL handling should:

- Fetch page content through Exa retrieval/content extraction when possible.
- Fall back to generic online search when direct extraction fails.
- Preserve canonical URL, title, author, publication date, provider, and extraction status.
- Mark paywalled, inaccessible, script-heavy, or low-content pages explicitly.

### 5.3 Image Input

Image input should be stored as an artifact and passed through a model-compatible image analysis path when multimodal model support is configured.

The image extractor should return:

- Visible text or OCR-like extracted text.
- Entities, tickers, organizations, products, people, dates, and numbers.
- Chart/table descriptions if present.
- Source uncertainty.

If multimodal model support is not configured, the router should store the artifact and tell the user that image analysis is unavailable.

### 5.4 PDF Input

PDF input should be stored as an artifact and converted to text before model routing.

The PDF extractor should return:

- Document title when available.
- Page count.
- Extracted text chunks with page references.
- Tables or numeric facts where practical.
- Document metadata.
- Extraction warnings for scanned PDFs or unreadable pages.

Scanned PDFs may require OCR later. V1 can mark them as unsupported for full extraction while still preserving the artifact.

## 6. Tool Surface

The router should use a bounded, inspectable tool surface.

### 6.1 Online Search

Generic online search is for:

- Resolving ambiguous URLs or entities.
- Finding corroborating public sources.
- Checking whether a claim is current, stale, duplicated, or contradicted.
- Finding issuer pages, filings, press releases, or reputable coverage.

### 6.2 Exa Search

Exa search is the default current-web/news search tool.

Allowed uses:

- Search recent coverage for extracted entities and claims.
- Find source clusters around a catalyst.
- Identify publication timestamps and repeated coverage.
- Gather short highlighted snippets for routing evidence.

### 6.3 Exa Research / Answer

The user referred to "XO XID research"; this PRD assumes that means Exa research/answer-style deeper synthesis. The implementation should name the tool `exa_research` unless a different provider name is confirmed.

Allowed uses:

- Answer a specific routing question after cheap extraction.
- Compare a claim against broader context.
- Determine whether an item plausibly matters for a branch's law.
- Summarize source clusters with citations.

This tool should have a higher budget cost than search and should be gated by uncertainty, source importance, or user request.

### 6.4 Exa Retrieval / Contents

Exa retrieval should fetch the content of known URLs.

Allowed uses:

- Extract text from pasted URLs.
- Retrieve full or bounded page text for source reading.
- Get highlights and summaries for long sources.
- Preserve citations and source metadata.

### 6.5 Branch Inventory Tool

The router must have an internal branch inventory tool.

It should return every branch, not only enabled branches, with enough context for matching:

```ts
type RouterBranchInventoryItem = {
  branchId: string;
  lawId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  law?: Record<string, unknown>;
  assets: string[];
  purposeSummary: string;
  watchFor: string[];
  ignoreSignals: string[];
  escalationThreshold?: string;
  recentRouteSummaries?: string[];
  recentHeartbeatSummaries?: string[];
  metadata?: Record<string, unknown>;
};
```

The inventory can initially be derived from `BranchRecord` in `apps/local-api/src/store.ts`, then later backed by the stricter runtime branch schema in `src/runtime/schemas.ts`.

## 7. Router Agent Architecture

The router agent should be a LangGraph workflow using LangChain-compatible model calls, tools, and structured outputs.

Recommended graph:

```txt
START
  -> ingest_user_message
  -> normalize_sources
  -> extract_source_claims
  -> load_branch_inventory
  -> cheap_branch_match
  -> targeted_research
  -> final_route_decision
  -> persist_routes
  -> assistant_response
  -> END
```

### 7.1 `ingest_user_message`

Responsibilities:

- Create or load the router chat session.
- Store the raw user message.
- Store uploaded artifacts.
- Emit `router.message.received`.

### 7.2 `normalize_sources`

Responsibilities:

- Split text, URLs, images, and PDFs into typed source candidates.
- Deduplicate identical URLs or attachments.
- Fetch URL contents when cheap.
- Mark unavailable content explicitly.
- Emit `router.source.normalized`.

### 7.3 `extract_source_claims`

Responsibilities:

- Extract entities, tickers, dates, amounts, products, contracts, guidance, filings, sources, and claims.
- Distinguish facts, quotes, user assertions, and model inferences.
- Produce source-bound claim IDs.
- Emit `router.claims.extracted`.

### 7.4 `load_branch_inventory`

Responsibilities:

- Read every branch from local storage.
- Summarize branch purpose from law/config/description.
- Include disabled branches for visibility, but mark them as non-routeable unless the user asks otherwise.
- Include recent route and heartbeat context when available.
- Emit `router.branch_inventory.loaded`.

### 7.5 `cheap_branch_match`

Responsibilities:

- Score every branch against extracted claims.
- Keep explicit rejected-branch rationale for close calls.
- Select candidates for deeper research.
- Avoid tool calls when branch relevance is obvious.
- Emit `router.branch_candidates.scored`.

Recommended scoring dimensions:

- Asset/entity overlap.
- Law-topic overlap.
- Source type relevance.
- Novelty relative to branch memory.
- Possible materiality.
- Staleness or duplicate risk.
- Ignore-rule conflict.
- Confidence.

### 7.6 `targeted_research`

Responsibilities:

- Use Exa search, Exa retrieval, and Exa research only for uncertain or high-value candidate matches.
- Check source credibility and corroboration.
- Determine whether the same information has already been routed recently.
- Emit tool call events and `router.research.completed`.

### 7.7 `final_route_decision`

Responsibilities:

- Produce a structured decision.
- Route to zero, one, or many branches.
- Recommend a new branch when no existing branch fits.
- Never create a trade intent.
- Emit `router.route_decision.created`.

### 7.8 `persist_routes`

Responsibilities:

- Store routed source records locally.
- Append branch-scoped route events.
- Mirror durable source summaries to Supermemory when configured.
- Preserve uploaded artifacts and extracted text references.
- Emit `router.route.persisted`.

### 7.9 `assistant_response`

Responsibilities:

- Generate the human-facing chat reply.
- Use friendly acknowledgement but keep technical accuracy.
- Include routed branches, evidence, confidence, and uncertainty.
- Emit `router.response.created`.

## 8. Structured Output Contracts

### 8.1 Claim Extraction

```ts
type RouterExtractedClaim = {
  claimId: string;
  sourceId: string;
  text: string;
  claimType:
    | "fact"
    | "quote"
    | "user_assertion"
    | "model_inference"
    | "numeric_observation";
  entities: string[];
  tickers: string[];
  dates: string[];
  numbers: string[];
  confidence: number;
};
```

### 8.2 Branch Score

```ts
type RouterBranchScore = {
  branchId: string;
  routeable: boolean;
  score: number;
  confidence: number;
  matchedClaims: string[];
  reason: string;
  rejectionReason?: string;
  needsResearch: boolean;
};
```

### 8.3 Route Decision

```ts
type RouterRouteDecision = {
  decisionId: string;
  sessionId: string;
  runId: string;
  createdAt: string;
  sourceIds: string[];
  routes: RouterBranchRoute[];
  rejectedBranches: RouterRejectedBranch[];
  recommendedNewBranches: RouterNewBranchRecommendation[];
  summary: string;
  confidence: number;
};
```

### 8.4 Branch Route

```ts
type RouterBranchRoute = {
  branchId: string;
  action: "route_to_branch" | "route_and_escalate_candidate" | "store_only";
  matchedClaims: string[];
  rationale: string;
  confidence: number;
  novelty: "new" | "duplicate" | "unclear";
  sourceRefs: string[];
};
```

`route_and_escalate_candidate` should not directly run debate in V1. It marks the source as possibly escalation-worthy so the human or a later gate can trigger deeper workflows.

## 9. Persistence Model

V1 should extend local-file persistence instead of introducing a database.

Recommended local paths:

```txt
data/runtime/router/sessions/{sessionId}.json
data/runtime/router/messages/{sessionId}.jsonl
data/runtime/router/sources/{sourceId}.json
data/runtime/router/artifacts/{artifactId}/original
data/runtime/router/decisions/{decisionId}.json
data/runtime/router/routes/{branchId}.jsonl
```

Branch-specific route events should also be visible through run events:

```txt
data/runtime/runs/{runId}.json
data/runtime/events/{runId}.jsonl
```

The current runtime schemas already include `router` as a run kind. The local API store currently narrows run kind to `"heartbeat" | "debate"`, so the implementation should reconcile that before adding router runs.

## 10. Local API Requirements

Add local API endpoints for the router workflow:

```txt
GET  /router/sessions
POST /router/sessions
GET  /router/sessions/:sessionId/messages
POST /router/sessions/:sessionId/messages
POST /router/runs
GET  /router/runs/:runId
GET  /router/runs/:runId/events
GET  /router/sources/:sourceId
GET  /router/decisions/:decisionId
```

For V1, uploads can be handled as multipart form data on:

```txt
POST /router/sessions/:sessionId/messages
```

If multipart support is too much for the first pass, V1.0 can support URL/text only and V1.1 can add image/PDF uploads. The frontend should still reserve the drop-zone affordance but show a disabled state until upload support exists.

## 11. Frontend Requirements

Add a `Router` tab to `apps/web/src/App.tsx`.

The tab should include:

- Chat transcript.
- Text input.
- URL paste support.
- Drag-and-drop attachment zone.
- Send button.
- Router run status.
- Expandable evidence panel.
- Routed branch list.
- Rejected close-call branch list.
- New-branch recommendation panel.

The tab should reuse existing API loading conventions from `apps/web/src/api.ts`.

The router should not be hidden behind the branch detail view. It is a top-level ingestion workflow that can route to many branches.

## 12. Observability Events

Every router run should emit product events:

- `router.started`
- `router.message.received`
- `router.source.normalized`
- `router.source.extracted`
- `router.claims.extracted`
- `router.branch_inventory.loaded`
- `router.branch_candidates.scored`
- `router.tool.call.started`
- `router.tool.call.completed`
- `router.tool.call.failed`
- `router.research.completed`
- `router.route_decision.created`
- `router.route.persisted`
- `router.response.created`
- `router.completed`
- `router.failed`

Each event should include:

- `runId`
- `sessionId`
- `timestamp`
- `actor`
- `payload`
- `sourceRefs`
- `branchId` when branch-specific
- `toolName` when tool-specific

## 13. Supermemory Integration

When Supermemory is configured, the router should write durable memories for:

- Human-submitted sources.
- Extracted source summaries.
- Branch route decisions.
- Human corrections to route decisions.
- Known source reliability notes.

Memory should be scoped by branch when routed:

```txt
branch_{branchId}
```

It should also keep a router-wide container for source-ingestion learnings:

```txt
kairos_router
```

Supermemory writes should be best-effort unless `KAIROS_SUPERMEMORY_REQUIRED=1`.

## 14. Safety and Financial Boundaries

The router is allowed to say:

- "This looks relevant to branch X."
- "This may be escalation-worthy."
- "This claim appears unsupported."
- "This source seems stale."

The router is not allowed to:

- Place orders.
- Approve orders.
- Create live trade intents.
- Present routing as investment advice.
- Hide uncertainty about source quality.

If a source looks highly time-sensitive or materially market-moving, the router may mark it as an escalation candidate but should preserve a human-visible audit trail.

## 15. Implementation Plan

### Phase 1: Contracts and Storage

- Add router schemas for sessions, messages, attachments, sources, claims, branch scores, route decisions, and route records.
- Extend local API store run kinds to include `router`, aligning it with `src/runtime/schemas.ts`.
- Add local router storage paths under `data/runtime/router`.
- Add unit tests for schema validation and route decision persistence.

### Phase 2: Tools and Source Extraction

- Add Exa retrieval/content tool wrapper for URL reading.
- Add Exa search tool wrapper specialized for router routing questions.
- Add Exa research/answer wrapper with explicit budget gating.
- Add URL normalization and source record creation.
- Add PDF text extraction only if a lightweight dependency is acceptable; otherwise defer PDF extraction to V1.1.
- Add image artifact storage first, then multimodal extraction when model support is configured.

### Phase 3: Router LangGraph Agent

- Implement router graph nodes.
- Add branch inventory loader.
- Add structured-output prompts for claim extraction, branch scoring, and final route decision.
- Persist every run and event.
- Add deterministic test doubles for tools and model outputs.
- Add tests for multi-branch routing, no-match recommendation, duplicate URL handling, disabled branch handling, and unsupported attachment handling.

### Phase 4: Local API

- Add router session/message/run endpoints.
- Add SSE event streaming by reusing the run event stream pattern.
- Add multipart upload support or defer it behind a visible frontend disabled state.
- Add API tests for URL/text router messages.

### Phase 5: Frontend Router Tab

- Add `Router` to top-level navigation.
- Add chat transcript and composer.
- Add URL/text send flow.
- Add drag-and-drop UI with capability-aware disabled states.
- Show run status, evidence, routes, rejected close calls, and new-branch recommendations.
- Keep the first UI dense and operational rather than marketing-like.

### Phase 6: Human Correction Loop

- Let the user correct a route decision.
- Store correction events.
- Mirror corrections to Supermemory.
- Use corrections as branch inventory context in later runs.

## 16. Testing Requirements

Default tests should not call live external APIs.

Required deterministic tests:

- URL text message creates a router run.
- Extracted claims are attached to source IDs.
- Every branch is scored.
- Disabled branches are considered but not routed by default.
- Relevant source routes to multiple branches.
- Irrelevant source routes to none and can recommend a new branch.
- Duplicate source is recognized.
- Tool failures produce a completed response with uncertainty when possible.
- Router response names routed branches and rationale.
- No trade intent or broker action is created.

Live tests can exist behind explicit naming and environment requirements, for example:

```txt
router.live.test.ts
```

They should require `EXA_API_KEY` and should not run in default validation.

## 17. Open Questions

- Does "XO XID research" mean Exa answer, Exa neural research, a separate provider, or an internal tool name?
- Which multimodal OpenRouter model should analyze images?
- Should PDF extraction use a local parser dependency in V1 or be deferred?
- Should routing write directly into branch memory, branch source logs, or both?
- Should a high-confidence route be allowed to trigger a heartbeat run automatically, or should V1 only mark escalation candidates?
- How much recent branch run history should be included in branch inventory before token cost becomes excessive?

## 18. Technically Dense Poem

In a graph of typed state, the ingress node receives the human delta,
normalizes URL, image, PDF, and note into source-bound artifacts,
hashes provenance, extracts claims, embeds branch law vectors,
scores every branch over entity overlap, law semantics, novelty, staleness,
then gates Exa search, Exa retrieval, and research synthesis by uncertainty.

No broker edge fires, no trade intent mutates portfolio state;
only route records append, JSONL events persist, Supermemory mirrors context,
and the UI renders a compact acknowledgement with citations,
confidence, rejected candidates, and branch-scoped rationale.
