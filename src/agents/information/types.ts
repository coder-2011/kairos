import type { Citation } from "../debate/types.js";
import type { ExaApi } from "../../api/exa.js";
import type { FinnhubApi } from "../../api/finnhub.js";
import type { SupermemoryApi } from "../../api/supermemory.js";

export type InformationToolName =
  | "exa_search"
  | "exa_research"
  | "exa_contents"
  | "finnhub_quote"
  | "finnhub_company_news"
  | "finnhub_basic_financials"
  | "supermemory_search";

export type InformationContext = {
  ticker?: string;
  debateId?: string;
  lawId?: string;
  branchId?: string;
  containerTag?: string;
};

export type InformationRequest = {
  query: string;
  context?: InformationContext;
};

export type InformationPlan = {
  reasoning: string;
  toolCalls: Array<{
    toolName: InformationToolName;
    input: string;
  }>;
};

export type InformationToolResult = {
  toolName: InformationToolName;
  input: string;
  summary: string;
  citations: Citation[];
  raw?: unknown;
};

export type InformationResult = {
  summary: string;
  citations: Citation[];
  toolResults: InformationToolResult[];
};

export type StructuredInformationModel<T> = {
  invoke: (input: unknown) => Promise<T>;
};

export type StructuredInformationModelProvider = {
  withStructuredOutput: <T>(schema: unknown) => StructuredInformationModel<T>;
};

export type InformationAgentDependencies = {
  model?: StructuredInformationModelProvider;
  exa?: ExaApi;
  finnhub?: FinnhubApi;
  supermemory?: SupermemoryApi;
  now?: () => Date;
};
