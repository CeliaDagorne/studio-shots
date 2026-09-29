import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProductCard, ProductCardGrid } from "@/components/product-card";
import { getCampaignPageData } from "@/lib/campaigns";
import {
  CAMPAIGN_METRICS_INTRO,
  CAMPAIGN_PAGE_LEDE_SUFFIX,
} from "@/lib/website-copy";

import styles from "./campaign.module.css";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ importId: string }>;
};

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const data = await getCampaignPageData(params.importId);
  if (!data) {
    return { title: "Campaign not found · Studio Shots" };
  }
  return {
    title: `Campaign · Studio Shots`,
    description: `Campaign overview imported ${data.importedAtLabel}`,
  };
}

export default async function CampaignPage(props: PageProps) {
  const params = await props.params;
  const data = await getCampaignPageData(params.importId);
  if (!data) {
    notFound();
  }

  const { totals } = data;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark}>Studio Shots</span>
          <span className={styles.brandHint}>campaign overview</span>
        </Link>

        <header className={styles.hero}>
          <p className={styles.eyebrow}>Campaign</p>
          <h1>Import overview</h1>
          <p className={styles.lede}>
            Imported {data.importedAtLabel}
            {data.filename ? ` from ${data.filename}` : ""}.{" "}
            {CAMPAIGN_PAGE_LEDE_SUFFIX}
          </p>
        </header>

        <section className={styles.section} aria-labelledby="metrics-heading">
          <div className={styles.sectionHead}>
            <h2 id="metrics-heading">Campaign totals</h2>
            <p>{CAMPAIGN_METRICS_INTRO}</p>
          </div>
          <dl className={styles.metrics}>
            <div>
              <dt>Total products</dt>
              <dd>{totals.totalProducts}</dd>
            </div>
            <div>
              <dt>Actionable</dt>
              <dd>{totals.actionableProducts}</dd>
            </div>
            <div>
              <dt>Generating</dt>
              <dd>{totals.generating}</dd>
            </div>
            <div>
              <dt>Awaiting review</dt>
              <dd>{totals.awaitingReview}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>{totals.completed}</dd>
            </div>
            <div>
              <dt>Needs regeneration</dt>
              <dd>{totals.needsRegeneration}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{totals.failed}</dd>
            </div>
            <div>
              <dt>Candidates generated</dt>
              <dd>{totals.candidatesGenerated}</dd>
            </div>
            <div>
              <dt>Images approved</dt>
              <dd>{totals.imagesApproved}</dd>
            </div>
            <div>
              <dt>Estimated spend</dt>
              <dd>{totals.estimatedSpendLabel}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.section} aria-labelledby="products-heading">
          <div className={styles.sectionHead}>
            <h2 id="products-heading">Products</h2>
            <p>
              Source photos, priority, shot ideas, and workflow status for this
              import.
            </p>
          </div>

          {data.products.length === 0 ? (
            <p className={styles.empty}>
              This campaign has no product shot requests yet. Re-import a
              catalog with Shot Idea values to populate the grid.
            </p>
          ) : (
            <ProductCardGrid>
              {data.products.map((product) => (
                <li key={product.sku}>
                  <ProductCard
                    href={product.productPagePath}
                    sku={product.sku}
                    productName={product.productName}
                    photoUrl={product.photoUrl}
                    photoAlt={product.productName}
                    meta={
                      <>
                        <p>Priority: {product.priority ?? "unspecified"}</p>
                        <p>Status: {product.workflowStatusLabel}</p>
                        <p
                          style={{
                            color: "var(--text-subtle)",
                            margin: ".2rem 0 .5rem",
                            fontStyle: "italic",
                          }}
                        >
                          “{product.shotIdea}”
                        </p>
                        <p>Approved images: {product.approvedImageCount}</p>
                      </>
                    }
                  />
                </li>
              ))}
            </ProductCardGrid>
          )}
        </section>
      </div>
    </main>
  );
}
