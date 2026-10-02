import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_METRICS_INTRO,
  CAMPAIGN_NOT_FOUND_BODY,
  CAMPAIGN_PAGE_LEDE_SUFFIX,
  HOME_EMPTY_CAMPAIGN,
  HOME_HERO_TITLE,
  HOME_LATEST_CAMPAIGN_SUFFIX,
  HOME_STEPS,
  PRODUCT_APPROVED_DESCRIPTION,
  PRODUCT_APPROVED_HEADING,
  PRODUCT_EMPTY_APPROVED_BODY,
  PRODUCT_EMPTY_APPROVED_TITLE,
  PRODUCT_HISTORY_TITLE,
  PRODUCT_NOT_FOUND_BODY,
  SITE_DESCRIPTION,
  productHistoryDescription,
} from "@/lib/website-copy";

test("website copy presents Slack as the primary workflow", () => {
  assert.equal(HOME_HERO_TITLE, "AI product photography, directly in Slack");
  assert.match(SITE_DESCRIPTION, /without leaving your team’s channel/);
  assert.match(SITE_DESCRIPTION, /Telegram is also supported/);
  assert.match(HOME_EMPTY_CAMPAIGN, /Upload a catalog CSV in Slack/);
  assert.match(HOME_EMPTY_CAMPAIGN, /mention @Studio Shots with import/);
  assert.doesNotMatch(HOME_EMPTY_CAMPAIGN, /Telegram|\/import/);
  assert.match(HOME_LATEST_CAMPAIGN_SUFFIX, /stay in Slack/);
  assert.doesNotMatch(HOME_LATEST_CAMPAIGN_SUFFIX, /Telegram/);
});

test("how-it-works steps are Slack-first and avoid Telegram residue", () => {
  assert.equal(HOME_STEPS.length, 4);
  assert.equal(HOME_STEPS[0]?.title, "Import catalog");
  assert.match(HOME_STEPS[0]!.body, /Slack/);
  assert.doesNotMatch(HOME_STEPS[0]!.body, /Telegram|\/import/);
  assert.equal(HOME_STEPS[2]?.title, "Generate and review in Slack");
  assert.match(HOME_STEPS[2]!.body, /your channel/);
  for (const step of HOME_STEPS) {
    assert.doesNotMatch(step.title, /Telegram/);
    assert.doesNotMatch(step.body, /Telegram|\/import/);
  }
});

test("campaign and product website states instruct Slack, not Telegram", () => {
  assert.match(CAMPAIGN_PAGE_LEDE_SUFFIX, /in Slack/);
  assert.doesNotMatch(CAMPAIGN_PAGE_LEDE_SUFFIX, /Telegram/);
  assert.match(CAMPAIGN_METRICS_INTRO, /used in Slack/);
  assert.doesNotMatch(CAMPAIGN_METRICS_INTRO, /Telegram|\/status/);
  assert.match(CAMPAIGN_NOT_FOUND_BODY, /Import a catalog in Slack/);
  assert.doesNotMatch(CAMPAIGN_NOT_FOUND_BODY, /Telegram|\/import/);
  assert.match(PRODUCT_EMPTY_APPROVED_TITLE, /No approved images yet/);
  assert.match(PRODUCT_EMPTY_APPROVED_BODY, /in Slack/);
  assert.doesNotMatch(PRODUCT_EMPTY_APPROVED_BODY, /Telegram/);
  assert.equal(PRODUCT_APPROVED_HEADING, "Approved images");
  assert.equal(PRODUCT_APPROVED_DESCRIPTION, "Final images approved by your team.");
  assert.equal(PRODUCT_HISTORY_TITLE, "Generation history");
  assert.match(productHistoryDescription("SS-001"), /SS-001/);
  assert.match(PRODUCT_NOT_FOUND_BODY, /Import the CSV in Slack/);
  assert.doesNotMatch(PRODUCT_NOT_FOUND_BODY, /Telegram/);
});
