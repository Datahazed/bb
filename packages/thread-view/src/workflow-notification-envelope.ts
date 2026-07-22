export const workflowNotificationStatusValues = [
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type WorkflowNotificationStatus =
  (typeof workflowNotificationStatusValues)[number];

export interface WorkflowNotificationEnvelope {
  bodyStart: number;
  name: string;
  runId: string;
  status: WorkflowNotificationStatus;
}

const WORKFLOW_NOTIFICATION_MARKER =
  /^\[BB workflow finished · ([^\]\r\n]+)\]\s*/iu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Recognizes the stable completion envelope emitted by the workflows plugin.
 * The payload remains ordinary prompt text for provider compatibility, while
 * timeline surfaces can use this header as presentation metadata. Returning
 * the exact body offset keeps the machine header out of the visible result.
 */
export function parseWorkflowNotificationEnvelope(
  text: string,
): WorkflowNotificationEnvelope | null {
  const marker = WORKFLOW_NOTIFICATION_MARKER.exec(text);
  if (marker === null) return null;

  const runId = marker[1]?.trim();
  if (!runId) return null;

  const statusLine = new RegExp(
    `^Run ${escapeRegExp(runId)} \\((.+?)\\) (${workflowNotificationStatusValues.join("|")})\\.\\s*`,
    "u",
  ).exec(text.slice(marker[0].length));
  if (statusLine === null) return null;

  const name = statusLine[1]?.trim();
  const status = statusLine[2] as WorkflowNotificationStatus | undefined;
  if (!name || status === undefined) return null;

  let bodyStart = marker[0].length + statusLine[0].length;
  while (bodyStart < text.length && /\s/u.test(text.charAt(bodyStart))) {
    bodyStart += 1;
  }

  return { bodyStart, name, runId, status };
}
