import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./gradient-button.module.css";

export type GradientButtonProps = {
  href: string;
  children: ReactNode;
  /** Open in a new tab (external docs / GitHub). */
  external?: boolean;
  /** Visual style — solid primary or quiet secondary. */
  variant?: "primary" | "secondary";
};

export function GradientButton({
  href,
  children,
  external = false,
  variant = "primary",
}: GradientButtonProps) {
  const className =
    variant === "secondary" ? `${styles.button} ${styles.secondary}` : styles.button;

  if (external) {
    return (
      <a href={href} className={className} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
