import { describe, expectTypeOf, it } from "vitest";
import type {
  BbRealtime as RootBbRealtime,
  BbSdk as RootBbSdk,
  BbRealtimeConnectionEvent as RootRealtimeConnection,
  EnvironmentStatusResult as RootEnvironmentStatus,
  FileReadResult as RootFileRead,
  GuideRenderResult as RootGuideRender,
  HostGetResult as RootHostGet,
  PluginListResult as RootPluginList,
  PluginGetSourceResult as RootPluginGetSource,
  PluginApplyUpdateResult as RootPluginApplyUpdate,
  PluginMarketplaceListResult as RootPluginMarketplaceList,
  ProjectGetResult as RootProjectGet,
  ProviderListResult as RootProviderList,
  StatusResult as RootStatus,
  SystemVersionResult as RootSystemVersion,
  ThemeCatalogResult as RootThemeCatalog,
  ThreadFolderListResult as RootThreadFolderList,
  ThreadSpawnResult as RootThreadSpawn,
} from "@bb/sdk";
import type {
  BbSdk as BrowserBbSdk,
  BbRealtimeConnectionEvent as BrowserRealtimeConnection,
  EnvironmentStatusResult as BrowserEnvironmentStatus,
  FileReadResult as BrowserFileRead,
  GuideRenderResult as BrowserGuideRender,
  HostGetResult as BrowserHostGet,
  PluginListResult as BrowserPluginList,
  PluginGetSourceResult as BrowserPluginGetSource,
  PluginApplyUpdateResult as BrowserPluginApplyUpdate,
  PluginMarketplaceListResult as BrowserPluginMarketplaceList,
  ProjectGetResult as BrowserProjectGet,
  ProviderListResult as BrowserProviderList,
  StatusResult as BrowserStatus,
  SystemVersionResult as BrowserSystemVersion,
  ThemeCatalogResult as BrowserThemeCatalog,
  ThreadFolderListResult as BrowserThreadFolderList,
  ThreadSpawnResult as BrowserThreadSpawn,
} from "@bb/sdk/browser";
import type {
  BbSdk as CoreBbSdk,
  BbRealtimeConnectionEvent as CoreRealtimeConnection,
  EnvironmentStatusResult as CoreEnvironmentStatus,
  FileReadResult as CoreFileRead,
  GuideRenderResult as CoreGuideRender,
  HostGetResult as CoreHostGet,
  PluginListResult as CorePluginList,
  PluginGetSourceResult as CorePluginGetSource,
  PluginApplyUpdateResult as CorePluginApplyUpdate,
  PluginMarketplaceListResult as CorePluginMarketplaceList,
  ProjectGetResult as CoreProjectGet,
  ProviderListResult as CoreProviderList,
  StatusResult as CoreStatus,
  SystemVersionResult as CoreSystemVersion,
  ThemeCatalogResult as CoreThemeCatalog,
  ThreadFolderListResult as CoreThreadFolderList,
  ThreadSpawnResult as CoreThreadSpawn,
} from "@bb/sdk/core";
import type {
  BbSdk as NodeBbSdk,
  BbRealtimeConnectionEvent as NodeRealtimeConnection,
  EnvironmentStatusResult as NodeEnvironmentStatus,
  FileReadResult as NodeFileRead,
  GuideRenderResult as NodeGuideRender,
  HostGetResult as NodeHostGet,
  PluginListResult as NodePluginList,
  PluginGetSourceResult as NodePluginGetSource,
  PluginApplyUpdateResult as NodePluginApplyUpdate,
  PluginMarketplaceListResult as NodePluginMarketplaceList,
  ProjectGetResult as NodeProjectGet,
  ProviderListResult as NodeProviderList,
  StatusResult as NodeStatus,
  SystemVersionResult as NodeSystemVersion,
  ThemeCatalogResult as NodeThemeCatalog,
  ThreadFolderListResult as NodeThreadFolderList,
  ThreadSpawnResult as NodeThreadSpawn,
} from "@bb/sdk/node";

interface RootSurface {
  environmentStatus: RootEnvironmentStatus;
  fileRead: RootFileRead;
  guideRender: RootGuideRender;
  hostGet: RootHostGet;
  pluginList: RootPluginList;
  pluginGetSource: RootPluginGetSource;
  pluginApplyUpdate: RootPluginApplyUpdate;
  pluginMarketplaceList: RootPluginMarketplaceList;
  projectGet: RootProjectGet;
  providerList: RootProviderList;
  realtimeConnection: RootRealtimeConnection;
  status: RootStatus;
  systemVersion: RootSystemVersion;
  themeCatalog: RootThemeCatalog;
  threadFolderList: RootThreadFolderList;
  threadSpawn: RootThreadSpawn;
}

