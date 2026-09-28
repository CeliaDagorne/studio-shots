import Link from "next/link";

import styles from "./home.module.css";

export default function HomePage() {
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <p className={styles.eyebrow}>Studio Shots</p>
        <h1>Styled shots, approved in chat</h1>
        <p>
          Import a product catalog CSV in Telegram with caption <code>/import</code>. Studio Shots
          generates lifestyle candidates for one selected product at a time so spend stays
          controlled. A reviewer approves or rejects each candidate in chat. Approved images land
          on public product pages for the e-commerce team to download.
        </p>
        <p>
          Campaign managers can check progress and estimated generation spend anytime with{" "}
          <code>/status</code>.
        </p>
        <p className={styles.example}>
          Example:{" "}
          <Link href="/products/SS-001">Lilac Ceramic Vase (SS-001)</Link>
        </p>
      </div>
    </main>
  );
}
