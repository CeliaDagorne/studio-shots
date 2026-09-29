import { GradientButton } from "@/components/gradient-button";
import { ProductCard, ProductCardGrid } from "@/components/product-card";
import {
  DEMO_CATALOG_PRODUCTS,
  PUBLIC_ARCHITECTURE_URL,
  PUBLIC_GITHUB_REPO_URL,
  PUBLIC_README_URL,
  tryGetLatestCampaignSummary,
} from "@/lib/campaigns";
import {
  HOME_HERO_TITLE,
  HOME_LATEST_CAMPAIGN_SUFFIX,
  HOME_STEPS,
  HOME_STEPS_INTRO,
  SITE_DESCRIPTION,
} from "@/lib/website-copy";

import styles from "./home.module.css";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const latestCampaign = await tryGetLatestCampaignSummary();

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>Studio Shots</p>
          <h1>{HOME_HERO_TITLE}</h1>
          <p className={styles.lede}>{SITE_DESCRIPTION}</p>
          <div className={styles.ctaRow}>
            <GradientButton href={PUBLIC_GITHUB_REPO_URL} external>
              View on GitHub
            </GradientButton>
            <GradientButton href={PUBLIC_README_URL} external>
              README
            </GradientButton>
            <GradientButton href={PUBLIC_ARCHITECTURE_URL} external>
              Architecture
            </GradientButton>
            {latestCampaign ? (
              <GradientButton href={latestCampaign.campaignPagePath}>
                Latest campaign
              </GradientButton>
            ) : null}
          </div>
          {!latestCampaign ? (
            <p className={styles.hint}>
              No campaign imported yet. Upload a catalog CSV in Slack and
              mention @Studio Shots with <code>import</code> to create one.
            </p>
          ) : (
            <p className={styles.hint}>
              Latest import {latestCampaign.importedAtLabel}
              {latestCampaign.filename
                ? ` · ${latestCampaign.filename}`
                : ""}. {HOME_LATEST_CAMPAIGN_SUFFIX}
            </p>
          )}
        </header>

        <section className={styles.section} aria-labelledby="steps-heading">
          <div className={styles.sectionHead}>
            <h2 id="steps-heading">How it works</h2>
            <p>{HOME_STEPS_INTRO}</p>
          </div>
          <ol className={styles.steps}>
            <li>
              <strong>{HOME_STEPS[0].title}</strong>
              <span>
                Attach your product CSV in Slack and mention @Studio Shots with{" "}
                <code>import</code>.
              </span>
            </li>
            <li>
              <strong>{HOME_STEPS[1].title}</strong>
              <span>{HOME_STEPS[1].body}</span>
            </li>
            <li>
              <strong>{HOME_STEPS[2].title}</strong>
              <span>{HOME_STEPS[2].body}</span>
            </li>
            <li>
              <strong>{HOME_STEPS[3].title}</strong>
              <span>{HOME_STEPS[3].body}</span>
            </li>
          </ol>
        </section>

        <section className={styles.section} aria-labelledby="demo-heading">
          <div className={styles.sectionHead}>
            <h2 id="demo-heading">Demo catalog</h2>
            <p>
              Four synthetic products shipped with Studio Shots for local demos
              and screenshots.
            </p>
          </div>
          <ProductCardGrid>
            {DEMO_CATALOG_PRODUCTS.map((product) => (
              <li key={product.sku}>
                <ProductCard
                  href={`/products/${product.sku}`}
                  sku={product.sku}
                  productName={product.productName}
                  photoUrl={product.photoUrl}
                  meta={<p>Priority {product.priority}</p>}
                />
              </li>
            ))}
          </ProductCardGrid>
        </section>
      </div>
    </main>
  );
}
