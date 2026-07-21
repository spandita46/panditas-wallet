import type { ReactNode } from "react";

export function Card({
  children,
  padded = true,
  className = "",
}: {
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return <div className={`card ${padded ? "card-pad" : ""} ${className}`}>{children}</div>;
}
