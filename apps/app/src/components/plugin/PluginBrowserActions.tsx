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
  ExperimentalBrowserInspectionRequest,
  ExperimentalBrowserInspectionResult,
  PluginBrowserActionProps,
} from "@get-bb/plugin-sdk";
import {
  DropdownMenu,
  DropdownMenuContent,
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

export const EXPERIMENTAL_BROWSER_INSPECTION_UNAVAILABLE_MESSAGE =
  "Browser page inspection requires a newer BB desktop app.";

interface PluginBrowserActionsProps {
  chromeWidth: number | null;
  desktopBrowser: BbDesktopBrowserApi;
  tabId: string;
  threadId: string | null;
  projectId: string | null;
  url: string;
  overlayRoot: HTMLElement | null;
  onOverlayLeaseChange(owner: symbol, open: boolean): void;
}

interface BrowserActionSlotRuntimeProps {
  desktopBrowser: BbDesktopBrowserApi;
  slot: PluginBrowserActionSlot;
  tabId: string;
  threadId: string | null;
  projectId: string | null;
  url: string;
  overlayRoot: HTMLElement | null;
  onOverlayLeaseChange(owner: symbol, open: boolean): void;
}

function createUnavailableInspectionError(): Error {
  return Object.assign(
    new Error(EXPERIMENTAL_BROWSER_INSPECTION_UNAVAILABLE_MESSAGE),
    { name: "ExperimentalBrowserInspectionUnavailableError" },
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
    ensureRegistered(ownershipRegistry);
    return () => {
      releaseAll();
      if (registeredRef.current) ownershipRegistry?.unregister(owner);
      registeredRef.current = false;
    };
  }, [ensureRegistered, owner, ownershipRegistry, releaseAll]);

  const experimental_setOverlayOpen = useCallback(
    (open: boolean) => {
      ensureRegistered(ownershipRegistry);
      if (overlayOpenRef.current === open) return;
      overlayOpenRef.current = open;
      onOverlayLeaseChange(owner, open);
    },
    [ensureRegistered, onOverlayLeaseChange, owner, ownershipRegistry],
  );

  const experimental_inspectPage = useCallback(
    async (
      request: ExperimentalBrowserInspectionRequest,
      options: { signal: AbortSignal },
    ): Promise<ExperimentalBrowserInspectionResult | null> => {
      const inspect = desktopBrowser.experimental_inspectPage;
      if (inspect === undefined) throw createUnavailableInspectionError();
      ensureRegistered(ownershipRegistry);
      const { controller, unlink } = abortControllerFromSignal(options.signal);
      if (controller.signal.aborted) {
        unlink();
        return null;
      }
      controllersRef.current.add(controller);
      const requestId = crypto.randomUUID();
      const cancel = () =>
        desktopBrowser.experimental_cancelPageInspection?.(tabId, requestId);
      controller.signal.addEventListener("abort", cancel, { once: true });
      try {
        return await inspect({
          tabId,
          requestId,
          kind: request.kind,
          identity: { threadId, projectId },
        });
      } finally {
        controller.signal.removeEventListener("abort", cancel);
        unlink();
        controllersRef.current.delete(controller);
      }
    },
    [
      desktopBrowser,
      ensureRegistered,
      ownershipRegistry,
      projectId,
      tabId,
      threadId,
    ],
  );

  return {
    tabId,
    threadId,
    projectId,
    url,
    experimental_overlayRoot: overlayRoot,
    experimental_inspectionAvailable:
      desktopBrowser.experimental_inspectPage !== undefined &&
      desktopBrowser.experimental_cancelPageInspection !== undefined,
    experimental_inspectPage,
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
  ...runtimeProps
}: BrowserActionSlotRuntimeProps & { mountIdentity: string }) {
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
        role="group"
        aria-label={slot.title}
        className="flex size-7 shrink-0 items-center justify-center overflow-hidden [&>*]:max-h-7 [&>*]:max-w-7"
      >
        <BrowserActionSlotRuntime slot={slot} {...runtimeProps} />
      </span>
    </PluginSlotMount>
  );
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
  const inlineCount = browserActionInlineCount(
    browserActions.length,
    chromeWidth,
  );
  const inline = browserActions.slice(0, inlineCount);
  const overflow = browserActions.slice(inlineCount);
  const mountIdentity = `${tabId}:${threadId ?? ""}:${projectId ?? ""}:${url}`;
  const runtimeProps = {
    desktopBrowser,
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
          <DropdownMenuContent align="end" className="min-w-48 p-1.5">
            <div
              className="space-y-0.5"
              role="group"
              aria-label="Browser actions"
            >
              {overflow.map((slot) => (
                <div
                  key={`${slot.pluginId}/${slot.id}/${slot.generation}/${mountIdentity}`}
                  className="flex h-9 items-center gap-3 rounded-md px-2 text-sm text-foreground"
                >
                  <span className="min-w-0 flex-1 truncate">{slot.title}</span>
                  <BrowserActionMount
                    slot={slot}
                    mountIdentity={mountIdentity}
                    {...runtimeProps}
                  />
                </div>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
