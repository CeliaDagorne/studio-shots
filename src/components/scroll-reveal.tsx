"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";

import styles from "./scroll-reveal.module.css";

export type ScrollRevealDirection = "up" | "left" | "right";

export type ScrollRevealProps = {
  children: ReactNode;
  direction?: ScrollRevealDirection;
  delayMs?: number;
  as?: ElementType;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  id?: string;
  role?: string;
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const directionClass: Record<ScrollRevealDirection, string> = {
  up: styles.fromUp,
  left: styles.fromLeft,
  right: styles.fromRight,
};

export function ScrollReveal({
  children,
  direction = "up",
  delayMs = 0,
  as: Tag = "div",
  className,
  id,
  role,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
}: ScrollRevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [armed, setArmed] = useState(false);
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    if (typeof window.matchMedia !== "function") {
      setVisible(true);
      return;
    }

    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
      setVisible(true);
      return;
    }

    setArmed(true);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setVisible(true);
          observer.unobserve(entry.target);
        }
      },
      {
        threshold: 0.16,
        rootMargin: "0px 0px -8% 0px",
      },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  const classNames = [
    styles.reveal,
    directionClass[direction],
    armed ? styles.armed : null,
    visible ? styles.visible : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const style = {
    "--reveal-delay": `${Math.max(0, delayMs)}ms`,
  } as CSSProperties;

  return (
    <Tag
      // Polymorphic ref: ElementType may not accept HTMLElement refs in TS.
      ref={ref as never}
      className={classNames}
      style={style}
      id={id}
      role={role}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
    >
      {children}
    </Tag>
  );
}
