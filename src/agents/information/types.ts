import type { Citation } from "../debate/types.js";
import type { ExaApi } from "../../api/exa.js";
import type { FinnhubApi } from "../../api/finnhub.js";
import type { GlobalMemoryApi } from "../../global/memory.js";

export type InformationToolName =
  | "exa_search"
  | "exa_research"
  | "exa_contents"
  | "finnhub_quote"
  | "finnhub_company_news"
  | "finnhub_basic_financials"
  | "supermemory_search";

export type InformationRequest = {
  query: string;
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
};

export type StructuredInformationModel<T> = {
  invoke: (input: unknown) => Promise<T>;
};

export type StructuredInformationModelProvider = {
  withStructuredOutput: <T>(schema: unknown) => StructuredInformationModel<T>;
};

export type InformationExaClient = Pick<ExaApi, "search" | "answer" | "contents">;
export type InformationFinnhubClient = Pick<
  FinnhubApi,
  "quote" | "companyNews" | "basicFinancials"
>;
export type InformationSupermemoryClient = Pick<GlobalMemoryApi, "search">;

export type InformationAgentDependencies = {
  model?: StructuredInformationModelProvider;
  exa?: InformationExaClient;
  finnhub?: InformationFinnhubClient;
  memory?: InformationSupermemoryClient;
  supermemory?: InformationSupermemoryClient;
  supermemoryContainerTag?: string;
  now?: () => Date;
};