interface BrowserSurface {
  environmentStatus: BrowserEnvironmentStatus;
  fileRead: BrowserFileRead;
  guideRender: BrowserGuideRender;
  hostGet: BrowserHostGet;
  pluginList: BrowserPluginList;
  pluginGetSource: BrowserPluginGetSource;
  pluginApplyUpdate: BrowserPluginApplyUpdate;
  pluginMarketplaceList: BrowserPluginMarketplaceList;
  projectGet: BrowserProjectGet;
  providerList: BrowserProviderList;
  realtimeConnection: BrowserRealtimeConnection;
  status: BrowserStatus;
  systemVersion: BrowserSystemVersion;
  themeCatalog: BrowserThemeCatalog;
  threadFolderList: BrowserThreadFolderList;
  threadSpawn: BrowserThreadSpawn;
}

interface CoreSurface {
  environmentStatus: CoreEnvironmentStatus;
  fileRead: CoreFileRead;
  guideRender: CoreGuideRender;
  hostGet: CoreHostGet;
  pluginList: CorePluginList;
  pluginGetSource: CorePluginGetSource;
  pluginApplyUpdate: CorePluginApplyUpdate;
  pluginMarketplaceList: CorePluginMarketplaceList;
  projectGet: CoreProjectGet;
  providerList: CoreProviderList;
  realtimeConnection: CoreRealtimeConnection;
  status: CoreStatus;
  systemVersion: CoreSystemVersion;
  themeCatalog: CoreThemeCatalog;
  threadFolderList: CoreThreadFolderList;
  threadSpawn: CoreThreadSpawn;
}

interface NodeSurface {
  environmentStatus: NodeEnvironmentStatus;
  fileRead: NodeFileRead;
  guideRender: NodeGuideRender;
  hostGet: NodeHostGet;
  pluginList: NodePluginList;
  pluginGetSource: NodePluginGetSource;
  pluginApplyUpdate: NodePluginApplyUpdate;
  pluginMarketplaceList: NodePluginMarketplaceList;
  projectGet: NodeProjectGet;
  providerList: NodeProviderList;
  realtimeConnection: NodeRealtimeConnection;
  status: NodeStatus;
  systemVersion: NodeSystemVersion;
  themeCatalog: NodeThemeCatalog;
  threadFolderList: NodeThreadFolderList;
  threadSpawn: NodeThreadSpawn;
}

type ExpectedBbSdkKey =
  | "environments"
  | "files"
  | "guide"
  | "hosts"
  | "on"
  | "plugins"
  | "projects"
  | "providers"
  | "status"
  | "system"
  | "theme"
  | "threadFolders"
  | "threads";

type ExpectedRealtimeKey = "on";

type ExpectedEnvironmentsKey =
  | "archiveThreads"
  | "commit"
  | "diff"
  | "diffBranches"
  | "diffFile"
  | "diffFiles"
  | "diffPatch"
  | "get"
  | "markPullRequestDraft"
  | "markPullRequestReady"
  | "mergePullRequest"
  | "paths"
  | "pullRequest"
  | "squashMerge"
  | "status"
  | "update";

type ExpectedFilesKey =
  | "createPreview"
  | "list"
  | "listPaths"
  | "mkdir"
  | "move"
  | "read"
  | "remove"
  | "write";

type ExpectedGuideKey = "render";

type ExpectedHostsKey =
  | "cloneDefaultPath"
  | "createJoinCode"
  | "delete"
  | "directory"
  | "get"
  | "installProviderCli"
  | "list"
  | "pathsExist"
  | "pickFolder"
  | "providerCliStatus"
  | "update";

type ExpectedPluginsKey =
  | "applyUpdate"
  | "callRpc"
  | "checkUpdates"
  | "disable"
  | "enable"
  | "getSettings"
  | "getSource"
  | "install"
  | "installFromMarketplace"
  | "list"
  | "listUpdateResults"
  | "marketplaces"
  | "reload"
  | "remove"
  | "token"
  | "updateSettings";

type ExpectedPluginMarketplacesKey =
  | "add"
  | "list"
  | "refresh"
  | "remove"
  | "search";

type ExpectedProjectsKey =
  | "branches"
  | "commands"
  | "create"
  | "defaultExecutionOptions"
  | "delete"
  | "get"
  | "list"
  | "paths"
  | "promptHistory"
  | "reorder"
  | "sources"
  | "update";

type ExpectedProjectSourcesKey = "add" | "delete" | "update";

type ExpectedProvidersKey = "list" | "models";

type ExpectedStatusKey = "get";

type ExpectedSystemKey =
  | "attention"
  | "config"
  | "executionOptions"
  | "reloadConfig"
  | "transcribeVoice"
  | "updateExperiments"
  | "updateGeneralSettings"
  | "updateKeyboardSettings"
  | "usageLimits"
  | "version";

type ExpectedThemeKey = "catalog" | "get" | "set";

type ExpectedThreadFoldersKey = "create" | "delete" | "list" | "update";

