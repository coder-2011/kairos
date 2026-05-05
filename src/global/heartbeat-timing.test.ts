import { describe, expect, it } from "vitest";

import {
  isHeartbeatTimingActiveAt,
  normalizeHeartbeatTimingConfig,
} from "./heartbeat-timing.js";

describe("heartbeat timing config", () => {
  it("defaults missing active days to the open-market weekdays", () => {
    expect(normalizeHeartbeatTimingConfig(undefined).activeDays).toEqual([
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
    ]);
  });

  it("preserves an explicit empty active day selection as inactive", () => {
    const timing = {
      mode: "custom" as const,
      activeDays: [],
      startTime: "00:00",
      endTime: "23:59",
      timezone: "UTC",
    };

    expect(normalizeHeartbeatTimingConfig(timing).activeDays).toEqual([]);
    expect(
      isHeartbeatTimingActiveAt(timing, new Date("2026-05-04T12:00:00.000Z")),
    ).toBe(false);
  });
});
