import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadTimelineSurfaceProps } from "./ThreadTimelineSurface.js";
import { ThreadTimelinePanelContent } from "./ThreadTimelinePanelContent.js";
import type { UseThreadTimelineControllerResult } from "./useThreadTimelineController.js";

const mocks = vi.hoisted(() => ({
  displayStatus: "idle",
  surfaceProps: [] as ThreadTimelineSurfaceProps[],
  threadStatus: "idle",
  timeline: undefined as unknown as UseThreadTimelineControllerResult,
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThread: () => ({
    data: {
      runtime: { displayStatus: mocks.displayStatus },
      status: mocks.threadStatus,
    },
    error: null,
  }),
}));

vi.mock("./useThreadTimelineController.js", () => ({
  useThreadTimelineController: () => mocks.timeline,
}));

vi.mock("./ThreadTimelineSurface.js", () => ({
  ThreadTimelineSurface: (props: ThreadTimelineSurfaceProps) => {
    mocks.surfaceProps.push(props);
    return (
      <div data-testid="timeline-surface">
        {props.showOngoingIndicator ? (
          <div>{props.ongoingIndicatorLabel ?? "Working"}</div>
        ) : null}
      </div>
    );
  },
}));

function makeTimeline(
  overrides: Partial<UseThreadTimelineControllerResult> = {},
): UseThreadTimelineControllerResult {
  return {
    activeThinking: null,
    activeWorkflow: null,
    activeBackgroundCommands: [],
    contextWindowUsage: undefined,
    goal: null,
    hasOlderTimelineRows: false,
    isLoadingOlderTimelineRows: false,
    loadOlderTimelineRows: vi.fn(),
    pendingTodos: null,
    timelineError: null,
    timelineLoading: false,
    timelineRows: [],
    ...overrides,
  } as UseThreadTimelineControllerResult;
}

function lastSurfaceProps(): ThreadTimelineSurfaceProps {
  const props = mocks.surfaceProps.at(-1);
  if (!props) {
    throw new Error("ThreadTimelineSurface did not render");
  }
  return props;
}

beforeEach(() => {
  mocks.displayStatus = "idle";
  mocks.surfaceProps = [];
  mocks.threadStatus = "idle";
  mocks.timeline = makeTimeline();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ThreadTimelinePanelContent background task indicator", () => {
  it("shows a background-only working indicator for an idle thread with an active workflow", () => {
    mocks.timeline = makeTimeline({
      activeWorkflow: {} as UseThreadTimelineControllerResult["activeWorkflow"],
    });

    const markup = renderToStaticMarkup(
      <ThreadTimelinePanelContent threadId="thr_workflow" />,
    );

    expect(markup).toContain("Background work running");
    expect(lastSurfaceProps()).toMatchObject({
      ongoingIndicatorLabel: "Background work running",
      showOngoingIndicator: true,
    });
  });

  it("shows a background-only working indicator for an idle thread with active background commands", () => {
    mocks.timeline = makeTimeline({
      activeBackgroundCommands: [
        {},
      ] as UseThreadTimelineControllerResult["activeBackgroundCommands"],
    });

    const markup = renderToStaticMarkup(
      <ThreadTimelinePanelContent threadId="thr_command" />,
    );

    expect(markup).toContain("Background work running");
    expect(lastSurfaceProps()).toMatchObject({
      ongoingIndicatorLabel: "Background work running",
      showOngoingIndicator: true,
    });
  });

  it("does not show the background-task indicator for stopping threads", () => {
    mocks.threadStatus = "stopping";
    mocks.timeline = makeTimeline({
      activeWorkflow: {} as UseThreadTimelineControllerResult["activeWorkflow"],
    });

    const markup = renderToStaticMarkup(
      <ThreadTimelinePanelContent threadId="thr_stopping" />,
    );

    expect(markup).not.toContain("Background work running");
    expect(lastSurfaceProps()).toMatchObject({
      showOngoingIndicator: false,
    });
  });
});
