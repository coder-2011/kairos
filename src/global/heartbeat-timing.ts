import { z } from "zod";

export const heartbeatTimingModeSchema = z.enum([
  "open_market",
  "custom",
  "always",
]);

export const heartbeatActiveDaySchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);

export const heartbeatTimingConfigSchema = z
  .object({
    mode: heartbeatTimingModeSchema.optional(),
    activeDays: z.array(heartbeatActiveDaySchema).optional(),
    startTime: timeSchema.optional(),
    endTime: timeSchema.optional(),
    startDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
    timezone: z.string().min(1).optional(),
  })
  .strict();

export type HeartbeatTimingMode = z.infer<typeof heartbeatTimingModeSchema>;
export type HeartbeatActiveDay = z.infer<typeof heartbeatActiveDaySchema>;
export type HeartbeatTimingConfig = z.infer<typeof heartbeatTimingConfigSchema>;

export const HEARTBEAT_WEEKDAYS: readonly HeartbeatActiveDay[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
];

export const HEARTBEAT_ALL_DAYS: readonly HeartbeatActiveDay[] = [
  ...HEARTBEAT_WEEKDAYS,
  "saturday",
  "sunday",
];

export const DEFAULT_HEARTBEAT_TIMING_CONFIG: Readonly<
  Required<Pick<
    HeartbeatTimingConfig,
    "mode" | "activeDays" | "startTime" | "endTime" | "timezone"
  >>
> = {
  mode: "open_market",
  activeDays: [...HEARTBEAT_WEEKDAYS],
  startTime: "09:30",
  endTime: "16:00",
  timezone: "America/New_York",
};

export type NormalizedHeartbeatTimingConfig = {
  mode: HeartbeatTimingMode;
  activeDays: readonly HeartbeatActiveDay[];
  startTime: string;
  endTime: string;
  startDate?: string;
  endDate?: string;
  timezone: string;
};

export function normalizeHeartbeatTimingConfig(
  timing: HeartbeatTimingConfig | undefined,
): NormalizedHeartbeatTimingConfig {
  const mode = timing?.mode ?? DEFAULT_HEARTBEAT_TIMING_CONFIG.mode;
  if (mode === "always") {
    return {
      mode,
      activeDays: HEARTBEAT_ALL_DAYS,
      startTime: "00:00",
      endTime: "23:59",
      startDate: timing?.startDate,
      endDate: timing?.endDate,
      timezone: timing?.timezone ?? DEFAULT_HEARTBEAT_TIMING_CONFIG.timezone,
    };
  }

  return {
    mode,
    activeDays:
      timing?.activeDays !== undefined
        ? timing.activeDays
        : DEFAULT_HEARTBEAT_TIMING_CONFIG.activeDays,
    startTime: timing?.startTime ?? DEFAULT_HEARTBEAT_TIMING_CONFIG.startTime,
    endTime: timing?.endTime ?? DEFAULT_HEARTBEAT_TIMING_CONFIG.endTime,
    startDate: timing?.startDate,
    endDate: timing?.endDate,
    timezone: timing?.timezone ?? DEFAULT_HEARTBEAT_TIMING_CONFIG.timezone,
  };
}

export function isHeartbeatTimingActiveAt(
  timing: HeartbeatTimingConfig | undefined,
  at: Date = new Date(),
): boolean {
  const normalized = normalizeHeartbeatTimingConfig(timing);
  const local = localDateTimeParts(at, normalized.timezone);

  if (!dateWindowIncludes(local.date, normalized)) {
    return false;
  }
  if (normalized.mode === "always") {
    return true;
  }
  if (!normalized.activeDays.includes(local.day)) {
    return false;
  }

  return timeWindowIncludes(local.minutes, normalized.startTime, normalized.endTime);
}

export function heartbeatTimingSummary(
  timing: HeartbeatTimingConfig | undefined,
): string {
  const normalized = normalizeHeartbeatTimingConfig(timing);
  if (normalized.mode === "always") return "Always active";
  if (normalized.mode === "open_market") return "Open market";
  return `${formatTimeLabel(normalized.startTime)}-${formatTimeLabel(normalized.endTime)} ${normalized.timezone}`;
}

function dateWindowIncludes(
  date: string,
  timing: Pick<NormalizedHeartbeatTimingConfig, "startDate" | "endDate">,
): boolean {
  if (timing.startDate && date < timing.startDate) return false;
  if (timing.endDate && date > timing.endDate) return false;
  return true;
}

function timeWindowIncludes(
  minutes: number,
  startTime: string,
  endTime: string,
): boolean {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);

  if (start <= end) {
    return minutes >= start && minutes <= end;
  }

  return minutes >= start || minutes <= end;
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map((part) => Number(part));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return 0;
  }
  return hour * 60 + minute;
}

function localDateTimeParts(
  date: Date,
  timezone: string,
): {
  date: string;
  day: HeartbeatActiveDay;
  minutes: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const year = parts.year ?? "1970";
  const month = parts.month ?? "01";
  const dayOfMonth = parts.day ?? "01";
  const hour = Number(parts.hour ?? "0");
  const minute = Number(parts.minute ?? "0");

  return {
    date: `${year}-${month}-${dayOfMonth}`,
    day: weekdayToActiveDay(parts.weekday),
    minutes: hour * 60 + minute,
  };
}

function weekdayToActiveDay(value: string | undefined): HeartbeatActiveDay {
  switch (value?.toLowerCase()) {
    case "monday":
      return "monday";
    case "tuesday":
      return "tuesday";
    case "wednesday":
      return "wednesday";
    case "thursday":
      return "thursday";
    case "friday":
      return "friday";
    case "saturday":
      return "saturday";
    case "sunday":
      return "sunday";
    default:
      return "monday";
  }
}

function formatTimeLabel(value: string): string {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}
