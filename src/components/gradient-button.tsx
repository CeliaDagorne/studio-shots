import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./gradient-button.module.css";

export type GradientButtonProps = {
  href: string;
  children: ReactNode;
  /** Open in a new tab (external docs / GitHub). */
  external?: boolean;
};

export function GradientButton({ href, children, external = false }: GradientButtonProps) {
  if (external) {
    return (
      <a
        href={href}
        className={styles.button}
        target="_blank"
        rel="noreferrer"
      >
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={styles.button}>
      {children}
    </Link>
  );
}
