import Link from "next/link";
import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/theme-toggle";

import styles from "./site-header.module.css";

type SiteHeaderProps = {
  /** Optional trailing nav content (links / CTAs) before the theme toggle. */
  nav?: ReactNode;
  /** Compact subtitle shown beside the brand on inner pages. */
  hint?: string;
};

export const SiteHeader = ({ nav, hint }: SiteHeaderProps) => (
  <header className={styles.header}>
    <div className={styles.inner}>
      <Link className={styles.brand} href="/">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.brandLogo}
          src="/brand/studio-shots-logo.png"
          alt=""
          width={34}
          height={34}
        />
        <span className={styles.brandName}>Studio Shots</span>
        {hint ? <span className={styles.brandHint}>{hint}</span> : null}
      </Link>
      <div className={styles.actions}>
        {nav ? <nav className={styles.nav} aria-label="Primary">{nav}</nav> : null}
        <ThemeToggle />
      </div>
    </div>
  </header>
);
