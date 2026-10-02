import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { GradientButton } from "@/components/gradient-button";
import {
  getProductHistoryPageData,
  readCampaignImportId,
} from "@/lib/products";
import {
  PRODUCT_HISTORY_TITLE,
  productHistoryDescription,
} from "@/lib/website-copy";

import styles from "../product.module.css";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ sku: string }>;
  searchParams: Promise<{ campaign?: string | string[] }>;
};

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const data = await getProductHistoryPageData(params.sku);
  if (!data) {
    return { title: "Product not found · Studio Shots" };
  }
  return {
    title: `${PRODUCT_HISTORY_TITLE} · ${data.sku} · Studio Shots`,
    description: productHistoryDescription(data.sku),
  };
}

export default async function ProductHistoryPage(props: PageProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const data = await getProductHistoryPageData(params.sku, {
    campaignImportId: readCampaignImportId(searchParams.campaign),
  });
  if (!data) {
    notFound();
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark}>Studio Shots</span>
          <span className={styles.brandHint}>generation history</span>
        </Link>

        <header className={styles.historyHero}>
          <p className={styles.sku}>{data.sku}</p>
          <h1 className={styles.historyTitle}>{PRODUCT_HISTORY_TITLE}</h1>
          <p className={styles.historyLede}>{productHistoryDescription(data.sku)}</p>
          <div className={styles.actions}>
            <GradientButton href={data.productPagePath}>Back to product</GradientButton>
            {data.campaignPagePath ? (
              <Link href={data.campaignPagePath} className={styles.secondaryButton}>
                Campaign overview
              </Link>
            ) : null}
          </div>
        </header>

        {data.attempts.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No generation attempts yet</p>
            <p>Start a generation for this SKU in Slack to build history here.</p>
          </div>
        ) : (
          data.attempts.map((attempt) => (
            <section
              key={attempt.id}
              className={styles.attemptSection}
              aria-labelledby={`attempt-${attempt.id}`}
            >
              <div className={styles.sectionHead}>
                <h2 id={`attempt-${attempt.id}`}>{attempt.label}</h2>
                <p>{attempt.createdAtLabel}</p>
              </div>

              <dl className={styles.attemptMeta}>
                <div>
                  <dt>Provider</dt>
                  <dd>{attempt.environmentLabel}</dd>
                </div>
                <div>
                  <dt>Shot Idea</dt>
                  <dd>{attempt.shotIdea}</dd>
                </div>
                <div>
                  <dt>Aspect ratio</dt>
                  <dd>{attempt.aspectRatio}</dd>
                </div>
                <div>
                  <dt>Cost</dt>
                  <dd>{attempt.costLabel}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{attempt.statusLabel}</dd>
                </div>
              </dl>

              <div className={styles.gallery}>
                {attempt.candidates.map((candidate) => (
                  <figure key={candidate.id} className={styles.figure}>
                    <div className={styles.figureFrame}>
                      {candidate.blobUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={candidate.blobUrl}
                          alt={`${data.sku} ${attempt.label} candidate ${candidate.displayIndex}`}
                        />
                      ) : (
                        <div className={styles.missingFrame}>
                          No image
                          {candidate.errorMessage ? ` · ${candidate.errorMessage}` : ""}
                        </div>
                      )}
                    </div>
                    <figcaption className={styles.figureCaption}>
                      <span>
                        Candidate {candidate.displayIndex}/{candidate.totalInAttempt}
                        {" · "}
                        {candidate.reviewDecisionLabel}
                        {candidate.status === "failed" ? " · Failed" : ""}
                      </span>
                      {candidate.blobUrl ? (
                        <a
                          className={styles.download}
                          href={candidate.blobUrl}
                          download={`${data.sku}-${attempt.isLegacy ? "legacy" : `attempt-${attempt.attemptNumber}`}-candidate-${candidate.displayIndex}.jpg`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Download
                        </a>
                      ) : null}
                    </figcaption>
                    {candidate.errorMessage ? (
                      <p className={styles.errorNote}>{candidate.errorMessage}</p>
                    ) : null}
                  </figure>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </main>
  );
}
