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

  it("uses the configured timezone when evaluating market windows", () => {
    const timing = {
      mode: "open_market" as const,
      timezone: "America/New_York",
    };

    expect(
      isHeartbeatTimingActiveAt(timing, new Date("2026-05-04T13:29:00.000Z")),
    ).toBe(false);
    expect(
      isHeartbeatTimingActiveAt(timing, new Date("2026-05-04T13:30:00.000Z")),
    ).toBe(true);
    expect(
      isHeartbeatTimingActiveAt(timing, new Date("2026-05-04T20:01:00.000Z")),
    ).toBe(false);
  });

  it("does not let an invalid configured timezone break schedulers", () => {
    expect(
      isHeartbeatTimingActiveAt(
        {
          mode: "custom",
          activeDays: ["monday"],
          startTime: "00:00",
          endTime: "23:59",
          timezone: "Not/A_Timezone",
        },
        new Date("2026-05-04T12:00:00.000Z"),
      ),
    ).toBe(false);
  });
});
