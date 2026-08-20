import { Command } from "commander";
import {
  pushSubscriptionPlatformSchema,
  pushSubscriptionPlatformValues,
  type PushSubscription,
  type PushSubscriptionPlatform,
} from "@bb/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { renderBorderlessTable } from "../table.js";
import { formatMachineLastSeen } from "./machine.js";
import { outputJson, type JsonOutputOptions } from "./helpers.js";

// Commander enforces the three required options before the action runs.
interface PushSubscriptionAddCommandOptions extends JsonOutputOptions {
  token: string;
  platform: string;
  label: string;
}

function parsePlatform(value: string): PushSubscriptionPlatform {
  const parsed = pushSubscriptionPlatformSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid platform '${value}'. Expected one of: ${pushSubscriptionPlatformValues.join(", ")}.`,
    );
  }
  return parsed.data;
}

function printPushSubscriptionTable(
  subscriptions: readonly PushSubscription[],
): void {
  const now = Date.now();
  const rows = subscriptions.map((subscription) => [
    subscription.id,
    subscription.deviceLabel,
    subscription.platform,
    formatMachineLastSeen(subscription.lastSeenAt, now),
    subscription.expoPushToken,
  ]);
  const widths = [
    Math.max(2, ...rows.map((row) => row[0].length)),
    Math.max(6, ...rows.map((row) => row[1].length)),
    Math.max(8, ...rows.map((row) => row[2].length)),
    Math.max(9, ...rows.map((row) => row[3].length)),
    Math.max(5, ...rows.map((row) => row[4].length)),
  ];
  console.log("");
  console.log(
    renderBorderlessTable(
      {
        head: ["ID", "Device", "Platform", "Last seen", "Token"],
        colWidths: widths,
        trimTrailingWhitespace: true,
      },
      rows,
    ),
  );
  console.log("");
}

export function registerNotificationCommands(
  program: Command,
  getUrl: () => string,
): void {
  const notifications = program
    .command("notifications")
    .description("Manage push notifications for bb mobile devices");

  const pushSubscriptions = notifications
    .command("push-subscriptions")
    .description(
      "Devices registered for Expo push notifications (pending interactions, finished turns, errors)",
    );

  pushSubscriptions
    .command("list")
    .description("List registered push devices")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const subscriptions =
          await createCliBbSdk(getUrl()).notifications.pushSubscriptions.list();
        if (outputJson(opts, subscriptions)) return;
        if (subscriptions.length === 0) {
          console.log("No push devices registered");
          return;
        }
        printPushSubscriptionTable(subscriptions);
      }),
    );

  pushSubscriptions
    .command("add")
    .description(
      "Register an Expo push token, or refresh an existing registration",
    )
    .requiredOption("--token <expo-push-token>", "Expo push token")
    .requiredOption(
      "--platform <platform>",
      `Device platform (${pushSubscriptionPlatformValues.join(" or ")})`,
    )
    .requiredOption("--label <label>", "Human-readable device name")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: PushSubscriptionAddCommandOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).notifications.pushSubscriptions.add({
          expoPushToken: opts.token,
          platform: parsePlatform(opts.platform),
          deviceLabel: opts.label,
        });
        if (outputJson(opts, result)) return;
        const verb = result.created ? "Registered" : "Refreshed";
        console.log(
          `${verb} push device ${result.subscription.deviceLabel} (${result.subscription.id})`,
        );
      }),
    );

  pushSubscriptions
    .command("remove <id>")
    .description("Remove a registered push device")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: JsonOutputOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).notifications.pushSubscriptions.remove({ id });
        if (outputJson(opts, { id, ...result })) return;
        console.log(`Removed push device ${id}`);
      }),
    );
}
