import Link from "next/link";

import { GradientButton } from "@/components/gradient-button";
import { ProductCard, ProductCardGrid } from "@/components/product-card";
import { ScrollReveal } from "@/components/scroll-reveal";
import {
  DEMO_CATALOG_PRODUCTS,
  PUBLIC_ARCHITECTURE_URL,
  PUBLIC_GITHUB_REPO_URL,
  PUBLIC_README_URL,
  tryGetLatestCampaignSummary,
} from "@/lib/campaigns";
import {
  estimatedCostMicrosForOneProduct,
  formatUsdMicros,
} from "@/lib/request-planning";
import {
  HOME_CAMPAIGN_SECTION_BODY,
  HOME_CAMPAIGN_SECTION_TITLE,
  HOME_CHAT_FIRST_BODY,
  HOME_CHAT_FIRST_TITLE,
  HOME_EMPTY_CAMPAIGN,
  HOME_FINAL_CTA_BODY,
  HOME_FINAL_CTA_TITLE,
  HOME_HERO_EYEBROW,
  HOME_HERO_LEDE,
  HOME_HERO_SUPPORT,
  HOME_HERO_TITLE,
  HOME_LATEST_CAMPAIGN_SUFFIX,
  HOME_STEPS,
  HOME_STEPS_INTRO,
} from "@/lib/website-copy";

import styles from "./home.module.css";

export const dynamic = "force-dynamic";

const DEMO_PRODUCT_HREF = `/products/${DEMO_CATALOG_PRODUCTS[0].sku}`;
const PER_PRODUCT_COST = formatUsdMicros(estimatedCostMicrosForOneProduct());

