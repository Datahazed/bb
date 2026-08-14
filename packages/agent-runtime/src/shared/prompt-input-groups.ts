import type { PromptInput } from "@bb/domain";

export function flattenPromptInputGroups(
  input: PromptInput[],
  inputGroups: PromptInput[][] | undefined,
): PromptInput[] {
  if (inputGroups === undefined) {
    return input;
  }
  return inputGroups.flatMap((group, index) =>
    index === 0
      ? group
      : [{ type: "text" as const, text: "\n\n", mentions: [] }, ...group],
  );
}
