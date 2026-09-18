/** A titled, collapsible-looking group used to structure the sidebar. */
import type { ReactNode } from "react";

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <header className="section-head">
        <h2>{title}</h2>
        {action}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}
