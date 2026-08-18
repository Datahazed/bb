// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptTextMention } from "@bb/domain";
import type { CompactComposerValue } from "@get-bb/plugin-sdk";

const mocks = vi.hoisted(() => ({
  promptBoxProps: [] as Array<Record<string, unknown>>,
  setMentionQuery: vi.fn(),
}));

vi.mock("@/components/promptbox/PromptBoxInternal", () => ({
  INERT_TYPEAHEAD_COMMAND_CONFIG: {
    trigger: null,
    suggestions: [],
    isLoading: false,
    isError: false,
    hasMore: false,
    isLoadingMore: false,
    loadMore: () => {},
    onQueryChange: () => {},
  },
  PromptBoxInternal: (props: Record<string, unknown>) => {
    mocks.promptBoxProps.push(props);
    return <div data-testid="prompt-box" />;
  },
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThread: () => ({
    data: {
      id: "thr_1",
      projectId: "proj_1",
      environmentId: "env_1",
    },
  }),
}));

vi.mock("@/hooks/usePromptMentions", () => ({
  usePromptMentions: () => ({
    triggers: ["@"],
    suggestions: [],
    isLoading: false,
    isError: false,
    setQuery: mocks.setMentionQuery,
  }),
}));

import {
  compactComposerValueFromPrompt,
  PluginCompactComposer,
  promptMentionsFromCompactComposerValue,
} from "./PluginCompactComposer";

afterEach(cleanup);

beforeEach(() => {
  mocks.promptBoxProps = [];
  vi.clearAllMocks();
});

function latestPromptBoxProps() {
  const props = mocks.promptBoxProps.at(-1);
  if (!props) throw new Error("PromptBoxInternal did not render");
  return props;
}

describe("CompactComposer mention value", () => {
  it("round-trips every host mention resource without exposing domain types", () => {
    const resources: PromptTextMention[] = [
      {
        start: 0,
        end: 7,
        resource: { kind: "thread", threadId: "thr_2", label: "@Thread" },
      },
      {
        start: 8,
        end: 16,
        resource: {
          kind: "project",
          projectId: "proj_2",
          label: "@Project",
        },
      },
      {
        start: 17,
        end: 25,
        resource: {
          kind: "section",
          sectionId: "sec_2",
          label: "@Section",
        },
      },
      {
        start: 26,
        end: 33,
        resource: {
          kind: "path",
          source: "thread-storage",
          entryKind: "directory",
          path: "notes",
          label: "@notes/",
        },
      },
      {
        start: 34,
        end: 40,
        resource: {
          kind: "plugin",
          pluginId: "github",
          itemId: "issue:42",
          label: "@Issue",
        },
      },
    ];
    const text = "@Thread @Project @Section @notes/ @Issue";

    const publicValue = compactComposerValueFromPrompt(text, resources);
    expect(publicValue.mentions).toEqual([
      {
        from: 0,
        to: 7,
        provider: "bb:thread",
        id: "thr_2",
        label: "@Thread",
      },
      {
        from: 8,
        to: 16,
        provider: "bb:project",
        id: "proj_2",
        label: "@Project",
      },
      {
        from: 17,
        to: 25,
        provider: "bb:section",
        id: "sec_2",
        label: "@Section",
      },
      {
        from: 26,
        to: 33,
        provider: "bb:path:thread-storage:directory",
        id: "notes",
        label: "@notes/",
      },
      {
        from: 34,
        to: 40,
        provider: "bb:plugin:github",
        id: "issue:42",
        label: "@Issue",
      },
    ]);
    expect(promptMentionsFromCompactComposerValue(publicValue)).toEqual(
      resources,
    );
  });

  it("keeps invalid or unknown persisted ranges as plain text", () => {
    const value: CompactComposerValue = {
      text: "plain text",
      mentions: [
        { from: -1, to: 2, provider: "bb:thread", id: "x", label: "x" },
        { from: 0, to: 5, provider: "unknown", id: "x", label: "plain" },
      ],
    };

    expect(promptMentionsFromCompactComposerValue(value)).toEqual([]);
  });
});

describe("PluginCompactComposer", () => {
  it("adapts the generic controlled contract to the real prompt engine", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const value: CompactComposerValue = { text: "Draft", mentions: [] };

    render(
      <PluginCompactComposer
        threadId="thr_1"
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        onCancel={onCancel}
        isSubmitting
        disabled
        placeholder="Reply"
        accessibleLabel="Reply body"
        submitLabel="Post reply"
        autoFocus
        focusRequest={4}
      />,
    );

    expect(screen.getByTestId("prompt-box")).toBeTruthy();
    const props = latestPromptBoxProps();
    expect(props).toEqual(
      expect.objectContaining({
        value: "Draft",
        mentionRanges: [],
        onCancel,
        placeholder: "Reply",
        accessibleLabel: "Reply body",
        autoFocus: true,
        focusEndKey: 4,
        minHeight: 44,
        mentionMenuPlacement: "top",
        compact: { isCompact: false, placeholder: "Reply" },
        suppressPluginComposerCustomizations: true,
        submission: {
          isSubmitting: true,
          disabled: true,
          title: "Post reply",
        },
      }),
    );
    const typeahead = props.typeahead as {
      mention: { onQueryChange: unknown };
      command: { trigger: unknown };
    };
    expect(typeahead.mention.onQueryChange).toBe(mocks.setMentionQuery);
    expect(typeahead.command.trigger).toBeNull();

    act(() => {
      (props.onChange as (text: string, mentions: PromptTextMention[]) => void)(
        "Updated",
        [
          {
            start: 0,
            end: 7,
            resource: {
              kind: "thread",
              threadId: "thr_2",
              label: "Updated",
            },
          },
        ],
      );
      (props.onSubmit as () => void)();
    });
    expect(onChange).toHaveBeenCalledWith({
      text: "Updated",
      mentions: [
        {
          from: 0,
          to: 7,
          provider: "bb:thread",
          id: "thr_2",
          label: "Updated",
        },
      ],
    });
    expect(onSubmit).toHaveBeenCalledWith(value);
  });

  it("renders validation without replacing the controlled draft", () => {
    render(
      <PluginCompactComposer
        threadId="thr_1"
        value={{ text: "Too long", mentions: [] }}
        onChange={() => {}}
        onSubmit={() => {}}
        validationMessage="Comment is too long"
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe("Comment is too long");
    expect(latestPromptBoxProps().value).toBe("Too long");
  });
});
