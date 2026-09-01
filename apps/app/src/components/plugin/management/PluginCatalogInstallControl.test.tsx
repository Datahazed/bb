// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PluginCatalogInstallControl } from "./PluginCatalogInstallControl";

afterEach(cleanup);

describe("PluginCatalogInstallControl", () => {
  it("labels bundled plugins as included instead of showing an empty count", () => {
    render(
      <PluginCatalogInstallControl
        displayName="Automations"
        installed
        included
      />,
    );

    const status = screen.getByLabelText("Automations included with bb");
    expect(status.textContent).toBe("Included");
    expect(status.querySelector('[data-icon="Check"]')).not.toBeNull();
    expect(status.querySelector('[data-icon="Download"]')).toBeNull();
  });

  it("preserves marketplace install evidence when a count exists", () => {
    render(
      <PluginCatalogInstallControl
        displayName="Automations"
        installed
        included
        count={{ display: "24", accessibleLabel: "24 installs" }}
      />,
    );

    const status = screen.getByLabelText("Automations installed — 24 installs");
    expect(status.textContent).toBe("24");
    expect(status.querySelector('[data-icon="Download"]')).not.toBeNull();
  });
});
