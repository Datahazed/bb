import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import type {
  ExperimentalBrowserPageContentScriptRequest,
  ExperimentalBrowserPageContentScriptResult,
  PluginBrowserActionProps,
} from "@get-bb/plugin-sdk";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chromeStyleTokens";
import {
  PluginSlotOwnershipContext,
  type PluginSlotOwnershipRegistry,
} from "./plugin-context";
import { PluginSlotMount } from "./PluginSlotMount";
import {
  usePluginSlots,
  type PluginBrowserActionSlot,
} from "@/lib/plugin-slots";

const BROWSER_CORE_CHROME_RESERVE_PX = 300;
const BROWSER_ACTION_FOOTPRINT_PX = 32;

export const EXPERIMENTAL_BROWSER_PAGE_SCRIPTS_UNAVAILABLE_MESSAGE =
  "Browser page actions require a newer BB desktop app.";

const DEFAULT_BROWSER_PAGE_SCRIPT_TIMEOUT_MS = 30_000;

interface PluginBrowserActionsProps {
  chromeWidth: number | null;
  desktopBrowser: BbDesktopBrowserApi;
  navigationEpoch: number;
  tabId: string;
  threadId: string | null;
  projectId: string | null;
  url: string;
  overlayRoot: HTMLElement | null;
  onOverlayLeaseChange(owner: symbol, open: boolean): void;
}

interface BrowserActionSlotRuntimeProps {
  desktopBrowser: BbDesktopBrowserApi;
  navigationEpoch: number;
  slot: PluginBrowserActionSlot;
  tabId: string;
  threadId: string | null;
  projectId: string | null;
  url: string;
  overlayRoot: HTMLElement | null;
  onOverlayLeaseChange(owner: symbol, open: boolean): void;
}

function createUnavailablePageScriptsError(): Error {
  return Object.assign(
    new Error(EXPERIMENTAL_BROWSER_PAGE_SCRIPTS_UNAVAILABLE_MESSAGE),
    { name: "ExperimentalBrowserPageScriptsUnavailableError" },
  );
}

function abortControllerFromSignal(signal: AbortSignal): {
  controller: AbortController;
  unlink: () => void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) {
    abort();
    return { controller, unlink: () => {} };
  }
  signal.addEventListener("abort", abort, { once: true });
  return {
    controller,
    unlink: () => signal.removeEventListener("abort", abort),
  };
}

