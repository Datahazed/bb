// @vitest-environment jsdom
import { expect, it } from "vitest";
import { getPluginSlotSnapshot } from "./plugin-slots";

it("exposes the live plugin slot snapshot to the listing capture harness", () => {
  const captureWindow = window as Window & {
    __bbPluginSlotSnapshot?: typeof getPluginSlotSnapshot;
  };

  expect(captureWindow.__bbPluginSlotSnapshot).toBe(getPluginSlotSnapshot);
  expect(captureWindow.__bbPluginSlotSnapshot?.()).toBe(
    getPluginSlotSnapshot(),
  );
});
