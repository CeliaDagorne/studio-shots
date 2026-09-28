import Link from "next/link";

import styles from "./not-found.module.css";

export default function ProductNotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <p className={styles.eyebrow}>Studio Shots</p>
        <h1>Product not found</h1>
        <p>
          That SKU is not in the imported catalog yet. Import the CSV in Telegram, then open the
          product page again.
        </p>
        <Link href="/">Back home</Link>
      </div>
    </main>
  );
}
