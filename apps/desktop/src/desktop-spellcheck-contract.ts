export const BB_DESKTOP_SPELLCHECK_GLOBAL_NAME = "__bbDesktopSpellcheck";

export interface BbDesktopSpellcheckCorrectionContext {
  dictionarySuggestions: string[];
  misspelledWord: string;
}

export interface BbDesktopSpellcheckApi {
  getCorrectionContext(
    word: string,
  ): BbDesktopSpellcheckCorrectionContext | null;
}

interface BbDesktopSpellcheckCorrectionCandidate {
  dictionarySuggestions?: unknown;
  misspelledWord?: unknown;
}

function isCorrectionCandidate(
  value: unknown,
): value is BbDesktopSpellcheckCorrectionCandidate {
  return typeof value === "object" && value !== null;
}

export function parseBbDesktopSpellcheckCorrectionContext(
  value: unknown,
): BbDesktopSpellcheckCorrectionContext | null {
  if (!isCorrectionCandidate(value)) {
    return null;
  }
  const { dictionarySuggestions, misspelledWord } = value;
  if (
    typeof misspelledWord !== "string" ||
    !Array.isArray(dictionarySuggestions) ||
    dictionarySuggestions.some((suggestion) => typeof suggestion !== "string")
  ) {
    return null;
  }
  return {
    dictionarySuggestions,
    misspelledWord,
  };
}

export function buildBbDesktopSpellcheckLookupScript(word: string): string {
  return `globalThis[${JSON.stringify(BB_DESKTOP_SPELLCHECK_GLOBAL_NAME)}]?.getCorrectionContext(${JSON.stringify(word)}) ?? null`;
}
