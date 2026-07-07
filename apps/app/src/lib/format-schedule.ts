import { toString as cronstrueToString } from "cronstrue";

export type AutomationTrigger =
  | { triggerType: "schedule"; cron: string; timezone: string }
  | { triggerType: "once"; runAt: number };

const SCHEDULE_RUN_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export interface FormatScheduleStatusLabelArgs {
  enabled: boolean;
  nextRunAt: number | null;
  trigger?: AutomationTrigger;
  runCount?: number;
}

export interface CompletedOneShotAutomationArgs {
  enabled: boolean;
  trigger: AutomationTrigger;
  runCount: number;
}

const DAY_ABBREVIATION: Record<string, string> = {
  Sunday: "Sun",
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
};

export function formatCronCadence(cron: string): string {
  let text: string;
  try {
    text = cronstrueToString(cron, { verbose: false });
  } catch {
    return "Custom schedule";
  }
  return text
    .replace(/^At /u, "")
    .replace(
      /\b0?(\d{1,2}):(\d{2})\s*(AM|PM)\b/gu,
      (_all, hour, minute, meridiem) =>
        minute === "00" ? `${hour}${meridiem}` : `${hour}:${minute}${meridiem}`,
    )
    .replace(
      /\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/gu,
      (day) => DAY_ABBREVIATION[day] ?? day,
    )
    .replace(/ through /gu, "-")
    .replace(/,? only on /gu, " ")
    .replace(/,? and /gu, ", ")
    .replace(/\bminutes?\b/gu, "min")
    .replace(/\bseconds?\b/gu, "sec")
    .replace(/([AP]M),\s+/gu, "$1 ")
    .trim();
}

export function formatAutomationTrigger(trigger: AutomationTrigger): string {
  if (trigger.triggerType === "once") {
    return `Once at ${formatScheduleRunTime(trigger.runAt)}`;
  }
  return `${formatCronCadence(trigger.cron)} · ${trigger.timezone}`;
}

export function isCompletedOneShotAutomation({
  enabled,
  trigger,
  runCount,
}: CompletedOneShotAutomationArgs): boolean {
  return trigger.triggerType === "once" && !enabled && runCount > 0;
}

export function formatScheduleRunTime(timestamp: number): string {
  return SCHEDULE_RUN_FORMATTER.format(new Date(timestamp));
}

export function formatScheduleStatusLabel({
  enabled,
  nextRunAt,
  trigger,
  runCount = 0,
}: FormatScheduleStatusLabelArgs): string {
  if (
    trigger !== undefined &&
    isCompletedOneShotAutomation({ enabled, trigger, runCount })
  ) {
    return "Completed";
  }
  if (!enabled) return "Paused";
  if (nextRunAt === null) return "Not scheduled";
  return `Next ${formatScheduleRunTime(nextRunAt)}`;
}
