import { describe, expect, it } from "vitest";
import {
  buildAutomationEditThreadPrompt,
  buildPluginEditThreadPrompt,
  buildSkillEditThreadPrompt,
} from "@bb/shared-ui/resource-edit-prompt";

describe("resource edit thread prompts", () => {
  it("gives the thread an unambiguous writable resource locator", () => {
    expect(
      buildPluginEditThreadPrompt({
        name: "Pattern Atlas",
        path: "/Users/me/plugins/pattern-atlas",
      }),
    ).toBe(
      'Edit the bb plugin "Pattern Atlas" at /Users/me/plugins/pattern-atlas. I want to ',
    );
    expect(
      buildSkillEditThreadPrompt({
        name: "Review PR",
        path: "/Users/me/.bb/skills/review-pr/SKILL.md",
      }),
    ).toBe(
      'Edit the bb skill "Review PR" at /Users/me/.bb/skills/review-pr/SKILL.md. I want to ',
    );
    expect(
      buildAutomationEditThreadPrompt({
        name: "Daily triage",
        projectId: "proj_123",
        automationId: "auto_456",
      }),
    ).toBe(
      'Edit the bb automation "Daily triage" (ID auto_456) in project proj_123. I want to ',
    );
  });
});
