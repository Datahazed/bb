import type { AvailableModel } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { toModelPickerOptions } from "./model-picker-option";

function model(
  id: string,
  displayName: string,
  description = "",
  extra: Partial<AvailableModel> = {},
): AvailableModel {
  return {
    id,
    model: id,
    displayName,
    description,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    isDefault: false,
    ...extra,
  };
}

const identity = (label: string) => label;

describe("toModelPickerOptions", () => {
  it("leaves rows with unique labels exactly as before, whatever their description", () => {
    expect(
      toModelPickerOptions(
        [
          model(
            "claude-opus-4-7",
            "Claude Opus 4.7",
            "Most capable model for complex work",
          ),
          model("claude-sonnet-4-6", "Claude Sonnet 4.6", "Fast and smart"),
        ],
        identity,
      ),
    ).toEqual([
      { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
      { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    ]);
  });

  it("qualifies only the rows whose formatted labels collide", () => {
    expect(
      toModelPickerOptions(
        [
          model("github-copilot/gpt-5.1", "GPT-5.1", "github-copilot/gpt-5.1"),
          model("openai-codex/gpt-5.1", "GPT-5.1", "openai-codex/gpt-5.1"),
          model("openai-codex/gpt-5.2", "GPT-5.2", "openai-codex/gpt-5.2"),
        ],
        identity,
      ),
    ).toEqual([
      {
        value: "github-copilot/gpt-5.1",
        label: "GPT-5.1",
        qualifier: "github-copilot/gpt-5.1",
      },
      {
        value: "openai-codex/gpt-5.1",
        label: "GPT-5.1",
        qualifier: "openai-codex/gpt-5.1",
      },
      { value: "openai-codex/gpt-5.2", label: "GPT-5.2" },
    ]);
  });

  it("falls back to the raw model id when the description is missing or too long to be an identifier", () => {
    expect(
      toModelPickerOptions(
        [
          model("vendor-a/glm-4.7", "GLM 4.7"),
          model(
            "vendor-b/glm-4.7",
            "GLM 4.7",
            "A long-form marketing sentence describing the model at length.",
          ),
        ],
        identity,
      ),
    ).toEqual([
      {
        value: "vendor-a/glm-4.7",
        label: "GLM 4.7",
        qualifier: "vendor-a/glm-4.7",
      },
      {
        value: "vendor-b/glm-4.7",
        label: "GLM 4.7",
        qualifier: "vendor-b/glm-4.7",
      },
    ]);
  });

  it("detects collisions on the formatted label and keeps a route provider as the qualifier", () => {
    expect(
      toModelPickerOptions(
        [
          model("openai/gpt-5", "gpt-5", "api", { routeProviderId: "openai" }),
          model("openai-codex/gpt-5", "GPT-5", "subscription", {
            routeProviderId: "openai-codex",
          }),
        ],
        (label) => label.toUpperCase(),
      ),
    ).toEqual([
      { value: "openai/gpt-5", label: "GPT-5", qualifier: "openai" },
      {
        value: "openai-codex/gpt-5",
        label: "GPT-5",
        qualifier: "openai-codex",
      },
    ]);
  });
});
