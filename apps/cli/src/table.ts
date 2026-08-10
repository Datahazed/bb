import Table from "cli-table3";
import { stripVTControlCharacters } from "node:util";

interface BorderlessTableOptions {
  head: string[];
  colWidths: number[];
  trimTrailingWhitespace?: boolean;
}

const BORDERLESS_TABLE_OPTIONS = {
  chars: {
    top: "",
    "top-mid": "",
    "top-left": "",
    "top-right": "",
    bottom: "",
    "bottom-mid": "",
    "bottom-left": "",
    "bottom-right": "",
    left: "",
    "left-mid": "",
    mid: "-",
    "mid-mid": "  ",
    right: "",
    "right-mid": "",
    middle: "  ",
  },
  style: {
    head: [],
    border: [],
    ["padding-left"]: 0,
    ["padding-right"]: 0,
  },
};

export function renderBorderlessTable(
  options: BorderlessTableOptions,
  rows: string[][],
): string {
  const table = new Table({
    ...BORDERLESS_TABLE_OPTIONS,
    head: options.head.map(cleanTerminalTableCell),
    colWidths: options.colWidths,
  });

  for (const row of rows) {
    table.push(row.map(cleanTerminalTableCell));
  }

  const rendered = table.toString();
  if (!options.trimTrailingWhitespace) {
    return rendered;
  }
  return rendered
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

function cleanTerminalTableCell(value: string): string {
  return stripVTControlCharacters(value)
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, "");
}
