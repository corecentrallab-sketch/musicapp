import { AFFILIATE_RETAILERS, type AffiliateRetailer } from "./affiliates";

export function generatePurchaseUrls(
  title: string,
  composer: string,
  retailerKeys?: string[],
): Record<string, string> {
  const q = encodeURIComponent(`${title} ${composer}`.trim());
  const keys = retailerKeys ?? Object.keys(AFFILIATE_RETAILERS);
  const urls: Record<string, string> = {};

  for (const key of keys) {
    const retailer = AFFILIATE_RETAILERS[key];
    if (retailer) {
      urls[key] = retailer.urlTemplate.replace("{{query}}", q);
    }
  }

  return urls;
}

export function getRetailer(key: string): AffiliateRetailer | undefined {
  return AFFILIATE_RETAILERS[key];
}
