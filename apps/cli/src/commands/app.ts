import { Command } from "commander";
import { appIdSchema, type AppId } from "@bb/domain";
import type {
  AppDetail,
  AppIcon,
  AppSummary,
  AppTemplate,
  CreateThreadAppRequest,
} from "@bb/server-contract";
import { appTemplateSchema } from "@bb/server-contract";
import { action } from "../action.js";
import { createClient, unwrap } from "../client.js";
import { renderBorderlessTable } from "../table.js";
import {
  confirmDestructiveAction,
  outputJson,
  printContextLabel,
  requireThreadIdWithLabelOrSelf,
} from "./helpers.js";

type ResolveServerUrl = () => string;

interface AppThreadCommandOptions {
  json?: boolean;
  self?: boolean;
}

interface AppNewCommandOptions extends AppThreadCommandOptions {
  id?: string;
  template?: string;
}

interface AppRemoveCommandOptions extends AppThreadCommandOptions {
  yes?: boolean;
}

interface ResolveAppCommandThreadArgs {
  options: AppThreadCommandOptions;
  threadId: string | undefined;
}

interface AppOpenPayload {
  app: AppDetail;
  threadId: string;
  url: string;
}

interface ResolveNewAppIdArgs {
  id: string | undefined;
  name: string;
}

function parseAppTemplate(value: string | undefined): AppTemplate {
  const parsed = appTemplateSchema.safeParse(value ?? "blank");
  if (!parsed.success) {
    throw new Error("Invalid app template. Expected 'blank' or 'status'.");
  }
  return parsed.data;
}

function resolveAppCommandThread(args: ResolveAppCommandThreadArgs): string {
  const resolved = requireThreadIdWithLabelOrSelf(
    args.threadId,
    args.options,
  );
  printContextLabel(resolved, "Thread", "BB_THREAD_ID", args.options);
  return resolved.id;
}

function slugifyAppName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function resolveNewAppId(args: ResolveNewAppIdArgs): AppId {
  const candidate = args.id ?? slugifyAppName(args.name);
  const parsed = appIdSchema.safeParse(candidate);
  if (parsed.success) {
    return parsed.data;
  }
  if (args.id !== undefined) {
    throw new Error(
      "Invalid app id. Use letters, numbers, underscores, or hyphens.",
    );
  }
  throw new Error(
    `Could not derive a valid app id from "${args.name}". Pass --id with letters, numbers, underscores, or hyphens.`,
  );
}

function appUrl(baseUrl: string, threadId: string, appId: string): string {
  return `${baseUrl.replace(/\/$/u, "")}/api/v1/threads/${encodeURIComponent(
    threadId,
  )}/apps/${encodeURIComponent(appId)}/`;
}

function formatIcon(icon: AppIcon): string {
  return icon.kind === "builtin" ? icon.name : "logo";
}

function printAppsTable(apps: AppSummary[]): void {
  if (apps.length === 0) {
    console.log("No apps");
    return;
  }
  console.log(
    renderBorderlessTable(
      {
        head: ["ID", "Name", "Entry", "Capabilities", "Icon"],
        colWidths: [24, 24, 24, 24, 18],
        trimTrailingWhitespace: true,
      },
      apps.map((app) => [
        app.id,
        app.name,
        `${app.entry.kind}:${app.entry.path}`,
        app.capabilities.join(",") || "-",
        formatIcon(app.icon),
      ]),
    ),
  );
}

function printAppDetail(app: AppDetail): void {
  console.log(`App created: ${app.id}`);
  console.log(`  Name:         ${app.name}`);
  console.log(`  Entry:        ${app.entry.kind}:${app.entry.path}`);
  console.log(`  Capabilities: ${app.capabilities.join(",") || "-"}`);
  console.log(`  Icon:         ${formatIcon(app.icon)}`);
}

export function registerAppCommands(
  program: Command,
  getUrl: ResolveServerUrl,
): void {
  const app = program.command("app").description("Manage thread apps");

  app
    .command("new <name> [threadId]")
    .description("Create a new app in a thread")
    .option("--id <appId>", "App id. Defaults to a slug derived from name.")
    .option("--template <template>", "App template: blank or status", "blank")
    .option("--self", "Target BB_THREAD_ID explicitly")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          name: string,
          threadIdArg: string | undefined,
          opts: AppNewCommandOptions,
        ) => {
          const threadId = resolveAppCommandThread({
            threadId: threadIdArg,
            options: opts,
          });
          const template = parseAppTemplate(opts.template);
          const client = createClient(getUrl());
          const request: CreateThreadAppRequest = {
            id: resolveNewAppId({ id: opts.id, name }),
            name,
            template,
          };
          const created = await unwrap<AppDetail>(
            client.api.v1.threads[":id"].apps.$post({
              param: { id: threadId },
              json: request,
            }),
          );
          if (outputJson(opts, created)) return;
          printAppDetail(created);
        },
      ),
    );

  app
    .command("list [threadId]")
    .description("List apps in a thread")
    .option("--self", "Target BB_THREAD_ID explicitly")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          threadIdArg: string | undefined,
          opts: AppThreadCommandOptions,
        ) => {
          const threadId = resolveAppCommandThread({
            threadId: threadIdArg,
            options: opts,
          });
          const client = createClient(getUrl());
          const apps = await unwrap<AppSummary[]>(
            client.api.v1.threads[":id"].apps.$get({
              param: { id: threadId },
            }),
          );
          if (outputJson(opts, apps)) return;
          printAppsTable(apps);
        },
      ),
    );

  app
    .command("open <name> [threadId]")
    .description("Print an app URL")
    .option("--self", "Target BB_THREAD_ID explicitly")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          name: string,
          threadIdArg: string | undefined,
          opts: AppThreadCommandOptions,
        ) => {
          const threadId = resolveAppCommandThread({
            threadId: threadIdArg,
            options: opts,
          });
          const baseUrl = getUrl();
          const client = createClient(baseUrl);
          const appDetail = await unwrap<AppDetail>(
            client.api.v1.threads[":id"].apps[":appId"].$get({
              param: { id: threadId, appId: name },
            }),
          );
          const payload: AppOpenPayload = {
            threadId,
            app: appDetail,
            url: appUrl(baseUrl, threadId, appDetail.id),
          };
          if (outputJson(opts, payload)) return;
          console.log(payload.url);
        },
      ),
    );

  app
    .command("rm <name> [threadId]")
    .description("Remove an app from a thread")
    .option("--yes", "Skip the confirmation prompt")
    .option("--self", "Target BB_THREAD_ID explicitly")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          name: string,
          threadIdArg: string | undefined,
          opts: AppRemoveCommandOptions,
        ) => {
          const threadId = resolveAppCommandThread({
            threadId: threadIdArg,
            options: opts,
          });
          const client = createClient(getUrl());
          const appDetail = await unwrap<AppDetail>(
            client.api.v1.threads[":id"].apps[":appId"].$get({
              param: { id: threadId, appId: name },
            }),
          );
          if (!opts.yes) {
            const confirmed = await confirmDestructiveAction(
              `Remove app "${appDetail.name}" from thread ${threadId}? This cannot be undone.`,
            );
            if (!confirmed) {
              console.log(`App ${name} removal cancelled`);
              return;
            }
          }
          await unwrap<{ ok: true }>(
            client.api.v1.threads[":id"].apps[":appId"].$delete({
              param: { id: threadId, appId: name },
            }),
          );
          const payload = { ok: true, threadId, appId: name };
          if (outputJson(opts, payload)) return;
          console.log(`App ${name} removed`);
        },
      ),
    );
}
