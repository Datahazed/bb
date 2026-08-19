import {
  BrowserWindow,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import {
  bbDesktopBrowserAttachRequestSchema,
  bbDesktopBrowserNavigateRequestSchema,
  bbDesktopBrowserPageNavigateRequestSchema,
  bbDesktopBrowserPageCaptureRequestSchema,
  bbDesktopBrowserPageScriptCancelRequestSchema,
  bbDesktopBrowserPageScriptRequestSchema,
  bbDesktopBrowserSetBoundsRequestSchema,
  bbDesktopBrowserSetVisibleRequestSchema,
  bbDesktopBrowserTabRefSchema,
} from "@bb/desktop-contract";
import {
  BB_DESKTOP_BROWSER_ATTACH_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_CANCEL_PAGE_SCRIPT_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_CAPTURE_PAGE_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_NAVIGATE_PAGE_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_RUN_PAGE_SCRIPT_CHANNEL,
  BB_DESKTOP_BROWSER_DETACH_CHANNEL,
  BB_DESKTOP_BROWSER_GO_BACK_CHANNEL,
  BB_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
  BB_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
  BB_DESKTOP_BROWSER_RELOAD_CHANNEL,
  BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
  BB_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
  BB_DESKTOP_BROWSER_STOP_CHANNEL,
} from "./desktop-browser-ipc.js";
import type { DesktopBrowserViewManager } from "./desktop-browser-view.js";

interface DesktopBrowserTabCommandArgs {
  hostWindow: BrowserWindow;
  tabId: string;
}

type DesktopBrowserTabCommand = (args: DesktopBrowserTabCommandArgs) => void;

interface RegisterDesktopBrowserTabCommandArgs {
  channel: string;
  run: DesktopBrowserTabCommand;
}

function hostWindowFromBrowserIpcEvent(
  event: IpcMainEvent | IpcMainInvokeEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function registerTabCommand(args: RegisterDesktopBrowserTabCommandArgs): void {
  ipcMain.on(args.channel, (event, payload: unknown) => {
    const hostWindow = hostWindowFromBrowserIpcEvent(event);
    if (hostWindow === null) {
      return;
    }
    const parsed = bbDesktopBrowserTabRefSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    args.run({ hostWindow, tabId: parsed.data.tabId });
  });
}

export function registerDesktopBrowserIpc(
  manager: DesktopBrowserViewManager,
): void {
  // Every browser command is renderer -> main fire-and-forget; navigation state
  // flows back over `BB_DESKTOP_BROWSER_STATE_CHANNEL`. Each handler resolves
  // its own host window from the sender, so multi-window is safe, and zod-parses
  // the untrusted-content-adjacent payload before touching the view.
  ipcMain.on(BB_DESKTOP_BROWSER_ATTACH_CHANNEL, (event, payload: unknown) => {
    const hostWindow = hostWindowFromBrowserIpcEvent(event);
    if (hostWindow === null) {
      return;
    }
    const parsed = bbDesktopBrowserAttachRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    manager.attach({ hostWindow, request: parsed.data });
  });

  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_RUN_PAGE_SCRIPT_CHANNEL,
    async (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request = bbDesktopBrowserPageScriptRequestSchema.parse(payload);
      return manager.runPageScript({ hostWindow, request });
    },
  );

  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_CAPTURE_PAGE_CHANNEL,
    async (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request = bbDesktopBrowserPageCaptureRequestSchema.parse(payload);
      return manager.capturePage({ hostWindow, request });
    },
  );

  ipcMain.handle(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_NAVIGATE_PAGE_CHANNEL,
    async (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        throw new Error("The Browser host window is unavailable");
      }
      const request = bbDesktopBrowserPageNavigateRequestSchema.parse(payload);
      return manager.navigatePage({ hostWindow, request });
    },
  );

  ipcMain.on(
    BB_DESKTOP_BROWSER_EXPERIMENTAL_CANCEL_PAGE_SCRIPT_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) return;
      const request =
        bbDesktopBrowserPageScriptCancelRequestSchema.safeParse(payload);
      if (!request.success) return;
      manager.cancelPageScript({
        hostWindow,
        tabId: request.data.tabId,
        requestId: request.data.requestId,
      });
    },
  );

  ipcMain.on(BB_DESKTOP_BROWSER_NAVIGATE_CHANNEL, (event, payload: unknown) => {
    const hostWindow = hostWindowFromBrowserIpcEvent(event);
    if (hostWindow === null) {
      return;
    }
    const parsed = bbDesktopBrowserNavigateRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    manager.navigate({ hostWindow, request: parsed.data });
  });

  ipcMain.on(
    BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed = bbDesktopBrowserSetBoundsRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setBounds({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    BB_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed = bbDesktopBrowserSetVisibleRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setVisible({ hostWindow, request: parsed.data });
    },
  );

  registerTabCommand({
    channel: BB_DESKTOP_BROWSER_DETACH_CHANNEL,
    run: (args) => manager.detach(args),
  });
  registerTabCommand({
    channel: BB_DESKTOP_BROWSER_GO_BACK_CHANNEL,
    run: (args) => manager.goBack(args),
  });
  registerTabCommand({
    channel: BB_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
    run: (args) => manager.goForward(args),
  });
  registerTabCommand({
    channel: BB_DESKTOP_BROWSER_RELOAD_CHANNEL,
    run: (args) => manager.reload(args),
  });
  registerTabCommand({
    channel: BB_DESKTOP_BROWSER_STOP_CHANNEL,
    run: (args) => manager.stop(args),
  });
}
