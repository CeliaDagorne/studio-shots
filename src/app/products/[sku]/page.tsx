import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { GradientButton } from "@/components/gradient-button";
import { SiteHeader } from "@/components/site-header";
import {
  formatPriceCents,
  getProductPageData,
  readCampaignImportId,
} from "@/lib/products";
import {
  PRODUCT_APPROVED_DESCRIPTION,
  PRODUCT_APPROVED_HEADING,
  PRODUCT_EMPTY_APPROVED_BODY,
  PRODUCT_EMPTY_APPROVED_TITLE,
} from "@/lib/website-copy";

import styles from "./product.module.css";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ sku: string }>;
  searchParams: Promise<{ campaign?: string | string[] }>;
};

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const data = await getProductPageData(params.sku);
  if (!data) {
    return { title: "Product not found · Studio Shots" };
  }
  return {
    title: `${data.productName} · Studio Shots`,
    description: `Approved photography for ${data.productName} (${data.sku})`,
  };
}

export default async function ProductPage(props: PageProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const data = await getProductPageData(params.sku, {
    campaignImportId: readCampaignImportId(searchParams.campaign),
  });
  if (!data) {
    notFound();
  }

  const hasApproved = data.approvedCandidates.length > 0;
  const historyLabel =
    data.generationAttemptCount === 1
      ? "View generation history (1 attempt)"
      : `View generation history (${data.generationAttemptCount} attempts)`;

  return (
    <main className={styles.page}>
      <SiteHeader hint="styled catalog" />
      <div className={styles.shell}>
        <section className={styles.hero} aria-label="Product overview">
          <div className={styles.heroMedia}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.photoUrl}
              alt={`${data.productName} source catalog photo`}
            />
          </div>

          <div className={styles.heroCopy}>
            <p className={styles.sku}>{data.sku}</p>
            <h1 className={styles.title}>{data.productName}</h1>
            <p className={styles.price}>{formatPriceCents(data.priceCents)}</p>
            <ul className={styles.meta}>
              <li>{data.category}</li>
              <li>{data.colorOrFinish}</li>
              <li>{data.material}</li>
            </ul>
            {data.shotIdea ? (
              <p className={styles.shotIdea}>
                <span className={styles.detailLabel}>Shot Idea</span>
                {data.shotIdea}
              </p>
            ) : null}
            {data.workflowStatusLabel ? (
              <p className={styles.status}>
                <span className={styles.detailLabel}>Status</span>
                {data.workflowStatusLabel}
              </p>
            ) : null}
            {data.campaignPagePath ? (
              <div className={styles.actions}>
                <GradientButton href={data.campaignPagePath}>
                  Back to campaign
                </GradientButton>
              </div>
            ) : null}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="approved-heading">
          <div className={styles.sectionHead}>
            <h2 id="approved-heading">{PRODUCT_APPROVED_HEADING}</h2>
            <p>{PRODUCT_APPROVED_DESCRIPTION}</p>
          </div>

          {hasApproved ? (
            <div className={styles.gallery} aria-labelledby="approved-heading">
              {data.approvedCandidates.map((candidate) => (
                <figure key={candidate.id} className={styles.figure}>
                  <div className={styles.figureFrame}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={candidate.blobUrl}
                      alt={`${data.productName} approved image ${candidate.displayIndex}`}
                    />
                  </div>
                  <figcaption className={styles.figureCaption}>
                    <span>
                      Candidate {candidate.displayIndex}/{candidate.totalInAttempt}
                      {data.generationAttemptCount > 1
                        ? ` · Attempt ${candidate.attemptNumber}`
                        : ""}
                    </span>
                    <a
                      className={styles.download}
                      href={candidate.blobUrl}
                      download={`${data.sku}-approved-${candidate.attemptNumber}-${candidate.displayIndex}.jpg`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Download
                    </a>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>{PRODUCT_EMPTY_APPROVED_TITLE}</p>
              <p>{PRODUCT_EMPTY_APPROVED_BODY}</p>
            </div>
          )}
        </section>

        {data.historyPagePath && data.generationAttemptCount > 0 ? (
          <div className={styles.historyAction}>
            <Link href={data.historyPagePath} className={styles.secondaryButton}>
              {historyLabel}
            </Link>
          </div>
        ) : null}

        <section className={styles.section} aria-labelledby="original-heading">
          <div className={styles.sectionHead}>
            <h2 id="original-heading">Original catalog photo</h2>
            <p>White-background catalog photo used as the generation source.</p>
          </div>
          <div className={styles.original}>
            <div className={styles.originalFrame}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.photoUrl} alt={`${data.productName} original catalog photo`} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
