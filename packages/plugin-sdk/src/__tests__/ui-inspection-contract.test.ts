import { describe, expectTypeOf, it } from "vitest";
import type {
  ExperimentalPluginAppCommandHandler,
  ExperimentalUiInspectionApi,
  ExperimentalUiInspectionMetadata,
  ExperimentalUiInspectionSessionEvent,
  PluginContentScriptContext,
  PluginContentScriptDisposer,
  PluginSidebarFooterActionRegistration,
} from "../app-contract.js";

describe("experimental UI inspection contract", () => {
  it("keeps the shipped sidebar-footer registration valid", () => {
    const registration: PluginSidebarFooterActionRegistration = {
      id: "guide",
      title: "Open Plugin Guide",
      icon: "book-open",
      run: () => undefined,
    };

    expectTypeOf(registration.experimental_activeTitle).toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf(registration.experimental_activeIndicator).toEqualTypeOf<
      "dot" | undefined
    >();
  });

  it("types plugin metadata registration and hover/select sessions", () => {
    type InspectionApi = NonNullable<
      PluginContentScriptContext["experimental_uiInspection"]
    >;

    expectTypeOf<InspectionApi>().toEqualTypeOf<ExperimentalUiInspectionApi>();
    expectTypeOf<Parameters<InspectionApi["register"]>>().toEqualTypeOf<
      [Element, ExperimentalUiInspectionMetadata]
    >();
    expectTypeOf<Parameters<InspectionApi["startSession"]>[0]["onEvent"]>()
      .parameter(0)
      .toEqualTypeOf<ExperimentalUiInspectionSessionEvent>();
  });

  it("accepts only the fixed Core-owned inspector command", () => {
    type RegisterHandler = NonNullable<
      PluginContentScriptContext["experimental_registerAppCommandHandler"]
    >;

    expectTypeOf<Parameters<RegisterHandler>>().toEqualTypeOf<
      ["plugin.inspector.toggle", ExperimentalPluginAppCommandHandler]
    >();
    expectTypeOf<
      ReturnType<RegisterHandler>
    >().toEqualTypeOf<PluginContentScriptDisposer>();
  });

  it("keeps new content-script capabilities feature-detectable", () => {
    expectTypeOf<
      PluginContentScriptContext["experimental_uiInspection"]
    >().toEqualTypeOf<ExperimentalUiInspectionApi | undefined>();
    expectTypeOf<
      PluginContentScriptContext["experimental_setSidebarFooterActionActive"]
    >().toEqualTypeOf<
      ((actionId: string, active: boolean) => void) | undefined
    >();
  });
});
