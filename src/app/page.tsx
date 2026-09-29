import Link from "next/link";

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
            <a className={styles.primaryLink} href={PUBLIC_GITHUB_REPO_URL}>
              View on GitHub
            </a>
            <a className={styles.secondaryLink} href={PUBLIC_README_URL}>
              README
            </a>
            <a className={styles.secondaryLink} href={PUBLIC_ARCHITECTURE_URL}>
              Architecture
            </a>
            {latestCampaign ? (
              <Link
                className={styles.primaryLink}
                href={latestCampaign.campaignPagePath}
              >
                Latest campaign
              </Link>
            ) : null}
          </div>
          {!latestCampaign ? (
            <p className={styles.hint}>
              No campaign imported yet. Upload a catalog CSV in Slack and mention @Studio
              Shots with <code>import</code> to create one.
            </p>
          ) : (
            <p className={styles.hint}>
              Latest import {latestCampaign.importedAtLabel}
              {latestCampaign.filename ? ` · ${latestCampaign.filename}` : ""}.{" "}
              {HOME_LATEST_CAMPAIGN_SUFFIX}
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
          <ul className={styles.demoGrid}>
            {DEMO_CATALOG_PRODUCTS.map((product) => (
              <li key={product.sku}>
                <Link
                  href={`/products/${product.sku}`}
                  className={styles.demoCard}
                >
                  <div className={styles.demoMedia}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={product.photoUrl} alt="" />
                  </div>
                  <div className={styles.demoCopy}>
                    <p className={styles.demoSku}>{product.sku}</p>
                    <h3>{product.productName}</h3>
                    <p className={styles.demoMeta}>
                      Priority {product.priority}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