function useBrowserActionRuntime({
  desktopBrowser,
  navigationEpoch,
  tabId,
  threadId,
  projectId,
  url,
  overlayRoot,
  onOverlayLeaseChange,
}: Omit<BrowserActionSlotRuntimeProps, "slot">): PluginBrowserActionProps {
  const ownershipRegistry = useContext(PluginSlotOwnershipContext);
  const owner = useMemo(() => Symbol("browser-action-runtime"), []);
  const overlayOpenRef = useRef(false);
  const controllersRef = useRef(new Set<AbortController>());
  const registeredRef = useRef(false);
  const activeRef = useRef(true);

  const releaseAll = useCallback(() => {
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear();
    if (overlayOpenRef.current) {
      overlayOpenRef.current = false;
      onOverlayLeaseChange(owner, false);
    }
  }, [onOverlayLeaseChange, owner]);

  const ensureRegistered = useCallback(
    (registry: PluginSlotOwnershipRegistry | null) => {
      if (registry === null || registeredRef.current) return;
      registry.register(owner, releaseAll);
      registeredRef.current = true;
    },
    [owner, releaseAll],
  );

  useEffect(() => {
    activeRef.current = true;
    ensureRegistered(ownershipRegistry);
    return () => {
      activeRef.current = false;
      releaseAll();
      if (registeredRef.current) ownershipRegistry?.unregister(owner);
      registeredRef.current = false;
    };
  }, [ensureRegistered, owner, ownershipRegistry, releaseAll]);

  const experimental_setOverlayOpen = useCallback(
    (open: boolean) => {
      // A plugin effect may release its overlay during the same unmount pass
      // that disposes this runtime. Keep that cleanup idempotent, but never let
      // a retained callback reacquire a lease after disposal.
      if (!activeRef.current && !open) return;
      if (!activeRef.current) {
        throw new Error("Browser action is no longer active");
      }
      ensureRegistered(ownershipRegistry);
      if (overlayOpenRef.current === open) return;
      overlayOpenRef.current = open;
      onOverlayLeaseChange(owner, open);
    },
    [ensureRegistered, onOverlayLeaseChange, owner, ownershipRegistry],
  );

  const experimental_runPageContentScript = useCallback(
    async (
      request: ExperimentalBrowserPageContentScriptRequest,
      options: { signal: AbortSignal },
    ): Promise<ExperimentalBrowserPageContentScriptResult> => {
      if (!activeRef.current) {
        throw new Error("Browser action is no longer active");
      }
      const run = desktopBrowser.experimental_runBrowserPageScript;
      const cancel = desktopBrowser.experimental_cancelBrowserPageScript;
      if (run === undefined || cancel === undefined) {
        throw createUnavailablePageScriptsError();
      }
      ensureRegistered(ownershipRegistry);
      const { controller, unlink } = abortControllerFromSignal(options.signal);
      controllersRef.current.add(controller);
      const requestId = crypto.randomUUID();
      const cancelRequest = () => cancel({ tabId, requestId });
      if (controller.signal.aborted) {
        controllersRef.current.delete(controller);
        unlink();
        throw new DOMException(
          "Browser page script was cancelled",
          "AbortError",
        );
      }
      controller.signal.addEventListener("abort", cancelRequest, {
        once: true,
      });
      try {
        const result = await run({
          tabId,
          requestId,
          expectedNavigationEpoch: navigationEpoch,
          ...(request.world === undefined ? {} : { world: request.world }),
          source: request.source,
          input: request.input ?? null,
          timeoutMs:
            request.timeoutMs ?? DEFAULT_BROWSER_PAGE_SCRIPT_TIMEOUT_MS,
        });
        return {
          navigationEpoch: result.navigationEpoch,
          value: result.value,
        };
      } finally {
        controller.signal.removeEventListener("abort", cancelRequest);
        unlink();
        controllersRef.current.delete(controller);
      }
    },
    [
      desktopBrowser,
      ensureRegistered,
      navigationEpoch,
      ownershipRegistry,
      tabId,
    ],
  );

  const experimental_capturePage = useCallback(
    async (
      options: {
        format?: "png" | "jpeg";
        quality?: number;
        expectedNavigationEpoch?: number;
      } = {},
    ) => {
      if (!activeRef.current) {
        throw new Error("Browser action is no longer active");
      }
      const capture = desktopBrowser.experimental_captureBrowserPage;
      if (capture === undefined) throw createUnavailablePageScriptsError();
      return capture({
        tabId,
        format: options.format ?? "png",
        quality: options.quality ?? 85,
        ...(options.expectedNavigationEpoch === undefined
          ? {}
          : { expectedNavigationEpoch: options.expectedNavigationEpoch }),
      });
    },
    [desktopBrowser, tabId],
  );

  return {
    tabId,
    threadId,
    projectId,
    url,
    experimental_overlayRoot: overlayRoot,
    experimental_pageContentScriptsAvailable:
      desktopBrowser.experimental_browserPageRuntimeVersion === 1 &&
      desktopBrowser.experimental_runBrowserPageScript !== undefined &&
      desktopBrowser.experimental_cancelBrowserPageScript !== undefined,
    experimental_runPageContentScript,
    experimental_capturePage,
    experimental_setOverlayOpen,
  };
}

function BrowserActionSlotRuntime({
  slot,
  ...runtimeProps
}: BrowserActionSlotRuntimeProps) {
  const props = useBrowserActionRuntime(runtimeProps);
  const Component = slot.component;
  return <Component {...props} />;
}

function BrowserActionMount({
  slot,
  mountIdentity,
  controlRef,
  ...runtimeProps
}: BrowserActionSlotRuntimeProps & {
  mountIdentity: string;
  controlRef?: (node: HTMLSpanElement | null) => void;
}) {
  return (
    <PluginSlotMount
      key={`${slot.pluginId}/${slot.id}/${slot.generation}/${mountIdentity}`}
      pluginId={slot.pluginId}
      slotKind="browserAction"
      slotId={slot.id}
      instanceId={runtimeProps.tabId}
      crashFallback={null}
    >
      <span
        ref={controlRef}
        role="group"
        aria-label={slot.title}
        className="flex size-7 shrink-0 items-center justify-center overflow-hidden [&>*]:max-h-7 [&>*]:max-w-7"
      >
        <BrowserActionSlotRuntime slot={slot} {...runtimeProps} />
      </span>
    </PluginSlotMount>
  );
}

