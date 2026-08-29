
export const MARKETPLACE_INLINE_PANES_MIN_VIEWPORT = 768;

export const MARKETPLACE_NAV_WIDTH_RATIO = 0.15;
export const MARKETPLACE_NAV_MIN_WIDTH = 200;
export const MARKETPLACE_NAV_MAX_WIDTH = 280;

export const MARKETPLACE_DETAIL_WIDTH_PERCENT = 38;
export const MARKETPLACE_DETAIL_MIN_WIDTH_PERCENT = 30;
export const MARKETPLACE_DETAIL_MAX_WIDTH_PERCENT = 44;

export function clampMarketplaceNavWidth(width: number): number {
  return Math.min(
    MARKETPLACE_NAV_MAX_WIDTH,
    Math.max(MARKETPLACE_NAV_MIN_WIDTH, width),
  );
}

export function marketplaceNavWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return MARKETPLACE_NAV_MIN_WIDTH;
  }
  return Math.round(
    clampMarketplaceNavWidth(viewportWidth * MARKETPLACE_NAV_WIDTH_RATIO),
  );
}

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
