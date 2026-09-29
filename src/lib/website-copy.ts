/** User-facing website marketing copy (Slack-primary workflow). */

export const SITE_DESCRIPTION =
  "Import a product catalog, preview costs, generate lifestyle images with Luma, and approve the best shots without leaving your team’s channel. Telegram is also supported.";

export const SITE_TITLE = "Studio Shots";

export const HOME_HERO_TITLE = "AI product photography, directly in Slack";

export const HOME_EMPTY_CAMPAIGN =
  "No campaign imported yet. Upload a catalog CSV in Slack and mention @Studio Shots with import to create one.";

export const HOME_LATEST_CAMPAIGN_SUFFIX =
  "Generation and review stay in Slack. This site is read-only.";

export const HOME_STEPS_INTRO =
  "Four steps from catalog CSV to downloadable approved assets.";

export const HOME_STEPS = [
  {
    title: "Import catalog",
    body: "Attach your product CSV in Slack and mention @Studio Shots with import.",
  },
  {
    title: "Preview scope and cost",
    body: "Confirm actionable SKUs and estimated generation spend before any paid run.",
  },
  {
    title: "Generate and review in Slack",
    body: "Generate one product at a time, then approve or reject each candidate in your channel.",
  },
  {
    title: "Download approved assets",
    body: "Approved Blob-backed images appear on public product pages for e-commerce.",
  },
] as const;

export const CAMPAIGN_PAGE_LEDE_SUFFIX =
  "This page is read-only. Generate and review products in Slack.";

export const CAMPAIGN_METRICS_INTRO =
  "Live rollup from the same status rules used in Slack.";

export const CAMPAIGN_NOT_FOUND_BODY =
  "That campaign overview does not exist, or the import id is invalid. Import a catalog in Slack and mention @Studio Shots with import to create a campaign, or return home.";

export const PRODUCT_EMPTY_APPROVED_PREFIX = "No approved styled shots yet for";
export const PRODUCT_EMPTY_APPROVED_SUFFIX =
  "Once a reviewer approves candidates in Slack, they will appear here automatically.";

export const PRODUCT_NOT_FOUND_BODY =
  "That SKU is not in the imported catalog yet. Import the CSV in Slack, then open the product page again.";
