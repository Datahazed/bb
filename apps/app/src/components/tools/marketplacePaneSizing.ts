/**
 * Default pane widths for the Marketplace (Extensions) three-pane layout.
 *
 * A leaf module: the app shell sizes the left pane from it, the secondary
 * panel layout sizes the right pane from it, and tests assert the ordering
 * invariant against it without mounting either.
 *
 * The layout is nav | catalog | detail. Each pane gets a share of the viewport
 * rather than a pixel width, because a width chosen for a 1440px laptop either
 * strands space on a 2560px display or crowds the catalog on a 13" one. Every
 * share is clamped so the proportion never produces an unreadable pane at the
 * extremes.
 *
 * The invariant the proportions exist to hold, at every viewport width where
 * all three panes are inline:
 *
 *     catalog  >  detail  >  nav
 *
 * The catalog is the surface people came to read, so it takes the remainder
 * and stays widest. Detail is secondary but carries prose and screenshots, so
 * it outranks the nav, which holds six short labels and needs no more room
 * than its longest one.
 *
 * These are defaults. A width the user drags is their decision and is
 * preserved; the ordering above describes what they are handed, not a cage.
 */

/**
 * Below this the detail pane is a drawer rather than a third column, so the
 * ordering invariant only has to hold from here up. Matches
 * COMPACT_VIEWPORT_QUERY in @bb/shared-ui.
 */
export const MARKETPLACE_INLINE_PANES_MIN_VIEWPORT = 768;

/**
 * Nav pane, as a share of the viewport.
 *
 * Narrower than the app-wide sidebar because it holds a different thing: six
 * fixed labels, the longest being "Installed plugins". The app sidebar is
 * sized for project trees and thread titles, which have no natural width.
 */
export const MARKETPLACE_NAV_WIDTH_RATIO = 0.15;
export const MARKETPLACE_NAV_MIN_WIDTH = 200;
export const MARKETPLACE_NAV_MAX_WIDTH = 280;

/**
 * Detail pane, as a share of the space left after the nav — the panel group
 * measures in percent of itself, not of the viewport.
 *
 * The maximum is the load-bearing number: at 44% the catalog keeps 56% and
 * stays widest no matter how wide the display gets. Anything at or above 50%
 * would let the detail pane tie or beat the surface it was opened from.
 */
export const MARKETPLACE_DETAIL_WIDTH_PERCENT = 38;
export const MARKETPLACE_DETAIL_MIN_WIDTH_PERCENT = 30;
export const MARKETPLACE_DETAIL_MAX_WIDTH_PERCENT = 44;

export function clampMarketplaceNavWidth(width: number): number {
  return Math.min(
    MARKETPLACE_NAV_MAX_WIDTH,
    Math.max(MARKETPLACE_NAV_MIN_WIDTH, width),
  );
}

/**
 * The nav pane's default width at a given viewport width, in pixels.
 *
 * Pixels rather than a CSS percentage because the shell already sizes the
 * sidebar with `--sidebar-width` and drives its drag in pixels; expressing the
 * default here keeps one unit through the whole path.
 */
export function marketplaceNavWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return MARKETPLACE_NAV_MIN_WIDTH;
  }
  return Math.round(
    clampMarketplaceNavWidth(viewportWidth * MARKETPLACE_NAV_WIDTH_RATIO),
  );
}

/**
 * The narrowest the detail pane may be dragged, at a given viewport width.
 *
 * A flat 30% floor reads fine on a large display but inverts the ordering on a
 * small one: at 768px, 30% of the group is 170px against a 200px nav. The
 * floor therefore rises only where the viewport is small enough for it to
 * matter, so `catalog > detail > nav` holds for every width the user can drag
 * to, not merely for the default they are handed.
 */
export function marketplaceDetailMinPercent(viewportWidth: number): number {
  const nav = marketplaceNavWidth(viewportWidth);
  const group = Math.max(1, viewportWidth - nav);
  const clearsNav = Math.ceil(((nav + 1) / group) * 100);
  return Math.min(
    MARKETPLACE_DETAIL_MAX_WIDTH_PERCENT,
    Math.max(MARKETPLACE_DETAIL_MIN_WIDTH_PERCENT, clearsNav),
  );
}

export function clampMarketplaceDetailPercent(
  percent: number,
  viewportWidth?: number,
): number {
  const min =
    viewportWidth === undefined
      ? MARKETPLACE_DETAIL_MIN_WIDTH_PERCENT
      : marketplaceDetailMinPercent(viewportWidth);
  return Math.min(
    MARKETPLACE_DETAIL_MAX_WIDTH_PERCENT,
    Math.max(min, percent),
  );
}

export interface MarketplacePaneWidths {
  nav: number;
  catalog: number;
  detail: number;
}

/**
 * The three pane widths in pixels at a given viewport width, with the detail
 * pane open. Exported so a test can assert the ordering invariant directly
 * rather than inferring it from a rendered layout.
 */
export function marketplacePaneWidths(
  viewportWidth: number,
  detailPercent: number = MARKETPLACE_DETAIL_WIDTH_PERCENT,
): MarketplacePaneWidths {
  const nav = marketplaceNavWidth(viewportWidth);
  const group = Math.max(0, viewportWidth - nav);
  const detail = Math.round(
    (group * clampMarketplaceDetailPercent(detailPercent, viewportWidth)) / 100,
  );
  return { nav, catalog: group - detail, detail };
}
