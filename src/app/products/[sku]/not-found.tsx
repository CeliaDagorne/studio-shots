import Link from "next/link";

import { PRODUCT_NOT_FOUND_BODY } from "@/lib/website-copy";

import styles from "./not-found.module.css";

export default function ProductNotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <p className={styles.eyebrow}>Studio Shots</p>
        <h1>Product not found</h1>
        <p>{PRODUCT_NOT_FOUND_BODY}</p>
        <Link href="/">Back home</Link>
      </div>
    </main>
  );
}