function browserActionKey(slot: PluginBrowserActionSlot): string {
  return `${slot.pluginId}/${slot.id}/${slot.generation}`;
}

function activateBrowserAction(root: HTMLElement | undefined): void {
  const control = root?.querySelector<HTMLElement>(
    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [role="button"]:not([aria-disabled="true"]), [tabindex]:not([tabindex="-1"])',
  );
  control?.click();
}

export function browserActionInlineCount(
  actionCount: number,
  chromeWidth: number | null,
) {
  if (chromeWidth === null) return actionCount;
  const slots = Math.max(
    1,
    Math.floor(
      (chromeWidth - BROWSER_CORE_CHROME_RESERVE_PX) /
        BROWSER_ACTION_FOOTPRINT_PX,
    ),
  );
  return actionCount <= slots ? actionCount : Math.max(0, slots - 1);
}

export function PluginBrowserActions({
  chromeWidth,
  desktopBrowser,
  navigationEpoch,
  tabId,
  threadId,
  projectId,
  url,
  overlayRoot,
  onOverlayLeaseChange,
}: PluginBrowserActionsProps) {
  const { browserActions } = usePluginSlots();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowOwner = useMemo(() => Symbol("browser-action-overflow"), []);
  const overflowActionRoots = useRef(new Map<string, HTMLSpanElement>());
  const inlineCount = browserActionInlineCount(
    browserActions.length,
    chromeWidth,
  );
  const inline = browserActions.slice(0, inlineCount);
  const overflow = browserActions.slice(inlineCount);
  const mountIdentity = `${tabId}:${threadId ?? ""}:${projectId ?? ""}:${url}`;
  const runtimeProps = {
    desktopBrowser,
    navigationEpoch,
    tabId,
    threadId,
    projectId,
    url,
    overlayRoot,
    onOverlayLeaseChange,
  };

  const handleOverflowOpenChange = useCallback(
    (open: boolean) => {
      setOverflowOpen(open);
      onOverlayLeaseChange(overflowOwner, open);
    },
    [onOverlayLeaseChange, overflowOwner],
  );

  useEffect(() => {
    return () => onOverlayLeaseChange(overflowOwner, false);
  }, [onOverlayLeaseChange, overflowOwner]);

  useEffect(() => {
    if (overflow.length === 0 && overflowOpen) {
      handleOverflowOpenChange(false);
    }
  }, [handleOverflowOpenChange, overflow.length, overflowOpen]);

  if (browserActions.length === 0) return null;

  return (
    <div
      data-testid="plugin-browser-actions"
      className="flex shrink-0 items-center gap-1"
    >
      {inline.map((slot) => (
        <BrowserActionMount
          key={`${slot.pluginId}/${slot.id}/${slot.generation}/${mountIdentity}`}
          slot={slot}
          mountIdentity={mountIdentity}
          {...runtimeProps}
        />
      ))}
      {overflow.length > 0 ? (
        <>
          <div className="hidden" aria-hidden="true">
            {overflow.map((slot) => {
              const key = browserActionKey(slot);
              return (
                <BrowserActionMount
                  key={`${key}/${mountIdentity}`}
                  slot={slot}
                  mountIdentity={mountIdentity}
                  controlRef={(node) => {
                    if (node === null) overflowActionRoots.current.delete(key);
                    else overflowActionRoots.current.set(key, node);
                  }}
                  {...runtimeProps}
                />
              );
            })}
          </div>
          <DropdownMenu
            open={overflowOpen}
            onOpenChange={handleOverflowOpenChange}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`More Browser actions (${overflow.length})`}
                className={cn(
                  "flex shrink-0 items-center justify-center transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
                  CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
                )}
              >
                <Icon name="MoreHorizontal" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-48"
              mobileTitle="More Browser actions"
            >
              {overflow.map((slot) => {
                const key = browserActionKey(slot);
                return (
                  <DropdownMenuItem
                    key={`${key}/${mountIdentity}`}
                    onSelect={() =>
                      activateBrowserAction(
                        overflowActionRoots.current.get(key),
                      )
                    }
                  >
                    <span className="min-w-0 truncate">{slot.title}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
    </div>
  );
}
