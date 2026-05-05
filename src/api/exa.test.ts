import { describe, expect, it } from "vitest";

import { withUsageContext, type ProviderUsageEvent } from "../global/usage.js";
import { ExaApi } from "./exa.js";

describe("ExaApi usage metering", () => {
  it("records normalized cost events from search responses", async () => {
    const events: ProviderUsageEvent[] = [];
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        requestId: "exa_req_1",
        searchType: "auto",
        results: [
          {
            id: "result_1",
            title: "Result",
            url: "https://example.com/result",
          },
        ],
        costDollars: { total: 0.0123 },
      });

    const client = new ExaApi({
      apiKey: "exa_test",
      fetchImpl,
      retryAttempts: 1,
    });

    await withUsageContext(
      {
        requestId: "request_1",
        runId: "run_1",
        branchId: "branch_1",
        sink: (event) => {
          events.push(event);
        },
      },
      () => client.search({ query: "PLTR contract", numResults: 1 }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: "exa",
      operation: "search",
      status: "succeeded",
      requestId: "request_1",
      runId: "run_1",
      branchId: "branch_1",
      providerRequestId: "exa_req_1",
      costUsd: 0.0123,
      quotaUnits: 1,
      unit: "request",
      metadata: {
        searchType: "auto",
        resultCount: 1,
        requestedResults: 1,
      },
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
