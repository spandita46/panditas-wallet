import type { ReactNode } from "react";

export function SectionHeader({
  children,
  right,
  className = "",
}: {
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-3 flex items-center justify-between gap-3 ${className}`}>
      <h2 className="section-header">{children}</h2>
      {right}
    </div>
  );
}
