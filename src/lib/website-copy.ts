/** User-facing website marketing copy (Slack-primary workflow). */

export const SITE_DESCRIPTION =
  "Import a product catalog, preview costs, generate lifestyle images with Luma, and approve the best shots without leaving your team’s channel. Telegram is also supported.";

export const SITE_TITLE = "Studio Shots";

export const HOME_HERO_EYEBROW = "Slack-first product photography";

export const HOME_HERO_TITLE =
  "Turn your catalog into approved product shots — without leaving Slack.";

export const HOME_HERO_LEDE =
  "Import a CSV, preview cost, generate lifestyle images, and review them with the team — all in Slack.";

export const HOME_HERO_SUPPORT =
  "Human review before anything becomes a final asset.";

export const HOME_EMPTY_CAMPAIGN =
  "No campaign imported yet. Upload a catalog CSV in Slack and mention @Studio Shots with import to create one.";

export const HOME_LATEST_CAMPAIGN_SUFFIX =
  "Generation and review stay in Slack. This site is read-only.";

export const HOME_STEPS_INTRO =
  "Four steps from catalog CSV to downloadable approved assets.";

export const HOME_STEPS = [
  {
    title: "Import the catalog",
    body: "Attach your product CSV in Slack and mention @Studio Shots with import.",
  },
  {
    title: "Review scope and estimated cost",
    body: "Confirm actionable SKUs and estimated generation spend before any paid run.",
  },
  {
    title: "Generate and approve in Slack",
    body: "Generate one product at a time, then approve or reject each candidate in your channel.",
  },
  {
    title: "Download final assets",
    body: "Approved Blob-backed images appear on public product pages for e-commerce.",
  },
] as const;

export const HOME_CHAT_FIRST_TITLE = "Creative review already happens in chat.";

export const HOME_CHAT_FIRST_BODY =
  "Studio Shots brings generation, feedback and approval into the same Slack channel, so teams do not need another dashboard just to move a campaign forward.";

export const HOME_CAMPAIGN_SECTION_TITLE = "The web app is the shared record";

export const HOME_CAMPAIGN_SECTION_BODY =
  "Slack runs the workflow. The companion site shows campaign progress, actionable products, approved image counts, and estimated spend — a read-only record your team can share.";

export const HOME_FINAL_CTA_TITLE = "Explore the working prototype";

export const HOME_FINAL_CTA_BODY =
  "Studio Shots is a working prototype: import in Slack, generate with Luma, and browse approved assets here.";

export const CAMPAIGN_PAGE_LEDE_SUFFIX =
  "This page is read-only. Generate and review products in Slack.";

export const CAMPAIGN_METRICS_INTRO =
  "Live rollup from the same status rules used in Slack.";

export const CAMPAIGN_NOT_FOUND_BODY =
  "That campaign overview does not exist, or the import id is invalid. Import a catalog in Slack and mention @Studio Shots with import to create a campaign, or return home.";

export const PRODUCT_APPROVED_HEADING = "Approved images";
export const PRODUCT_APPROVED_DESCRIPTION = "Final images approved by your team.";
export const PRODUCT_EMPTY_APPROVED_TITLE = "No approved images yet";
export const PRODUCT_EMPTY_APPROVED_BODY =
  "Generate or review candidates in Slack to add final images here.";

export const PRODUCT_HISTORY_TITLE = "Generation history";
export const productHistoryDescription = (sku: string): string =>
  `Every generation attempt and review decision for ${sku}.`;

export const PRODUCT_NOT_FOUND_BODY =
  "That SKU is not in the imported catalog yet. Import the CSV in Slack, then open the product page again.";
