import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatPriceCents, getProductPageData } from "@/lib/products";

import styles from "./product.module.css";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ sku: string }>;
};

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const data = await getProductPageData(params.sku);
  if (!data) {
    return { title: "Product not found · Studio Shots" };
  }
  return {
    title: `${data.productName} · Studio Shots`,
    description: `Styled photography for ${data.productName} (${data.sku})`,
  };
}

export default async function ProductPage(props: PageProps) {
  const params = await props.params;
  const data = await getProductPageData(params.sku);
  if (!data) {
    notFound();
  }

  const heroImage = data.approvedCandidates[0]?.blobUrl ?? data.photoUrl;
  const hasApproved = data.approvedCandidates.length > 0;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark}>Studio Shots</span>
          <span className={styles.brandHint}>styled catalog</span>
        </Link>

        <section className={styles.hero} aria-label="Product overview">
          <div className={styles.heroMedia}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={heroImage}
              alt={
                hasApproved
                  ? `${data.productName} styled shot`
                  : `${data.productName} catalog photo`
              }
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
          </div>
        </section>

        <section className={styles.section} aria-labelledby="styled-heading">
          <div className={styles.sectionHead}>
            <h2 id="styled-heading">Approved styled shots</h2>
            <p>
              Reviewer-approved lifestyle images for product pages, social, and campaigns.
              Rejected candidates stay out of this gallery. The e-commerce team can download each
              approved file below.
            </p>
          </div>

          {hasApproved ? (
            <div className={styles.gallery}>
              {data.approvedCandidates.map((candidate) => (
                <figure key={candidate.id} className={styles.figure}>
                  <div className={styles.figureFrame}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={candidate.blobUrl}
                      alt={`${data.productName} approved candidate ${candidate.candidateIndex}`}
                    />
                  </div>
                  <figcaption className={styles.figureCaption}>
                    <span>Shot {candidate.candidateIndex}</span>
                    <a
                      className={styles.download}
                      href={candidate.blobUrl}
                      download={`${data.sku}-approved-${candidate.candidateIndex}.jpg`}
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
            <p className={styles.empty}>
              No approved styled shots yet for {data.sku}. Once a reviewer approves candidates in
              Telegram, they will appear here automatically.
            </p>
          )}
        </section>

        <section className={styles.section} aria-labelledby="original-heading">
          <div className={styles.sectionHead}>
            <h2 id="original-heading">Original catalog photo</h2>
            <p>White-background source used as the generation reference.</p>
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
