import Link from "next/link";

import {
  DEMO_CATALOG_PRODUCTS,
  PUBLIC_ARCHITECTURE_URL,
  PUBLIC_GITHUB_REPO_URL,
  PUBLIC_README_URL,
  tryGetLatestCampaignSummary,
} from "@/lib/campaigns";

import styles from "./home.module.css";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const latestCampaign = await tryGetLatestCampaignSummary();

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>Studio Shots</p>
          <h1>Telegram-first AI product photography</h1>
          <p className={styles.lede}>
            Import a catalog in chat, preview spend, generate lifestyle candidates with Luma, and
            approve shots where your team already works—then download approved assets for product
            pages.
          </p>
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
              <Link className={styles.primaryLink} href={latestCampaign.campaignPagePath}>
                Latest campaign
              </Link>
            ) : null}
          </div>
          {!latestCampaign ? (
            <p className={styles.hint}>
              No campaign imported yet. Upload a catalog CSV in Telegram with caption{" "}
              <code>/import</code> to create one.
            </p>
          ) : (
            <p className={styles.hint}>
              Latest import {latestCampaign.importedAtLabel}
              {latestCampaign.filename ? ` · ${latestCampaign.filename}` : ""}. Generation and review
              stay in Telegram—this site is read-only.
            </p>
          )}
        </header>

        <section className={styles.section} aria-labelledby="steps-heading">
          <div className={styles.sectionHead}>
            <h2 id="steps-heading">How it works</h2>
            <p>Four steps from catalog CSV to downloadable approved assets.</p>
          </div>
          <ol className={styles.steps}>
            <li>
              <strong>Import catalog</strong>
              <span>Send your product CSV in Telegram with caption /import.</span>
            </li>
            <li>
              <strong>Preview scope and cost</strong>
              <span>Confirm actionable SKUs and estimated generation spend before any paid run.</span>
            </li>
            <li>
              <strong>Generate and review in Telegram</strong>
              <span>Generate one product at a time, then approve or reject each candidate in chat.</span>
            </li>
            <li>
              <strong>Download approved assets</strong>
              <span>Approved Blob-backed images appear on public product pages for e-commerce.</span>
            </li>
          </ol>
        </section>

        <section className={styles.section} aria-labelledby="demo-heading">
          <div className={styles.sectionHead}>
            <h2 id="demo-heading">Demo catalog</h2>
            <p>Four synthetic products shipped with Studio Shots for local demos and screenshots.</p>
          </div>
          <ul className={styles.demoGrid}>
            {DEMO_CATALOG_PRODUCTS.map((product) => (
              <li key={product.sku} className={styles.demoCard}>
                <div className={styles.demoMedia}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={product.photoUrl} alt={product.productName} />
                </div>
                <div className={styles.demoCopy}>
                  <p className={styles.demoSku}>{product.sku}</p>
                  <h3>{product.productName}</h3>
                  <p className={styles.demoMeta}>
                    Priority {product.priority}
                  </p>
                  <Link href={`/products/${product.sku}`}>Open product page</Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
