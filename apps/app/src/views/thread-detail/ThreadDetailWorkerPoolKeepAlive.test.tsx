// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { retainDiffWorkerPoolDemand } from "@/lib/diff-worker-pool";
import { ThreadDetailWorkerPoolKeepAlive } from "./ThreadDetailWorkerPoolKeepAlive";

// The holder exists so a virtualized timeline scrolling its last diff out of
// view does not terminate the worker pool. It must not become a permanent
// hold: the split workspace keeps this component mounted across thread
// navigation, so a latch that never released would keep workers alive for the
// rest of the session after a single diff.
vi.mock("@/components/git-diff/DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolKeepAlive: () => <div data-testid="pool-held" />,
}));

afterEach(cleanup);

function Harness() {
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        onClick={() => navigate("/projects/proj_1/threads/thr_2")}
      >
        open another thread
      </button>
      <ThreadDetailWorkerPoolKeepAlive />
    </>
  );
}

function renderHarness() {
  return render(
    <MemoryRouter initialEntries={["/projects/proj_1/threads/thr_1"]}>
      <Harness />
    </MemoryRouter>,
  );
}

describe("ThreadDetailWorkerPoolKeepAlive", () => {
  it("keeps holding the pool after the last diff surface unmounts", async () => {
    const release = retainDiffWorkerPoolDemand();
    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("pool-held")).not.toBeNull();
    });
    release();

    expect(screen.getByTestId("pool-held")).not.toBeNull();
  });

  it("releases the pool when another thread opens without a diff", async () => {
    const release = retainDiffWorkerPoolDemand();
    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("pool-held")).not.toBeNull();
    });
    release();

    // Same mount, different thread: the component outlives the navigation.
    fireEvent.click(screen.getByText("open another thread"));

    await waitFor(() => {
      expect(screen.queryByTestId("pool-held")).toBeNull();
    });
  });

  it("does not hold the pool for a thread that never showed a diff", () => {
    renderHarness();

    expect(screen.queryByTestId("pool-held")).toBeNull();
  });
});