type ExpectedThreadsKey =
  | "archive"
  | "archiveAll"
  | "childSummary"
  | "conversationOutline"
  | "defaultExecutionOptions"
  | "delete"
  | "events"
  | "get"
  | "interactions"
  | "list"
  | "markRead"
  | "markUnread"
  | "open"
  | "output"
  | "pin"
  | "promptHistory"
  | "queuedMessages"
  | "reorderPinned"
  | "search"
  | "send"
  | "spawn"
  | "stop"
  | "storageFiles"
  | "storagePaths"
  | "tabs"
  | "terminals"
  | "timeline"
  | "timelineTurnSummaryDetails"
  | "unarchive"
  | "unpin"
  | "update"
  | "wait";

type ExpectedThreadEventsKey = "list" | "wait";
type ExpectedThreadInteractionsKey =
  | "cancel"
  | "get"
  | "list"
  | "resolve"
  | "respond";
type ExpectedThreadQueuedMessagesKey =
  | "create"
  | "delete"
  | "list"
  | "reorder"
  | "send"
  | "setGroupBoundary";
type ExpectedThreadTabsKey = "get" | "update";
type ExpectedThreadTerminalsKey =
  | "close"
  | "create"
  | "input"
  | "list"
  | "output"
  | "resize"
  | "update";

describe("SDK public type entrypoints", () => {
  it("export the same transport-independent DTO surface", () => {
    expectTypeOf<BrowserSurface>().toEqualTypeOf<RootSurface>();
    expectTypeOf<CoreSurface>().toEqualTypeOf<RootSurface>();
    expectTypeOf<NodeSurface>().toEqualTypeOf<RootSurface>();
  });

  it("preserves the complete SDK surface at every entrypoint", () => {
    expectTypeOf<keyof RootBbSdk>().toEqualTypeOf<ExpectedBbSdkKey>();
    expectTypeOf<BrowserBbSdk>().toEqualTypeOf<RootBbSdk>();
    expectTypeOf<CoreBbSdk>().toEqualTypeOf<RootBbSdk>();
    expectTypeOf<NodeBbSdk>().toEqualTypeOf<RootBbSdk>();
  });

  it("snapshots every SDK area and nested method group", () => {
    expectTypeOf<keyof RootBbRealtime>().toEqualTypeOf<ExpectedRealtimeKey>();
    expectTypeOf<
      keyof RootBbSdk["environments"]
    >().toEqualTypeOf<ExpectedEnvironmentsKey>();
    expectTypeOf<keyof RootBbSdk["files"]>().toEqualTypeOf<ExpectedFilesKey>();
    expectTypeOf<keyof RootBbSdk["guide"]>().toEqualTypeOf<ExpectedGuideKey>();
    expectTypeOf<keyof RootBbSdk["hosts"]>().toEqualTypeOf<ExpectedHostsKey>();
    expectTypeOf<
      keyof RootBbSdk["plugins"]
    >().toEqualTypeOf<ExpectedPluginsKey>();
    expectTypeOf<
      keyof RootBbSdk["plugins"]["marketplaces"]
    >().toEqualTypeOf<ExpectedPluginMarketplacesKey>();
    expectTypeOf<
      keyof RootBbSdk["projects"]
    >().toEqualTypeOf<ExpectedProjectsKey>();
    expectTypeOf<
      keyof RootBbSdk["projects"]["sources"]
    >().toEqualTypeOf<ExpectedProjectSourcesKey>();
    expectTypeOf<
      keyof RootBbSdk["providers"]
    >().toEqualTypeOf<ExpectedProvidersKey>();
    expectTypeOf<
      keyof RootBbSdk["status"]
    >().toEqualTypeOf<ExpectedStatusKey>();
    expectTypeOf<
      keyof RootBbSdk["system"]
    >().toEqualTypeOf<ExpectedSystemKey>();
    expectTypeOf<keyof RootBbSdk["theme"]>().toEqualTypeOf<ExpectedThemeKey>();
    expectTypeOf<
      keyof RootBbSdk["threadFolders"]
    >().toEqualTypeOf<ExpectedThreadFoldersKey>();
    expectTypeOf<
      keyof RootBbSdk["threads"]
    >().toEqualTypeOf<ExpectedThreadsKey>();
    expectTypeOf<
      keyof RootBbSdk["threads"]["events"]
    >().toEqualTypeOf<ExpectedThreadEventsKey>();
    expectTypeOf<
      keyof RootBbSdk["threads"]["interactions"]
    >().toEqualTypeOf<ExpectedThreadInteractionsKey>();
    expectTypeOf<
      keyof RootBbSdk["threads"]["queuedMessages"]
    >().toEqualTypeOf<ExpectedThreadQueuedMessagesKey>();
    expectTypeOf<
      keyof RootBbSdk["threads"]["tabs"]
    >().toEqualTypeOf<ExpectedThreadTabsKey>();
    expectTypeOf<
      keyof RootBbSdk["threads"]["terminals"]
    >().toEqualTypeOf<ExpectedThreadTerminalsKey>();
  });
});