export default async function HomePage() {
  const latestCampaign = await tryGetLatestCampaignSummary();
  const demoHref = latestCampaign?.campaignPagePath ?? DEMO_PRODUCT_HREF;
  const primaryCtaLabel = latestCampaign ? "View live campaign" : "View demo product";
  const productCount = latestCampaign?.totalCatalogRows ?? DEMO_CATALOG_PRODUCTS.length;
  const actionableCount =
    latestCampaign?.requestsReadyToGenerate ?? DEMO_CATALOG_PRODUCTS.length;
  const estimatedSpendLabel = formatUsdMicros(
    estimatedCostMicrosForOneProduct() * Math.max(actionableCount, 0),
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.brandLogo}
              src="/brand/studio-shots-logo.png"
              alt=""
              width={34}
              height={34}
            />
            <span className={styles.brandName}>Studio Shots</span>
          </Link>
          <nav className={styles.nav} aria-label="Primary">
            <a
              className={`${styles.navLink} ${styles.navLinkHideMobile}`}
              href={PUBLIC_GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            <a
              className={`${styles.navLink} ${styles.navLinkHideMobile}`}
              href={PUBLIC_README_URL}
              target="_blank"
              rel="noreferrer"
            >
              Documentation
            </a>
            <span className={styles.navCta}>
              <GradientButton href={demoHref}>View demo</GradientButton>
            </span>
          </nav>
        </div>
      </header>

      <div className={styles.shell}>
        <section className={styles.hero} aria-labelledby="home-hero-title">
          <ScrollReveal direction="left" className={styles.heroCopy}>
            <p className={styles.eyebrow}>{HOME_HERO_EYEBROW}</p>
            <h1 id="home-hero-title">{HOME_HERO_TITLE}</h1>
            <p className={styles.lede}>{HOME_HERO_LEDE}</p>
            <div className={styles.ctaRow}>
              <GradientButton href={demoHref}>{primaryCtaLabel}</GradientButton>
              <GradientButton href={PUBLIC_GITHUB_REPO_URL} external variant="secondary">
                GitHub
              </GradientButton>
            </div>
            <p className={styles.support}>{HOME_HERO_SUPPORT}</p>
            {latestCampaign ? (
              <p className={styles.hint}>
                Latest import {latestCampaign.importedAtLabel}
                {latestCampaign.filename ? ` · ${latestCampaign.filename}` : ""}.{" "}
                {HOME_LATEST_CAMPAIGN_SUFFIX}
              </p>
            ) : (
              <p className={styles.hint}>{HOME_EMPTY_CAMPAIGN}</p>
            )}
          </ScrollReveal>

          <ScrollReveal direction="right" className={styles.heroVisual} delayMs={80}>
            <div className={styles.visualStage}>
              <div className={styles.primaryShot}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={DEMO_CATALOG_PRODUCTS[0].photoUrl}
                  alt="Demo lifestyle shot of the Lilac Ceramic Vase on a sunlit console"
                />
              </div>
              <div className={styles.secondaryShot}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={DEMO_CATALOG_PRODUCTS[3].photoUrl}
                  alt="Demo lifestyle shot of the Cobalt Glass Table Lamp"
                />
              </div>
              <p className={styles.costChip}>
                Cost preview <span>· {PER_PRODUCT_COST}</span>
              </p>
              <div
                className={styles.reviewCard}
                role="group"
                aria-label="Slack-style review preview"
              >
                <p className={styles.reviewBrand}>Studio Shots · Slack</p>
                <p className={styles.reviewTitle}>SS-001 · candidate 1/3</p>
                <p className={styles.reviewMeta}>Review this candidate independently.</p>
                <div className={styles.reviewActions} aria-hidden="true">
                  <span className={styles.approve}>Approve</span>
                  <span className={styles.reject}>Reject</span>
                </div>
              </div>
            </div>
          </ScrollReveal>
        </section>

        <section className={styles.trust} aria-label="Product values">
          <ScrollReveal direction="up" delayMs={0} className={styles.trustItem}>
            <strong>Cost preview before generation</strong>
            <span>See estimated spend before any paid Luma run.</span>
          </ScrollReveal>
          <ScrollReveal direction="up" delayMs={70} className={styles.trustItem}>
            <strong>Review directly in Slack</strong>
            <span>Approve or reject candidates in the same channel.</span>
          </ScrollReveal>
          <ScrollReveal direction="up" delayMs={140} className={styles.trustItem}>
            <strong>Approved assets in one place</strong>
            <span>Final images land on shared product pages.</span>
          </ScrollReveal>
        </section>

        <section className={styles.section} aria-labelledby="steps-heading">
          <div className={styles.sectionHead}>
            <h2 id="steps-heading">From catalog to approved shot</h2>
            <p>{HOME_STEPS_INTRO}</p>
          </div>
          <ol className={styles.steps}>
            <ScrollReveal as="li" direction="up" delayMs={0} className={styles.step}>
              <div className={styles.stepFigure} aria-hidden="true">
                <div className={styles.stepMock}>
                  <div className={`${styles.mockLine} ${styles.mockLineWide}`} />
                  <div className={`${styles.mockLine} ${styles.mockLineMid}`} />
                  <div className={`${styles.mockLine} ${styles.mockLineShort}`} />
                  <div className={styles.mockChipRow}>
                    <div className={styles.mockChip} />
                    <div className={`${styles.mockChip} ${styles.mockChipAccent}`} />
                  </div>
                </div>
              </div>
              <div className={styles.stepBody}>
                <strong>{HOME_STEPS[0].title}</strong>
                <span>{HOME_STEPS[0].body}</span>
              </div>
            </ScrollReveal>
            <ScrollReveal as="li" direction="up" delayMs={70} className={styles.step}>
              <div className={styles.stepFigure} aria-hidden="true">
                <div className={styles.stepMock}>
                  <div className={`${styles.mockLine} ${styles.mockLineMid}`} />
                  <div className={styles.mockChipRow}>
                    <div className={`${styles.mockChip} ${styles.mockChipAccent}`} />
                    <div className={styles.mockChip} />
                    <div className={styles.mockChip} />
                  </div>
                  <div className={`${styles.mockLine} ${styles.mockLineShort}`} />
                </div>
              </div>
              <div className={styles.stepBody}>
                <strong>{HOME_STEPS[1].title}</strong>
                <span>{HOME_STEPS[1].body}</span>
              </div>
            </ScrollReveal>
            <ScrollReveal as="li" direction="up" delayMs={140} className={styles.step}>
              <div className={styles.stepFigure} aria-hidden="true">
                <div className={styles.stepMock}>
                  <div className={styles.mockThumbRow}>
                    <div className={styles.mockThumb} />
                    <div className={`${styles.mockThumb} ${styles.mockThumbApproved}`} />
                    <div className={styles.mockThumb} />
                  </div>
                </div>
              </div>
              <div className={styles.stepBody}>
                <strong>{HOME_STEPS[2].title}</strong>
                <span>{HOME_STEPS[2].body}</span>
              </div>
            </ScrollReveal>
            <ScrollReveal as="li" direction="up" delayMs={210} className={styles.step}>
              <div className={styles.stepFigure} aria-hidden="true">
                <div className={styles.stepMock}>
                  <div className={styles.mockThumbRow}>
                    <div className={`${styles.mockThumb} ${styles.mockThumbApproved}`} />
                    <div className={`${styles.mockThumb} ${styles.mockThumbApproved}`} />
                    <div className={styles.mockChip} />
                  </div>
                </div>
              </div>
              <div className={styles.stepBody}>
                <strong>{HOME_STEPS[3].title}</strong>
                <span>{HOME_STEPS[3].body}</span>
              </div>
            </ScrollReveal>
          </ol>
        </section>

        <section className={styles.section} aria-labelledby="chat-first-heading">
          <div className={styles.split}>
            <ScrollReveal direction="left" className={styles.sectionHead}>
              <h2 id="chat-first-heading">{HOME_CHAT_FIRST_TITLE}</h2>
              <p>{HOME_CHAT_FIRST_BODY}</p>
            </ScrollReveal>
            <ScrollReveal
              direction="right"
              delayMs={90}
              className={styles.slackPreview}
              aria-label="Slack workflow preview"
            >
              <div className={styles.slackHeader}>
                <span className={styles.slackDot} aria-hidden="true" />
                <strong>#studio-shots</strong>
                <span>campaign channel</span>
              </div>
              <div className={styles.slackBody}>
                <div className={styles.slackMessage}>
                  <small>Studio Shots · just now</small>
                  <p>
                    📸 Catalog ready. {DEMO_CATALOG_PRODUCTS.length} products ready to generate.
                    Estimated cost shown before you start.
                  </p>
                </div>
                <div className={styles.slackCandidate}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={DEMO_CATALOG_PRODUCTS[0].photoUrl} alt="" />
                  <div>
                    <p>
                      <strong>SS-001</strong> · candidate 2/3
                    </p>
                    <p className={styles.reviewMeta}>Approve or reject in Slack.</p>
                    <div className={styles.slackCandidateActions} aria-hidden="true">
                      <span>Approve</span>
                      <span>Reject</span>
                    </div>
                  </div>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="campaign-heading">
          <div className={styles.split}>
            <ScrollReveal direction="left" className={styles.campaignPanel}>
              <h2 id="campaign-heading" className={styles.panelTitle}>
                Campaign overview
              </h2>
              <ul className={styles.campaignMetrics}>
                <li>
                  <span>Products in catalog</span>
                  <strong>{productCount}</strong>
                </li>
                <li>
                  <span>Actionable products</span>
                  <strong>{actionableCount}</strong>
                </li>
                <li>
                  <span>Approved assets</span>
                  <strong>Product pages</strong>
                </li>
                <li>
                  <span>Estimated spend</span>
                  <strong>{estimatedSpendLabel}</strong>
                </li>
              </ul>
              <p className={styles.campaignNote}>
                Slack is the workflow. This companion view is the shared, read-only record.
              </p>
              <GradientButton href={demoHref} variant="secondary">
                {latestCampaign ? "Open campaign overview" : "Browse demo product"}
              </GradientButton>
            </ScrollReveal>
            <ScrollReveal direction="right" delayMs={90} className={styles.sectionHead}>
              <h2>{HOME_CAMPAIGN_SECTION_TITLE}</h2>
              <p>{HOME_CAMPAIGN_SECTION_BODY}</p>
              {latestCampaign ? (
                <p className={styles.hint}>
                  Live import {latestCampaign.importedAtLabel}
                  {latestCampaign.filename ? ` · ${latestCampaign.filename}` : ""}.
                </p>
              ) : (
                <p className={styles.hint}>
                  Metrics use the shipped demo catalog until you import a campaign in Slack.
                </p>
              )}
            </ScrollReveal>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="demo-heading">
          <div className={styles.sectionHead}>
            <h2 id="demo-heading">Demo catalog</h2>
            <p>
              Four synthetic products shipped with Studio Shots for local demos and screenshots.
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
                  photoAlt={`${product.productName} demo photograph`}
                  meta={<p>Priority: {product.priority}</p>}
                />
              </li>
            ))}
          </ProductCardGrid>
        </section>

        <ScrollReveal
          as="section"
          direction="up"
          className={styles.finalCta}
          aria-labelledby="final-cta-heading"
        >
          <h2 id="final-cta-heading">{HOME_FINAL_CTA_TITLE}</h2>
          <p>{HOME_FINAL_CTA_BODY}</p>
          <div className={styles.ctaRow}>
            <GradientButton href={demoHref}>{primaryCtaLabel}</GradientButton>
            <GradientButton href={PUBLIC_GITHUB_REPO_URL} external variant="secondary">
              View on GitHub
            </GradientButton>
            <GradientButton href={PUBLIC_ARCHITECTURE_URL} external variant="secondary">
              Architecture
            </GradientButton>
          </div>
        </ScrollReveal>
      </div>
    </main>
  );
}
