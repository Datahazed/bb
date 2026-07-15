import { describe, expectTypeOf, it } from "vitest";
import type {
  BbSdk as RootBbSdk,
  BbRealtimeConnectionEvent as RootRealtimeConnection,
  EnvironmentStatusResult as RootEnvironmentStatus,
  FileReadResult as RootFileRead,
  GuideRenderResult as RootGuideRender,
  HostGetResult as RootHostGet,
  PluginListResult as RootPluginList,
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
});
