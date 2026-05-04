import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { chromium, expect } from "playwright/test";

type RunRecord = {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  output?: Record<string, unknown>;
};

const appUrl = process.env.KAIROS_QA_BASE_URL ?? "http://127.0.0.1:5173";
const apiUrl = process.env.KAIROS_API_URL ?? "http://127.0.0.1:4321";
const outputDir = process.env.KAIROS_QA_OUTPUT_DIR ?? "data/runtime/qa";

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

try {
  await page.goto(`${appUrl}/#/branches`, { waitUntil: "networkidle" });
  await assertNoPageOverflow(page);
  await page.screenshot({ path: join(outputDir, "regression-branches-desktop.png"), fullPage: true });

  await page.goto(`${appUrl}/#/monitoring`, { waitUntil: "networkidle" });
  await assertNoPageOverflow(page);
  await expect(page.getByText(/TRUTH LEDGER|No Run Selected/).first()).toBeVisible();
  await page.screenshot({ path: join(outputDir, "regression-monitoring-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${appUrl}/#/branches`, { waitUntil: "networkidle" });
  await assertNoPageOverflow(page);
  await page.screenshot({ path: join(outputDir, "regression-branches-mobile.png"), fullPage: true });

  await assertRuntimeInvariants();
} finally {
  await browser.close();
}

async function assertNoPageOverflow(target: typeof page): Promise<void> {
  const fit = await target.evaluate(() => ({
    innerWidth,
    innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  if (fit.scrollWidth > fit.innerWidth) {
    throw new Error(`Page has horizontal overflow: ${JSON.stringify(fit)}`);
  }
}

async function assertRuntimeInvariants(): Promise<void> {
  const response = await fetch(`${apiUrl}/runs`, {
    headers: localApiHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Unable to read runs from ${apiUrl}: ${response.status}`);
  }

  const payload = await response.json() as { runs?: RunRecord[] };
  const runs = payload.runs ?? [];
  const staleRunningDebate = runs.find((run) => {
    if (run.kind !== "debate" || run.status !== "running") return false;
    return Date.now() - Date.parse(run.createdAt) > 130_000;
  });
  if (staleRunningDebate) {
    throw new Error(`Debate stayed running past timeout: ${staleRunningDebate.id}`);
  }

  const routerWithoutOutput = runs.find((run) => {
    if (run.kind !== "router") return false;
    const outputText = JSON.stringify(run.output ?? {});
    return outputText.includes("No output recorded");
  });
  if (routerWithoutOutput) {
    throw new Error(`Router run still records empty output text: ${routerWithoutOutput.id}`);
  }
}

function localApiHeaders(): HeadersInit {
  const authEnabled = parseAuthEnabledFlag(process.env.KAIROS_AUTH_ENABLED);
  if (authEnabled ?? false) return {};

  return {
    "x-kairos-local-request": "1",
    ...(process.env.KAIROS_LOCAL_API_TOKEN
      ? { "x-kairos-local-token": process.env.KAIROS_LOCAL_API_TOKEN }
      : {}),
  };
}

function parseAuthEnabledFlag(value: unknown): boolean | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["0", "false", "off", "no", "disabled"].includes(normalized)) return false;
  if (["1", "true", "on", "yes", "enabled"].includes(normalized)) return true;
  return undefined;
}
