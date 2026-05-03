# Supermemory — Complete Reference Guide (TypeScript)

> Deep documentation on how Supermemory works architecturally, every API endpoint, TypeScript SDK usage, and how to integrate it as the memory backbone of a multi-agent trading system.

---

## Table of Contents

1. [What Supermemory Is](#what-supermemory-is)
2. [How It Actually Works — Architecture Deep Dive](#how-it-actually-works)
3. [The Graph Memory Engine](#the-graph-memory-engine)
4. [Memory Types & Lifecycle](#memory-types--lifecycle)
5. [Container Tags — How to Scope Memory](#container-tags)
6. [User Profiles](#user-profiles)
7. [SuperRAG — Hybrid Search Engine](#superrag)
8. [Processing Pipeline](#processing-pipeline)
9. [Setup & Authentication](#setup--authentication)
10. [Core API — Ingest](#core-api--ingest)
11. [Core API — Search & Recall](#core-api--search--recall)
12. [Core API — Profiles](#core-api--profiles)
13. [Core API — Content Management](#core-api--content-management)
14. [Core API — Documents](#core-api--documents)
15. [Core API — Knowledge Graph](#core-api--knowledge-graph)
16. [Core API — Connections / Connectors](#core-api--connections--connectors)
17. [Core API — Container Tag Settings](#core-api--container-tag-settings)
18. [Conversation Ingestion API](#conversation-ingestion-api)
19. [TypeScript SDK — Complete Reference](#typescript-sdk--complete-reference)
20. [TypeScript Types Reference](#typescript-types-reference)
21. [Trading System Integration — Full Pattern](#trading-system-integration)
22. [Benchmarks & Performance](#benchmarks--performance)
23. [Pricing & Free Tier](#pricing--free-tier)
24. [Quick Reference Card](#quick-reference-card)

---

## What Supermemory Is

Supermemory is a managed memory API — a persistent, graph-based knowledge layer that sits between your agents and the LLM. It solves a fundamental problem: LLMs are stateless. Every call starts from scratch. Supermemory gives your agents a brain that persists across sessions, across days, across the lifetime of your system.

It is **not** just a vector database with a search API. The distinction matters:

| A vector database | Supermemory |
|---|---|
| Stores chunks of text | Extracts and stores *facts* from text |
| Returns similar documents | Returns relevant memories + graph context |
| No concept of time | Tracks when facts were true and when they changed |
| You manage contradictions | Handles contradictions automatically |
| No user model | Builds and maintains user/agent profiles |
| No forgetting | Automatically forgets ephemeral/expired facts |

The core abstraction is the **knowledge graph** — a living network of facts where memories connect to other memories through relationships, evolve over time, and generate inferred insights automatically.

---

## How It Actually Works

### The Five-Layer Stack

Supermemory's architecture is a five-layer pipeline:

```
┌─────────────────────────────────────────────────────────┐
│  1. CONNECTORS                                          │
│  Auto-sync from Google Drive, Notion, Slack, Gmail, S3 │
│  Or: raw text/URL/file via API                          │
└────────────────────────┬────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────┐
│  2. EXTRACTORS                                          │
│  Multi-modal chunking and fact extraction              │
│  PDF, web pages, images, video transcripts, text       │
│  LLM pass extracts discrete facts from raw content     │
└────────────────────────┬────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────┐
│  3. SUPER-RAG                                           │
│  Hybrid search: vector similarity + BM25 keyword       │
│  + graph traversal + reranking                         │
│  Finds relevant memories across multiple strategies    │
└────────────────────────┬────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────┐
│  4. MEMORY GRAPH                                        │
│  Knowledge graph with three relationship types         │
│  Contradiction resolution + temporal ordering          │
│  Automatic forgetting of expired/irrelevant facts      │
└────────────────────────┬────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────┐
│  5. USER PROFILES                                       │
│  Static facts (long-term) + dynamic context (recent)  │
│  Auto-maintained from accumulated graph data           │
│  Returned in single call at sub-300ms                  │
└─────────────────────────────────────────────────────────┘
```

### Documents vs Memories

This is the most important conceptual distinction:

**Documents** are what *you* provide — the raw input. A PDF, a URL, a block of text, a conversation transcript. Think of these as books you hand to Supermemory.

**Memories** are what *Supermemory creates* — the intelligent knowledge units extracted from those documents. When you upload a 50-page PDF, Supermemory doesn't just store it. It breaks it into hundreds of interconnected memories, each understanding its context and relationships to everything else in your knowledge graph.

```
You provide:   "Had a call with Alex. He's a PM at Stripe now,
                moved to Seattle, works on payments infrastructure."

Supermemory extracts:
  → "Alex works at Stripe as a PM"
  → "Alex works on payments infrastructure"  [extends role memory]
  → "Alex lives in Seattle"                  [new fact]
  → "Alex recently changed jobs"             [inferred from context]
```

Each extracted fact becomes a node in the graph, connected to related nodes.

---

## The Graph Memory Engine

The graph is the core innovation. Unlike a flat vector store that just finds similar things, the graph tracks *how facts relate to each other* and *how they change over time*.

### Three Relationship Types

**1. Updates — Information Changes**

When new information contradicts existing knowledge, Supermemory creates an `updates` relationship. The old memory is marked `isLatest: false`. Searches return the current version while preserving history.

```
Memory 1 (old):  "PLTR thesis: US gov growth plateauing, range-bound $80-90"
Memory 2 (new):  "PLTR thesis: EU expansion now primary growth vector, target $105"
                  ↓
Memory 2 UPDATES Memory 1
Search returns Memory 2, but Memory 1 is in context.parents[]
```

**2. Extends — Information Enriches**

When new information adds detail without replacing, Supermemory creates an `extends` relationship. Both memories remain valid. Searches get richer context.

```
Memory 1: "PLTR announced NHS contract"
Memory 2: "NHS contract is 3 years, estimated $180M, AI diagnostics"
           ↓
Memory 2 EXTENDS Memory 1
Both returned together — fuller picture
```

**3. Derives — Information Infers**

The most sophisticated relationship. Supermemory infers new facts from patterns across your knowledge graph.

```
Memory 1: "PLTR won 3 DoD contracts in the last 6 months"
Memory 2: "PLTR's government revenue grew 23% YoY"
           ↓
Derived: "PLTR's defense vertical is accelerating — Q4 likely beat"
```

### What the Search Response Looks Like

Every search result includes the graph context:

```json
{
  "id": "mem_abc123",
  "memory": "PLTR thesis shifted to EU expansion after NHS deal",
  "similarity": 0.89,
  "version": 3,
  "updatedAt": "2026-05-03T14:22:00Z",
  "context": {
    "parents": [
      {
        "relation": "updates",
        "memory": "Earlier: PLTR thesis was US gov plateauing, range-bound",
        "version": 2,
        "updatedAt": "2026-01-10T09:00:00Z"
      }
    ],
    "children": [
      {
        "relation": "extends",
        "memory": "EU expansion led by NHS deal at $180M, 3 years",
        "version": 1
      }
    ],
    "related": []
  }
}
```

The `context.parents` gives you history. The `context.children` gives you enrichment. The `relation` field tells you exactly how they connect.

---

## Memory Types & Lifecycle

Supermemory automatically classifies every extracted memory into one of three types:

| Type | Example | Behavior |
|---|---|---|
| **Facts** | "PLTR works primarily with government clients" | Persists until explicitly updated or contradicted |
| **Preferences** | "Human weight for PLTR law is 0.3" | Strengthens with repetition, rarely expires |
| **Episodes** | "Qwen fired PLTR law at 09:32 on 2026-05-03" | Decays naturally unless elevated to fact |

### Automatic Forgetting

- **Time-based forgetting** — "Meeting in 30 minutes" is auto-forgotten after the time passes
- **Contradiction resolution** — When new facts contradict old ones, `updates` relationships ensure searches return current information
- **Noise filtering** — Casual, non-meaningful content doesn't become permanent memories

---

## Container Tags

Container tags are how you scope and isolate memory. The primary organizational primitive — think namespaces.

**Format:** Max 100 characters, alphanumeric with hyphens, underscores, and dots. Pattern: `^[a-zA-Z0-9_:-]+$`

```typescript
// Every add/search/profile call accepts a containerTag
await client.add({ content: "...", containerTag: "law_pltr_deals" });
await client.search({ q: "...", containerTag: "law_pltr_deals" });
await client.profile({ containerTag: "law_pltr_deals", q: "..." });
```

**Scoping strategy for a trading system:**

```
law_pltr_deals          ← isolated memory for PLTR deals law
law_pltr_earnings       ← isolated memory for PLTR earnings law
law_nvda_contracts      ← isolated memory for NVDA contracts law
system_global           ← cross-law knowledge, human preferences
system_debates          ← all debate transcripts and outcomes
```

**Key properties:**
- Each `containerTag` gets its own profile, graph, and search scope
- Search across all containers by omitting `containerTag`
- Containers can be deleted entirely (wipes all memories in that scope)
- Settings can be customized per-container (e.g., different forgetting policies)

---

## User Profiles

The profile system automatically builds a two-part summary of everything stored in a container:

**Static profile** — Long-term stable facts that rarely change.
```
"PLTR primarily serves government and enterprise clients"
"PLTR has historically moved 8-15% on major government contract announcements"
"This law has fired 12 times, 9 were profitable escalations"
```

**Dynamic profile** — Recent activity and context that matters right now.
```
"PLTR last triggered on 2026-05-03 with NHS deal detection"
"Current thesis: EU expansion is primary growth vector"
"Last trade: BUY at $83.60, +7.2% outcome"
```

The profile endpoint returns both in a single sub-300ms call, optionally combined with a search query. This is the primary way agents get memory context at the start of a task.

---

## SuperRAG

SuperRAG is Supermemory's retrieval engine running four strategies in parallel:

1. **Semantic vector search** — Finds conceptually similar memories
2. **BM25 keyword matching** — Finds exact keyword matches
3. **Graph traversal** — Follows relationship edges to find connected memories
4. **Temporal filtering** — Weights recency appropriately

**Search modes:**

| Mode | What it searches | Use case |
|---|---|---|
| `memories` (default) | Extracted memory entries only | Agent context retrieval — fast |
| `documents` | Raw document chunks only | RAG over uploaded documents |
| `hybrid` | Both memories and document chunks | Maximum recall |

---

## Processing Pipeline

| Stage | What Happens | Typical Duration |
|---|---|---|
| `queued` | Waiting to process | Immediate |
| `extracting` | Content being extracted from URL/file | 1-5 seconds |
| `chunking` | Creating memory chunks | Seconds |
| `embedding` | Generating vector embeddings | Seconds |
| `indexing` | Building graph relationships | Seconds |
| `done` | Fully searchable | — |

**Estimates:** Short text = near-instant. Web page = 5-15s. 100-page PDF = 1-2 min. 1-hour video = 5-10 min.

---

## Setup & Authentication

### Installation

```bash
npm install supermemory
```

### Environment Variable

```bash
export SUPERMEMORY_API_KEY="sm_your_key_here"
```

### Client Initialization

```typescript
import Supermemory from "supermemory";

// Reads SUPERMEMORY_API_KEY from process.env automatically
const client = new Supermemory();

// Or explicit key
const client = new Supermemory({ apiKey: "sm_your_key_here" });
```

### Base URLs

```
Ingest:   POST  https://api.supermemory.ai/v3/documents
Search:   POST  https://api.supermemory.ai/v4/search
Profile:  POST  https://api.supermemory.ai/v4/profile
```

### Raw Fetch Helper

For endpoints not yet in the SDK:

```typescript
const BASE = "https://api.supermemory.ai";
const API_KEY = process.env.SUPERMEMORY_API_KEY!;

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

async function smPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supermemory ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function smGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`Supermemory ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function smDelete<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supermemory ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function smPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supermemory ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}
```

---

## Core API — Ingest

### Add Document (Single)

`POST /v3/documents`

```typescript
// Add raw text
const result = await client.add({
  content: "PLTR announced 5-year NHS contract worth $180M on 2026-05-03.",
  containerTag: "law_pltr_deals",
});

// Add a URL — Supermemory fetches and processes it
const result = await client.add({
  content: "https://www.sec.gov/Archives/edgar/data/1321655/000132165526000012/pltr-8k.htm",
  containerTag: "law_pltr_deals",
});
```

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `content` | `string` | ✅ | Text, URL, or file content to process |
| `containerTag` | `string` | ❌ | Scope this memory to a container |
| `entityContext` | `string` | ❌ | Up to 1500 chars of context to guide extraction |
| `customId` | `string` | ❌ | Your own ID for this document |
| `metadata` | `Record<string, unknown>` | ❌ | Arbitrary key-value metadata |

**`entityContext` is powerful** — use it to guide how Supermemory extracts memories:

```typescript
const result = await client.add({
  content: newsArticleText,
  containerTag: "law_pltr_deals",
  entityContext: `This content is about Palantir Technologies (PLTR).
Extract facts about: new contracts, partnerships, deal sizes,
government clients, enterprise clients, and any financial impact.
This is for a trading law that monitors Palantir's business development.`,
});
```

**Response:**
```typescript
interface AddDocumentResponse {
  id: string;     // "doc_abc123xyz"
  status: string; // "queued"
}
```

---

### Batch Add Documents

`POST /v3/documents/batch`

```typescript
interface BatchDocument {
  content: string;
  containerTag?: string;
  entityContext?: string;
  customId?: string;
  metadata?: Record<string, unknown>;
}

const documents: BatchDocument[] = [
  {
    content: "PLTR Q1 2026 earnings beat EPS by 12%",
    containerTag: "law_pltr_earnings",
  },
  {
    content: "PLTR announced partnership with NHS UK",
    containerTag: "law_pltr_deals",
  },
  {
    content: "Analyst upgraded PLTR from Hold to Buy, target $95",
    containerTag: "law_pltr_deals",
  },
];

await smPost("/v3/documents/batch", { documents });
```

---

### Upload a File

`POST /v3/documents/upload`

```typescript
async function uploadFile(filePath: string, containerTag: string): Promise<void> {
  const file = await fs.readFile(filePath); // Node.js fs
  const formData = new FormData();
  formData.append("file", new Blob([file]), path.basename(filePath));
  formData.append("containerTag", containerTag);

  const res = await fetch(`${BASE}/v3/documents/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` }, // No Content-Type — let fetch set boundary
    body: formData,
  });
  if (!res.ok) throw new Error(`Upload failed: ${await res.text()}`);
}

await uploadFile("palantir_annual_report_2025.pdf", "law_pltr_corpus");
```

---

### Ingest or Update Conversation

`POST /v3/conversations`

Purpose-built for conversation history. More semantically aware than raw `add`.

```typescript
interface ConversationMessage {
  role: string;
  content: string;
}

const debateTranscript: ConversationMessage[] = [
  { role: "user", content: "What do you think about the NHS deal?" },
  { role: "assistant", content: "The NHS deal is significant. $180M over 5 years..." },
  { role: "user", content: "Do you think we should go long?" },
  { role: "assistant", content: "Based on historical comparable deals, yes..." },
];

await smPost("/v3/conversations", {
  conversation: debateTranscript,
  containerTag: "law_pltr_deals",
  customId: "debate_2026_05_03", // use same ID to update later
});
```

Use the same `customId` to update an ongoing conversation — Supermemory extends rather than duplicates.

---

### Update Document

`PATCH /v3/documents/{id}`

```typescript
await smPatch(`/v3/documents/${docId}`, {
  content: "Updated content here",
  metadata: { outcome: "profitable", pnl: 0.072 },
});
```

---

### Delete Document

`DELETE /v3/documents/{id}`

```typescript
// By document ID
await smDelete(`/v3/documents/${docId}`);

// By customId
await smDelete("/v3/documents", { customId: "debate_2026_05_03" });
```

---

### Bulk Delete

`DELETE /v3/documents/bulk`

Wipe an entire container's documents:

```typescript
await smDelete("/v3/documents/bulk", { containerTag: "law_pltr_deals" });
```

---

## Core API — Search & Recall

### Search Memory Entries

`POST /v4/search`

The primary search endpoint. Returns ranked, relevant memories.

```typescript
interface SearchRequest {
  q: string;
  containerTag?: string;
  limit?: number;        // 1-100, default 10
  threshold?: number;    // 0-1, default 0.6
  rerank?: boolean;      // cross-encoder reranking
  aggregate?: boolean;   // synthesize across memories
  rewriteQuery?: boolean; // LLM query rewriting (+400ms)
  searchMode?: "memories" | "documents" | "hybrid";
  filters?: Record<string, unknown>;
  filepath?: string;
}

interface MemoryContext {
  relation: "updates" | "extends" | "derives";
  memory: string;
  updatedAt: string;
  version: number;
  metadata?: Record<string, unknown>;
}

interface SearchResult {
  id: string;
  memory: string;
  similarity: number;
  version: number;
  updatedAt: string;
  metadata: Record<string, unknown>;
  context: {
    parents: MemoryContext[];
    children: MemoryContext[];
    related: MemoryContext[];
  };
  documents: Array<{
    id: string;
    title: string;
    type: string;
    metadata: Record<string, unknown>;
  }>;
}

interface SearchResponse {
  results: SearchResult[];
  timing: number;
  total: number;
}

const response = await smPost<SearchResponse>("/v4/search", {
  q: "Palantir government contract announcements",
  containerTag: "law_pltr_deals",
  limit: 5,
  threshold: 0.6,
  rerank: true,
  searchMode: "memories",
} satisfies SearchRequest);

// Access results
for (const result of response.results) {
  console.log(`[${result.similarity.toFixed(2)}] ${result.memory}`);
  console.log("History:", result.context.parents);
  console.log("Enrichment:", result.context.children);
}
```

**Useful search patterns:**

```typescript
// Strict — only high-confidence memories
const strict = await smPost<SearchResponse>("/v4/search", {
  q: "PLTR earnings beat",
  containerTag: "law_pltr_earnings",
  threshold: 0.8,
});

// Broad — cast wide net
const broad = await smPost<SearchResponse>("/v4/search", {
  q: "PLTR",
  containerTag: "law_pltr_deals",
  threshold: 0.3,
  limit: 20,
});

// Aggregate mode — synthesize across memories into new insights
const synthesized = await smPost<SearchResponse>("/v4/search", {
  q: "What is our current thesis on PLTR?",
  containerTag: "law_pltr_deals",
  aggregate: true,
  rerank: true,
});

// Hybrid mode — search both memories and raw document chunks
const hybrid = await smPost<SearchResponse>("/v4/search", {
  q: "NHS contract terms",
  containerTag: "law_pltr_deals",
  searchMode: "hybrid",
});
```

---

## Core API — Profiles

### Get User Profile

`POST /v4/profile`

The most important endpoint for your trading system. Returns the complete accumulated knowledge about a law/ticker in a single fast call.

```typescript
interface ProfileRequest {
  containerTag: string;
  q?: string;
  threshold?: number;
  filters?: Record<string, unknown>;
}

interface ProfileResponse {
  profile: {
    static: string[];   // long-term stable facts
    dynamic: string[];  // recent activity and context
  };
  searchResults: {
    results: SearchResult[];
    total: number;
    timing: number;
  };
}

const data = await smPost<ProfileResponse>("/v4/profile", {
  containerTag: "law_pltr_deals",
  q: "new Palantir government contracts announced this week",
  threshold: 0.6,
} satisfies ProfileRequest);

console.log("Stable facts:", data.profile.static);
console.log("Recent context:", data.profile.dynamic);
console.log("Relevant memories:", data.searchResults.results);
```

**Example response values:**

```typescript
// data.profile.static →
[
  "PLTR primarily serves US and EU government clients",
  "PLTR has historically moved 8-15% on major government contract announcements",
  "This law has fired 14 times since creation, 10 were profitable escalations",
  "Human weight for this law is 0.3",
]

// data.profile.dynamic →
[
  "Most recent trigger: NHS UK contract detection on 2026-05-03",
  "Current thesis: EU expansion is primary growth vector post-NHS deal",
  "Last trade outcome: BUY at $83.60, +7.2% over 5 days",
]
```

**How to use this in your agent:**

```typescript
async function buildAgentContext(lawId: string, freshEvent: string): Promise<string> {
  const data = await smPost<ProfileResponse>("/v4/profile", {
    containerTag: lawId,
    q: freshEvent,
    threshold: 0.65,
  });

  const staticFacts = data.profile.static.map((f) => `- ${f}`).join("\n");
  const dynamicFacts = data.profile.dynamic.map((f) => `- ${f}`).join("\n");
  const memories = data.searchResults.results
    .map((r) => `- [${r.similarity.toFixed(2)}] ${r.memory}`)
    .join("\n");

  return `## Law Memory Context

### Stable Facts
${staticFacts || "  (none yet)"}

### Recent Activity
${dynamicFacts || "  (none yet)"}

### Relevant Past Events
${memories || "  (none yet)"}`;
}
```

---

## Core API — Content Management

### Create Memories Directly

`POST /v3/memories`

Skip the extraction pipeline — write a memory directly as a structured fact. Use this when you already have clean, structured data.

```typescript
interface CreateMemoryRequest {
  memory: string;
  containerTag?: string;
  metadata?: Record<string, unknown>;
}

await smPost("/v3/memories", {
  memory: "PLTR NHS deal: 5-year contract, £180M, AI diagnostics platform, covers 50 NHS hospitals in England",
  containerTag: "law_pltr_deals",
  metadata: {
    event_type: "government_contract",
    ticker: "PLTR",
    deal_size_usd: 180_000_000,
    confidence: 0.83,
    triggered_escalation: true,
    date: "2026-05-03",
  },
} satisfies CreateMemoryRequest);
```

Use this instead of `add` when:
- You've already parsed structured data (e.g., from a Finnhub API response)
- You want precise control over exactly what gets stored
- You're writing system-level facts like law configuration

---

### Forget a Memory

`DELETE /v3/memories/{id}`

```typescript
await smDelete(`/v3/memories/${memoryId}`);
```

---

### Update a Memory (Creates New Version)

`PATCH /v3/memories/{id}`

Updates a memory by creating a new version with an `updates` relationship. The old version is preserved in history.

```typescript
await smPatch(`/v3/memories/${memoryId}`, {
  memory: "PLTR thesis: EU expansion is primary growth vector. NHS deal confirmed $180M. Target revised to $105.",
  metadata: {
    updated_at: "2026-05-03",
    version_reason: "post_nhs_deal",
  },
});
```

---

### List Memory Entries with History

`POST /v3/memories/list`

Retrieve memories with their full version history — the complete evolution of your knowledge on a company.

```typescript
const memories = await smPost("/v3/memories/list", {
  containerTag: "law_pltr_deals",
  includeHistory: true,
  limit: 50,
});
```

---

## Core API — Documents

### Get Document

```typescript
const doc = await smGet(`/v3/documents/${docId}`);
```

### Get Processing Documents

```typescript
const processing = await smGet("/v3/documents/processing");
```

### Get Document Chunks

```typescript
const chunks = await smGet(`/v3/documents/${docId}/chunks`);
```

### List Documents

```typescript
const docs = await smPost("/v3/documents/list", {
  containerTag: "law_pltr_deals",
  limit: 100,
});
```

### Search Documents

Search specifically over raw document chunks (not extracted memories):

```typescript
const results = await smPost("/v3/documents/search", {
  q: "NHS contract terms",
  containerTag: "law_pltr_deals",
});
```

---

## Core API — Knowledge Graph

### Get Graph Statistics

```typescript
interface GraphStats {
  totalMemories: number;
  totalDocuments: number;
  totalRelationships: number;
  relationshipTypes: {
    updates: number;
    extends: number;
    derives: number;
  };
}

const stats = await smGet<GraphStats>("/v3/graph/stats");
console.log(`Total memories: ${stats.totalMemories}`);
console.log(`Relationship breakdown:`, stats.relationshipTypes);
```

---

## Core API — Connections / Connectors

Available connectors: Google Drive, Notion, Slack, Gmail, S3.

### List Connections

```typescript
const connections = await smPost("/v3/connections/list", {});
```

### Create Connection

```typescript
await smPost("/v3/connections", {
  provider: "notion",
  containerTag: "system_global",
  config: {}, // provider-specific OAuth config
});
```

### Sync Connection

Force a re-sync:

```typescript
await smPost(`/v3/connections/${connectionId}/sync`, {});
```

### Delete Connection

```typescript
await smDelete(`/v3/connections/${connectionId}`);
```

---

## Core API — Container Tag Settings

### Get Settings

```typescript
const settings = await smGet("/v3/containers/law_pltr_deals/settings");
```

### Update Settings

```typescript
await smPatch("/v3/containers/law_pltr_deals/settings", {
  forgettingPolicy: "aggressive",
  profileUpdateInterval: "realtime",
});
```

### Merge Container Tags

```typescript
await smPost("/v3/containers/merge", {
  source: "law_pltr_deals_v1",
  target: "law_pltr_deals_v2",
});
```

### Delete Container Tag

Wipes everything in a container permanently:

```typescript
await smDelete("/v3/containers/law_pltr_deals");
```

---

## Conversation Ingestion API

`POST /v3/conversations`

The most natural API for trading systems — designed to ingest structured conversation history and extract all memories from it in one call.

```typescript
interface ConversationMessage {
  role: string;
  content: string;
}

interface IngestConversationRequest {
  conversation: ConversationMessage[];
  containerTag?: string;
  customId?: string;
  entityContext?: string;
}

const debateTranscript: ConversationMessage[] = [
  { role: "system", content: "Debate about PLTR NHS deal trade decision" },
  {
    role: "bull",
    content:
      "NHS deal is $180M, 5 years. Comparable EU gov deals moved PLTR 10-15%. EU expansion thesis is confirmed. Strong BUY.",
  },
  {
    role: "bear",
    content:
      "Partially priced in. USD/GBP headwind on reported revenues. Macro uncertainty. HOLD or small position.",
  },
  {
    role: "human",
    content: "I lean BUY. NHS validates the EU government thesis I've had since Q3 2025.",
  },
  {
    role: "moderator",
    content:
      "Final decision: BUY, confidence 0.74. 40 shares at $83.60. Bear's macro concern noted.",
  },
];

await smPost("/v3/conversations", {
  conversation: debateTranscript,
  containerTag: "law_pltr_deals",
  customId: "debate_2026_05_03_nhs",
  entityContext:
    "This is a multi-agent trading debate about Palantir (PLTR). " +
    "Extract: the decision made, confidence score, key arguments from each side, " +
    "and the triggering event. Mark the final trade decision as a fact.",
} satisfies IngestConversationRequest);
```

Supermemory extracts from this conversation:
- "Debate on 2026-05-03: BUY decision at confidence 0.74"
- "NHS deal confirmed EU expansion thesis"
- "Bear argued: partial pricing, FX headwind, macro uncertainty"
- "Bull argued: comparable deals moved 10-15%, EU validation"
- "Human validated BUY with EU thesis from Q3 2025"

All linked in the graph to prior related memories.

---

## TypeScript SDK — Complete Reference

```typescript
import Supermemory from "supermemory";

const client = new Supermemory(); // reads SUPERMEMORY_API_KEY from env

// ─── client.add() ─────────────────────────────────────────────────────────────
interface AddRequest {
  content: string;
  containerTag?: string;
  entityContext?: string;
  customId?: string;
  metadata?: Record<string, unknown>;
}

const addResult = await client.add({
  content: "...",
  containerTag: "my_law",
  entityContext: "Guide extraction toward trading-relevant facts",
} satisfies AddRequest);
// addResult: { id: string; status: string }


// ─── client.search() ──────────────────────────────────────────────────────────
const searchResult = await client.search({
  q: "...",
  containerTag: "my_law",
  limit: 5,
  threshold: 0.65,
  rerank: true,
  searchMode: "memories",
});
// searchResult.results: SearchResult[]
// searchResult.timing: number (ms)
// searchResult.total: number


// ─── client.profile() ─────────────────────────────────────────────────────────
const profile = await client.profile({
  containerTag: "my_law",
  q: "fresh event text",
  threshold: 0.6,
});
// profile.profile.static: string[]   — stable facts
// profile.profile.dynamic: string[]  — recent context
// profile.searchResults.results: SearchResult[]
```

---

## TypeScript Types Reference

Full type definitions for everything you'll interact with:

```typescript
// ─── Core Types ───────────────────────────────────────────────────────────────

type RelationType = "updates" | "extends" | "derives";
type SearchMode = "memories" | "documents" | "hybrid";

interface MemoryRelation {
  relation: RelationType;
  memory: string;
  updatedAt: string;
  version: number;
  metadata?: Record<string, unknown>;
}

interface MemoryContext {
  parents: MemoryRelation[];   // what this memory superseded
  children: MemoryRelation[];  // what extends or derives from this
  related: MemoryRelation[];
}

interface DocumentRef {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  type: string;
  metadata: Record<string, unknown>;
  summary?: string;
}

interface SearchResult {
  id: string;
  memory: string;
  similarity: number;   // 0-1 relevance score
  version: number;      // increments on each update
  updatedAt: string;
  metadata: Record<string, unknown>;
  context: MemoryContext;
  documents: DocumentRef[];
  isAggregated: boolean;
}

interface SearchResponse {
  results: SearchResult[];
  timing: number;  // milliseconds
  total: number;
}

interface ProfileData {
  static: string[];    // long-term stable facts
  dynamic: string[];   // recent activity/context
}

interface ProfileResponse {
  profile: ProfileData;
  searchResults: SearchResponse;
}

// ─── Request Types ────────────────────────────────────────────────────────────

interface AddDocumentRequest {
  content: string;
  containerTag?: string;
  entityContext?: string;  // max 1500 chars
  customId?: string;
  metadata?: Record<string, unknown>;
}

interface SearchRequest {
  q: string;
  containerTag?: string;
  limit?: number;          // 1-100, default 10
  threshold?: number;      // 0-1, default 0.6
  rerank?: boolean;
  aggregate?: boolean;
  rewriteQuery?: boolean;  // +400ms latency
  searchMode?: SearchMode;
  filters?: Record<string, unknown>;
  filepath?: string;
}

interface ProfileRequest {
  containerTag: string;
  q?: string;
  threshold?: number;
  filters?: Record<string, unknown>;
}

interface CreateMemoryRequest {
  memory: string;
  containerTag?: string;
  metadata?: Record<string, unknown>;
}

interface ConversationMessage {
  role: string;
  content: string;
}

interface IngestConversationRequest {
  conversation: ConversationMessage[];
  containerTag?: string;
  customId?: string;
  entityContext?: string;
}

// ─── Response Types ───────────────────────────────────────────────────────────

interface AddDocumentResponse {
  id: string;
  status: "queued" | "extracting" | "chunking" | "embedding" | "indexing" | "done";
}

interface GraphStats {
  totalMemories: number;
  totalDocuments: number;
  totalRelationships: number;
  relationshipTypes: {
    updates: number;
    extends: number;
    derives: number;
  };
}

// ─── Law-Specific Types (your trading system) ─────────────────────────────────

type TradeDecision = "BUY" | "SELL" | "HOLD" | "NOTIFY";

interface LawDefinition {
  lawId: string;
  ticker: string;
  triggerDescription: string;
  confidenceThreshold: number;
  humanWeight: number;          // 0.0 to 1.0
}

interface TriggerEvent {
  lawId: string;
  ticker: string;
  eventSummary: string;
  confidence: number;
  escalated: boolean;
  timestamp: string;
}

interface TradeOutcome {
  lawId: string;
  ticker: string;
  decision: TradeDecision;
  entryPrice: number;
  exitPrice: number;
  daysHeld: number;
  pnlPct: number;
}

interface NewsItem {
  headline: string;
  summary: string;
  datetime: number;
  source: string;
  url: string;
}
```

---

## Trading System Integration — Full Pattern

### Supermemory Client Wrapper

A typed wrapper that handles all trading system patterns cleanly:

```typescript
import Supermemory from "supermemory";

const BASE = "https://api.supermemory.ai";
const API_KEY = process.env.SUPERMEMORY_API_KEY!;
const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

async function smPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`SM ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ─── Core Utility Functions ───────────────────────────────────────────────────

async function getLawContext(
  lawId: string,
  query: string,
  threshold = 0.65
): Promise<string> {
  const data = await smPost<ProfileResponse>("/v4/profile", {
    containerTag: lawId,
    q: query,
    threshold,
  });

  const staticFacts = data.profile.static.map((f) => `  - ${f}`).join("\n");
  const dynamicFacts = data.profile.dynamic.map((f) => `  - ${f}`).join("\n");
  const memories = data.searchResults.results
    .map((r) => `  - [${r.similarity.toFixed(2)}] ${r.memory}`)
    .join("\n");

  return `STABLE FACTS:
${staticFacts || "  (none yet)"}

RECENT ACTIVITY:
${dynamicFacts || "  (none yet)"}

RELEVANT PAST EVENTS:
${memories || "  (none yet)"}`;
}

async function storeEvent(
  lawId: string,
  content: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await smPost("/v3/memories", {
    memory: content,
    containerTag: lawId,
    metadata: metadata ?? {},
  });
}

async function storeDebate(
  lawId: string,
  debateMessages: ConversationMessage[],
  debateId: string
): Promise<void> {
  await smPost("/v3/conversations", {
    conversation: debateMessages,
    containerTag: lawId,
    customId: debateId,
    entityContext:
      "Extract: trading decision, confidence score, key arguments, " +
      "triggering event, and final outcome.",
  });
}
```

---

### Law Initialization (One-Time)

```typescript
async function initializeLaw(law: LawDefinition): Promise<void> {
  const { lawId, ticker, triggerDescription, confidenceThreshold, humanWeight } = law;

  await storeEvent(
    lawId,
    `LAW DEFINITION: ${lawId}
Ticker: ${ticker}
Trigger: ${triggerDescription}
Confidence threshold for escalation: ${confidenceThreshold}
Human weight in debates: ${humanWeight}
Created: ${new Date().toISOString()}`,
    {
      event_type: "law_definition",
      ticker,
      threshold: confidenceThreshold,
      human_weight: humanWeight,
    }
  );

  console.log(`Law ${lawId} initialized in Supermemory`);
}

// Usage
await initializeLaw({
  lawId: "law_pltr_deals",
  ticker: "PLTR",
  triggerDescription:
    "Watch for Palantir new enterprise or government deals. " +
    "Trigger when deal size likely material to stock movement.",
  confidenceThreshold: 0.75,
  humanWeight: 0.3,
});
```

---

### Heartbeat (Every 5 Minutes Per Law)

```typescript
interface HeartbeatResult {
  escalate: boolean;
  summary?: string;
  confidence?: number;
}

async function lawHeartbeat(
  lawId: string,
  ticker: string,
  freshNews: NewsItem[],
  runInference: (prompt: string) => Promise<{ confidence: number; summary: string }>
): Promise<HeartbeatResult> {
  const ESCALATION_THRESHOLD = 0.75;

  // Build fresh event summary from last 5 news items
  const eventSummary = freshNews
    .slice(0, 5)
    .map((item) => `- ${item.headline}: ${item.summary}`)
    .join("\n");

  // Pull memory context — profile + relevant past events
  const context = await getLawContext(lawId, eventSummary, 0.6);

  // Build prompt for small watcher model (Qwen)
  const prompt = `You are watching the law: ${lawId}

MEMORY CONTEXT (what we know and have seen before):
${context}

FRESH DATA (last 5 minutes):
${eventSummary}

Question: Is there high-entropy, potentially law-relevant new information here?
If yes: summarize the event and give a confidence score (0-1).
If no: respond "NO_TRIGGER".`;

  const result = await runInference(prompt);

  if (result.confidence > ESCALATION_THRESHOLD) {
    // Store the trigger event as a memory
    await storeEvent(
      lawId,
      `TRIGGER FIRED ${new Date().toISOString()}: ${result.summary} [confidence: ${result.confidence}]`,
      {
        event_type: "trigger",
        confidence: result.confidence,
        escalated: true,
        ticker,
      }
    );

    return { escalate: true, summary: result.summary, confidence: result.confidence };
  }

  return { escalate: false };
}
```

---

### Storing a Debate Outcome

```typescript
async function storeDebateOutcome(
  lawId: string,
  ticker: string,
  decision: TradeDecision,
  confidence: number,
  triggerEvent: string,
  bullReasoning: string,
  bearReasoning: string,
  humanOpinion: string | null,
  debateMessages: ConversationMessage[]
): Promise<void> {
  // Store structured outcome as a direct memory
  await storeEvent(
    lawId,
    `TRADE DECISION ${ticker} — ${decision}
Confidence: ${confidence}
Trigger: ${triggerEvent}
Bull position: ${bullReasoning}
Bear position: ${bearReasoning}
Human opinion: ${humanOpinion ?? "not provided"}
Timestamp: ${new Date().toISOString()}`,
    {
      event_type: "trade_decision",
      ticker,
      decision,
      confidence,
    }
  );

  // Also store full debate transcript for rich extraction
  await storeDebate(
    lawId,
    debateMessages,
    `debate_${ticker}_${Date.now()}`
  );
}
```

---

### Post-Trade Outcome Tracking

```typescript
async function recordTradeOutcome(outcome: TradeOutcome): Promise<void> {
  const { lawId, ticker, decision, entryPrice, exitPrice, daysHeld } = outcome;
  const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;

  await storeEvent(
    lawId,
    `TRADE OUTCOME ${ticker} — ${new Date().toISOString()}
Decision: ${decision} at $${entryPrice.toFixed(2)}
Exit: $${exitPrice.toFixed(2)} after ${daysHeld} days
P&L: ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%
Result: ${pnlPct > 0 ? "PROFITABLE" : "UNPROFITABLE"}`,
    {
      event_type: "trade_outcome",
      ticker,
      decision,
      pnl_pct: pnlPct,
      entry_price: entryPrice,
      exit_price: exitPrice,
      days_held: daysHeld,
    }
  );
}

// Usage
await recordTradeOutcome({
  lawId: "law_pltr_deals",
  ticker: "PLTR",
  decision: "BUY",
  entryPrice: 83.60,
  exitPrice: 89.65,
  daysHeld: 5,
  pnlPct: 7.24,
});
```

---

### Cross-Law Context (Big Agent Research)

When the big agent does deep research, it can query across all laws:

```typescript
async function getCrossLawContext(query: string): Promise<string> {
  // No containerTag = search everything
  const results = await smPost<SearchResponse>("/v4/search", {
    q: query,
    limit: 10,
    rerank: true,
    threshold: 0.65,
  });

  return results.results
    .map((r) => `[${r.similarity.toFixed(2)}] ${r.memory}`)
    .join("\n");
}

// Usage: big agent searching for patterns across all laws
const context = await getCrossLawContext(
  "government contracts defense technology companies"
);
```

---

## Benchmarks & Performance

| Benchmark | Score | Notes |
|---|---|---|
| LongMemEval (overall) | **85.4%** | vs Mem0 49%, Zep 71% |
| LongMemEval single-session | **92.3%** | — |
| LongMemEval knowledge updates | **89.7%** | — |
| LoCoMo | #1 ranked | — |
| ConvoMem | #1 ranked | — |
| Retrieval latency | **< 300ms** | p99, production |
| Monthly throughput | 100B+ tokens | — |

---

## Pricing & Free Tier

| Tier | Cost | Allowance |
|---|---|---|
| **Free** | $0 | 1M tokens, 10K queries/month |
| Paid | Usage-based | Scales with consumption |
| Enterprise | Contact | VPC deployment, SLA, custom |

The free tier is generous for development and early production. 1M tokens is roughly:
- ~4,000 typical memory add operations
- ~10,000 search queries
- Running a 2-3 law system for several weeks

---

## Quick Reference Card

```typescript
import Supermemory from "supermemory";

const client = new Supermemory(); // reads SUPERMEMORY_API_KEY from env

// ─── ADD ──────────────────────────────────────────────────────────────────────
await client.add({ content: "...", containerTag: "my_law" });

// ─── SEARCH ───────────────────────────────────────────────────────────────────
const results = await client.search({ q: "...", containerTag: "my_law", limit: 5 });
for (const r of results.results) {
  console.log(r.memory, r.similarity);
  console.log(r.context.parents);   // what this memory superseded
}

// ─── PROFILE (most useful) ────────────────────────────────────────────────────
const p = await client.profile({ containerTag: "my_law", q: "fresh event text" });
console.log(p.profile.static);              // stable facts
console.log(p.profile.dynamic);             // recent context
console.log(p.searchResults.results);       // relevant past memories

// ─── DIRECT MEMORY WRITE ──────────────────────────────────────────────────────
await fetch("https://api.supermemory.ai/v3/memories", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.SUPERMEMORY_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    memory: "clean fact",
    containerTag: "my_law",
    metadata: { event_type: "trigger", confidence: 0.82 },
  }),
});

// ─── CONVERSATION INGEST ──────────────────────────────────────────────────────
await fetch("https://api.supermemory.ai/v3/conversations", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.SUPERMEMORY_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    conversation: [{ role: "user", content: "..." }],
    containerTag: "my_law",
    customId: "debate_001",
  }),
});

// ─── SCOPING STRATEGY ─────────────────────────────────────────────────────────
// "law_pltr_deals"    → PLTR deals law memory
// "law_pltr_earnings" → PLTR earnings law memory
// "system_global"     → cross-law facts, human preferences
// (no containerTag)   → search all memory globally
```

---

*Base URL: `https://api.supermemory.ai` | TypeScript SDK: `npm install supermemory` | Docs: `supermemory.ai/docs`*