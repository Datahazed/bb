/**
 * Contract tripwire — single-host rebuild plan §6 Phase 0 / §4.2.
 *
 * Snapshot inventory of the realtime entities and change-kind strings the
 * frozen frontend keys its cache invalidation on (/ws `changed` broadcasts →
 * query invalidation). The expected lists are INLINED LITERALLY on purpose:
 * renaming or removing a kind here silently breaks frozen-frontend
 * invalidation (stale views, no error), so any diff must fail this test and
 * be a deliberate contract decision — including keeping 'host' and the
 * host-connected/disconnected kinds alive after the single-host merge, even
 * though they are never emitted again (subscribe validation still accepts
 * them). The existing change-kinds.test.ts checks strict/lenient schema
 * parity, not this inventory.
 */
import { describe, expect, it } from "vitest";
import {
  APP_CHANGE_KINDS,
  ENVIRONMENT_CHANGE_KINDS,
  HOST_CHANGE_KINDS,
  PROJECT_CHANGE_KINDS,
  REALTIME_ENTITIES,
  SYSTEM_CHANGE_KINDS,
  THREAD_CHANGE_KINDS,
} from "../src/change-kinds.js";

describe("change-kind string inventory", () => {
  it("keeps the frozen realtime entity list, including 'host'", () => {
    expect([...REALTIME_ENTITIES]).toEqual([
      "thread",
      "project",
      "environment",
      "host",
      "system",
      "app",
    ]);
  });

  it("keeps the frozen thread change kinds", () => {
    expect([...THREAD_CHANGE_KINDS]).toEqual([
      "thread-created",
      "thread-deleted",
      "events-appended",
      "interactions-changed",
      "status-changed",
      "title-changed",
      "queue-changed",
      "archived-changed",
      "pin-state-changed",
      "parent-changed",
      "read-state-changed",
      "manager-assignment-changed",
      "order-changed",
      "terminals-changed",
    ]);
  });

  it("keeps the frozen project change kinds", () => {
    expect([...PROJECT_CHANGE_KINDS]).toEqual([
      "project-created",
      "project-updated",
      "project-deleted",
      "project-sources-changed",
      "threads-changed",
      "project-order-changed",
      "automations-changed",
      "nudges-changed",
    ]);
  });

  it("keeps the frozen environment change kinds", () => {
    expect([...ENVIRONMENT_CHANGE_KINDS]).toEqual([
      "environment-created",
      "environment-deleted",
      "metadata-changed",
      "status-changed",
      "work-status-changed",
      "git-refs-changed",
      "thread-storage-changed",
    ]);
  });

  it("keeps the frozen host change kinds (never emitted post-merge, still accepted)", () => {
    expect([...HOST_CHANGE_KINDS]).toEqual([
      "host-connected",
      "host-disconnected",
    ]);
  });

  it("keeps the frozen system change kinds", () => {
    expect([...SYSTEM_CHANGE_KINDS]).toEqual([
      "config-changed",
      "apps-changed",
    ]);
  });

  it("keeps the frozen app change kinds", () => {
    expect([...APP_CHANGE_KINDS]).toEqual(["apps-changed", "content-changed"]);
  });
});
