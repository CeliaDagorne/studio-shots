import Link from "next/link";

import styles from "./not-found.module.css";

export default function CampaignNotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <p className={styles.eyebrow}>Studio Shots</p>
        <h1>Campaign not found</h1>
        <p>
          That campaign overview does not exist, or the import id is invalid. Import a catalog in
          Slack and mention @Studio Shots with <code>import</code> to create a campaign, or return
          home.
        </p>
        <p className={styles.actions}>
          <Link href="/">Back to homepage</Link>
        </p>
      </div>
    </main>
  );
}
