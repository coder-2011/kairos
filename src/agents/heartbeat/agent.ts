import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { buildHeartbeatUserMessage, HEARTBEAT_SYSTEM_PROMPT } from "./prompt.js";
import {
  heartbeatOutputSchema,
  heartbeatSeedBundleSchema,
} from "./schema.js";
import { buildHeartbeatSeedBundle } from "./seed.js";
import type {
  BranchConfig,
  EscalationEvent,
  HeartbeatOutput,
  HeartbeatSeedBundle,
  HeartbeatSeedDataProviders,
} from "./types.js";
import { createEscalationEvent } from "./escalation.js";

type StructuredHeartbeatModel = {
  withStructuredOutput: (
    schema: typeof heartbeatOutputSchema,
  ) => {
    invoke: (input: unknown) => Promise<unknown>;
  };
  bindTools?: (tools: HeartbeatTool[]) => {
    invoke: (input: BaseMessage[]) => Promise<{
      tool_calls?: Array<{
        id?: string;
        name: string;
        args: unknown;
      }>;
    }>;
  };
};

export type HeartbeatTool = {
  name: string;
  invoke: (input: never) => Promise<unknown>;
};

export type HeartbeatAgentDependencies = {
  model: StructuredHeartbeatModel;
  seedProviders?: HeartbeatSeedDataProviders;
  tools?: HeartbeatTool[];
  now?: () => Date;
};

export type HeartbeatRunResult = {
  output: HeartbeatOutput;
  seedBundle: HeartbeatSeedBundle;
  escalationEvent: EscalationEvent | null;
};

const HeartbeatGraphState = Annotation.Root({
  branch: Annotation<BranchConfig>(),
  seedBundle: Annotation<HeartbeatSeedBundle | undefined>(),
  output: Annotation<HeartbeatOutput | undefined>(),
});

export function createHeartbeatAgentGraph(deps: HeartbeatAgentDependencies) {
  const buildSeedBundleNode = async (state: {
    branch: BranchConfig;
  }): Promise<{ seedBundle: HeartbeatSeedBundle }> => {
    return {
      seedBundle: await buildHeartbeatSeedBundle(
        state.branch,
        deps.seedProviders,
        deps.now?.() ?? new Date(),
      ),
    };
  };

  const callHeartbeatModelNode = async (state: {
    seedBundle?: HeartbeatSeedBundle;
  }): Promise<{ output: HeartbeatOutput }> => {
    if (!state.seedBundle) {
      throw new Error("Heartbeat seed bundle was not built before model call.");
    }

    const messages = await runBoundedToolPass(deps.model, deps.tools ?? [], [
      new SystemMessage(HEARTBEAT_SYSTEM_PROMPT),
      new HumanMessage(buildHeartbeatUserMessage(state.seedBundle)),
    ]);

    const structuredModel = deps.model.withStructuredOutput(heartbeatOutputSchema);
    const rawOutput = await structuredModel.invoke(messages);
    const parsed = heartbeatOutputSchema.parse(rawOutput);

    return {
      output: {
        ...parsed,
        branch_id: state.seedBundle.branchId,
        timestamp: state.seedBundle.timestamp,
      },
    };
  };

  return new StateGraph(HeartbeatGraphState)
    .addNode("buildSeedBundle", buildSeedBundleNode)
    .addNode("callHeartbeatModel", callHeartbeatModelNode)
    .addEdge(START, "buildSeedBundle")
    .addEdge("buildSeedBundle", "callHeartbeatModel")
    .addEdge("callHeartbeatModel", END)
    .compile();
}

async function runBoundedToolPass(
  model: StructuredHeartbeatModel,
  tools: HeartbeatTool[],
  messages: BaseMessage[],
): Promise<BaseMessage[]> {
  if (!model.bindTools || tools.length === 0) {
    return messages;
  }

  const toolModel = model.bindTools(tools);
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const response = await toolModel.invoke(messages);
  const toolCalls = response.tool_calls ?? [];

  if (toolCalls.length === 0) {
    return messages;
  }

  const toolMessages = await Promise.all(
    toolCalls.map(async (toolCall) => {
      const selectedTool = toolsByName.get(toolCall.name);
      const content = selectedTool
        ? JSON.stringify(await selectedTool.invoke(toolCall.args as never))
        : `Unknown tool: ${toolCall.name}`;

      return new ToolMessage({
        content,
        name: toolCall.name,
        tool_call_id: toolCall.id ?? toolCall.name,
      });
    }),
  );

  return [...messages, ...toolMessages];
}

export async function runHeartbeatAgent(
  branch: BranchConfig,
  deps: HeartbeatAgentDependencies,
): Promise<HeartbeatRunResult> {
  if (!branch.heartbeat.enabled) {
    throw new Error(`Heartbeat is disabled for branch ${branch.id}.`);
  }

  const graph = createHeartbeatAgentGraph(deps);
  const result = await graph.invoke({ branch });
  const output = heartbeatOutputSchema.parse(result.output);
  const seedBundle = heartbeatSeedBundleSchema.parse(result.seedBundle);

  return {
    output,
    seedBundle,
    escalationEvent: createEscalationEvent(output, seedBundle),
  };
}
