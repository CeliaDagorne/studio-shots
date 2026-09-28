import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCampaignPageData } from "@/lib/campaigns";

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
            {data.filename ? ` from ${data.filename}` : ""}. This page is read-only—generate and
            review products in Telegram.
          </p>
        </header>

        <section className={styles.section} aria-labelledby="metrics-heading">
          <div className={styles.sectionHead}>
            <h2 id="metrics-heading">Campaign totals</h2>
            <p>Live rollup from the same status rules used in Telegram /status.</p>
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
            <p>Source photos, priority, shot ideas, and workflow status for this import.</p>
          </div>

          {data.products.length === 0 ? (
            <p className={styles.empty}>
              This campaign has no product shot requests yet. Re-import a catalog with Shot Idea
              values to populate the grid.
            </p>
          ) : (
            <ul className={styles.grid}>
              {data.products.map((product) => (
                <li key={product.sku} className={styles.card}>
                  <div className={styles.cardMedia}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={product.photoUrl} alt={product.productName} />
                  </div>
                  <div className={styles.cardBody}>
                    <p className={styles.sku}>{product.sku}</p>
                    <h3>{product.productName}</h3>
                    <p className={styles.priority}>
                      Priority: {product.priority ?? "unspecified"}
                    </p>
                    <p className={styles.shotIdea}>{product.shotIdea}</p>
                    <p className={styles.status}>
                      Status: {product.workflowStatusLabel}
                    </p>
                    <p className={styles.approved}>
                      Approved images: {product.approvedImageCount}
                    </p>
                    <Link href={product.productPagePath}>Open product page</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
