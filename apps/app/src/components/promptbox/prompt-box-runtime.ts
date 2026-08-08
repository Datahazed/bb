import type { TypeaheadCommandConfig } from "./PromptBoxInternalImpl";

export const INERT_TYPEAHEAD_COMMAND_CONFIG: TypeaheadCommandConfig = {
  trigger: null,
  suggestions: [],
  isLoading: false,
  isError: false,
  hasMore: false,
  isLoadingMore: false,
  loadMore: () => {},
  onQueryChange: () => {},
};

export function suppressPromptEditorAnchorActivation(event: Event): boolean {
  if (!(event.target instanceof Element)) return false;
  if (event.target.closest("a[href]") === null) return false;

  event.preventDefault();
  event.stopPropagation();
  return true;
}
