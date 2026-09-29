import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./product-card.module.css";

export type ProductCardProps = {
  href: string;
  sku: string;
  productName: string;
  photoUrl: string;
  photoAlt?: string;
  /** Secondary lines under the title (priority, status, etc.). */
  meta?: ReactNode;
};

export function ProductCard({
  href,
  sku,
  productName,
  photoUrl,
  photoAlt = "",
  meta,
}: ProductCardProps) {
  return (
    <Link href={href} className={styles.card}>
      <div className={styles.media}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} alt={photoAlt} />
      </div>
      <div className={styles.copy}>
        <p className={styles.sku}>{sku}</p>
        <h3>{productName}</h3>
        {meta ? <div className={styles.meta}>{meta}</div> : null}
      </div>
    </Link>
  );
}

export function ProductCardGrid({ children }: { children: ReactNode }) {
  return <ul className={styles.grid}>{children}</ul>;
}
