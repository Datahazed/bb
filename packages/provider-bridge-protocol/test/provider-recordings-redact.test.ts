import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const REDACT_SCRIPT = new URL(
  "../../../scripts/provider-recordings/redact.mjs",
  import.meta.url,
);

it("redacts every documented GitHub token prefix", () => {
  const root = mkdtempSync(join(tmpdir(), "bb-recording-redact-"));
  const inputDir = join(root, "input");
  const outputDir = join(root, "output");
  const tokens = [
    `ghp_${"a".repeat(36)}`,
    `gho_${"b".repeat(36)}`,
    `ghu_${"c".repeat(36)}`,
    `ghs_${"d".repeat(36)}`,
    `ghs_12345_${"e".repeat(12)}.${"f".repeat(12)}.${"g".repeat(12)}`,
    `ghr_${"h".repeat(36)}`,
    `github_pat_${"i".repeat(82)}`,
  ];

  try {
    mkdirSync(inputDir);
    writeFileSync(
      join(inputDir, "github.ndjson"),
      `${JSON.stringify({ line: JSON.stringify({ tokens }) })}\n`,
    );

    const stdout = execFileSync(
      process.execPath,
      [REDACT_SCRIPT.pathname, inputDir, outputDir, "--home", "/home/tester"],
      { encoding: "utf8" },
    );
    const output = readFileSync(join(outputDir, "github.ndjson"), "utf8");

    expect(stdout).toContain("0 survivors");
    for (const token of tokens) expect(output).not.toContain(token);
    expect(output.match(/REDACTED/g)).toHaveLength(tokens.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("redacts Claude thinking signatures without changing recorded model ids", () => {
  const root = mkdtempSync(join(tmpdir(), "bb-recording-redact-"));
  const inputDir = join(root, "input");
  const outputDir = join(root, "output");
  const message = {
    type: "assistant",
    message: {
      model: "claude-mangosteen-eap",
      content: [
        {
          type: "thinking",
          thinking: "synthetic reasoning",
          signature: "OPAQUE_SIGNATURE_PAYLOAD",
        },
        {
          type: "tool_use",
          input: { signature: "ordinary-signature" },
        },
      ],
    },
  };
  const expected = {
    ...message,
    message: {
      ...message.message,
      content: [
        { ...message.message.content[0], signature: "REDACTED" },
        message.message.content[1],
      ],
    },
  };

  try {
    mkdirSync(inputDir);
    writeFileSync(
      join(inputDir, "thinking.ndjson"),
      `${JSON.stringify(message)}\n${JSON.stringify({ line: JSON.stringify(message) })}\n`,
    );

    execFileSync(
      process.execPath,
      [REDACT_SCRIPT.pathname, inputDir, outputDir, "--home", "/home/tester"],
    );
    const output = readFileSync(join(outputDir, "thinking.ndjson"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(output).toEqual([expected, { line: JSON.stringify(expected) }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
