import { defaultUrlTransform, type UrlTransform } from "react-markdown";

const RELATIVE_ASSET_URL_PATTERN =
  /^(?![a-z][a-z\d+.-]*:|\/\/|\/|#|\?)/iu;

function isRelativeAssetUrl(url: string): boolean {
  return url.length > 0 && RELATIVE_ASSET_URL_PATTERN.test(url);
}

function resolveAssetUrl(assetBaseUrl: string, url: string): string {
  const baseUrl = new URL(assetBaseUrl, window.location.origin);
  const assetUrl = new URL(url, baseUrl);
  return `${assetUrl.pathname}${assetUrl.search}${assetUrl.hash}`;
}

export function createAssetMarkdownUrlTransform(
  assetBaseUrl: string,
): UrlTransform {
  return (url) => {
    const transformedUrl = defaultUrlTransform(url);
    if (!isRelativeAssetUrl(transformedUrl)) {
      return transformedUrl;
    }

    return resolveAssetUrl(assetBaseUrl, transformedUrl);
  };
}
