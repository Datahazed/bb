import { z } from "zod";

export const clientTurnRequestStatusValues = [
  "pending",
  "accepted",
  "failed",
  "canceled",
  "expired",
] as const;
export const clientTurnRequestStatusSchema = z.enum(
  clientTurnRequestStatusValues,
);
export type ClientTurnRequestStatus = z.infer<
  typeof clientTurnRequestStatusSchema
>;

export const terminalClientTurnRequestStatusValues = [
  "accepted",
  "failed",
  "canceled",
  "expired",
] as const;
export const terminalClientTurnRequestStatusSchema = z.enum(
  terminalClientTurnRequestStatusValues,
);
export type TerminalClientTurnRequestStatus = z.infer<
  typeof terminalClientTurnRequestStatusSchema
>;

export const clientTurnRequestTerminalReasonValues = [
  "accepted",
  "command_succeeded",
  "command_failed",
  // Dead value: in-process settlement never expires a request (the queue-era
  // expiry sweep is gone), but the frozen frontend renders the reason, so the
  // value stays in the union (plan §4.2 dead-value rule).
  "command_expired",
  "runtime_canceled",
  "provider_detached",
  "provider_restarted",
] as const;
export const clientTurnRequestTerminalReasonSchema = z.enum(
  clientTurnRequestTerminalReasonValues,
);
export type ClientTurnRequestTerminalReason = z.infer<
  typeof clientTurnRequestTerminalReasonSchema
>;
