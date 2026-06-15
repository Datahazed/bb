import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  RELOAD_ACCELERATOR,
  SERVER_DAEMON_LOGS_MENU_LABEL,
  TOGGLE_DEVELOPER_TOOLS_ACCELERATOR,
  TOGGLE_DEVELOPER_TOOLS_MENU_LABEL,
  buildApplicationMenuTemplate,
} from "../src/menu.js";

vi.mock("electron", () => ({
  app: {
    name: "bb",
  },
  Menu: {
    buildFromTemplate(template: MenuItemConstructorOptions[]) {
      return template;
    },
    setApplicationMenu() {},
  },
}));

interface FindSubmenuItemArgs {
  itemLabel: string;
  parentLabel: string;
  template: MenuItemConstructorOptions[];
}

interface FindSubmenuRoleArgs {
  itemRole: MenuItemConstructorOptions["role"];
  parentLabel: string;
  template: MenuItemConstructorOptions[];
}

function findSubmenuItem(
  args: FindSubmenuItemArgs,
): MenuItemConstructorOptions | null {
  const parentItem = args.template.find(
    (templateItem) => templateItem.label === args.parentLabel,
  );
  if (parentItem === undefined || !Array.isArray(parentItem.submenu)) {
    return null;
  }

  return (
    parentItem.submenu.find(
      (submenuItem) => submenuItem.label === args.itemLabel,
    ) ?? null
  );
}

function findSubmenuRole(
  args: FindSubmenuRoleArgs,
): MenuItemConstructorOptions | null {
  const parentItem = args.template.find(
    (templateItem) => templateItem.label === args.parentLabel,
  );
  if (parentItem === undefined || !Array.isArray(parentItem.submenu)) {
    return null;
  }

  return (
    parentItem.submenu.find((submenuItem) => submenuItem.role === args.itemRole) ??
    null
  );
}

describe("application menu", () => {
  it("uses Command+R for reload so Ctrl+R can reach focused terminals", () => {
    const template = buildApplicationMenuTemplate({
      createNewWindow() {},
      openServerDaemonLogs() {},
      serverDaemonLogsMenuEnabled: true,
    });

    const menuItem = findSubmenuRole({
      itemRole: "reload",
      parentLabel: "View",
      template,
    });

    expect(menuItem).not.toBeNull();
    expect(menuItem?.accelerator).toBe(RELOAD_ACCELERATOR);
  });

  it("shows a developer tools toggle in the view menu", () => {
    const template = buildApplicationMenuTemplate({
      createNewWindow() {},
      openServerDaemonLogs() {},
      serverDaemonLogsMenuEnabled: true,
    });

    const menuItem = findSubmenuItem({
      itemLabel: TOGGLE_DEVELOPER_TOOLS_MENU_LABEL,
      parentLabel: "View",
      template,
    });

    expect(menuItem).not.toBeNull();
    expect(menuItem?.accelerator).toBe(TOGGLE_DEVELOPER_TOOLS_ACCELERATOR);
    expect(menuItem?.role).toBe("toggleDevTools");
  });

  it("shows an enabled server and daemon logs item for owned runtimes", () => {
    const template = buildApplicationMenuTemplate({
      createNewWindow() {},
      openServerDaemonLogs() {},
      serverDaemonLogsMenuEnabled: true,
    });

    const menuItem = findSubmenuItem({
      itemLabel: SERVER_DAEMON_LOGS_MENU_LABEL,
      parentLabel: "View",
      template,
    });

    expect(menuItem).not.toBeNull();
    expect(menuItem?.enabled).toBe(true);
  });

  it("shows a disabled server and daemon logs item for attached runtimes", () => {
    const template = buildApplicationMenuTemplate({
      createNewWindow() {},
      openServerDaemonLogs() {},
      serverDaemonLogsMenuEnabled: false,
    });

    const menuItem = findSubmenuItem({
      itemLabel: SERVER_DAEMON_LOGS_MENU_LABEL,
      parentLabel: "View",
      template,
    });

    expect(menuItem).not.toBeNull();
    expect(menuItem?.enabled).toBe(false);
  });
});
