import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hydra Supply Co. — Checkout",
  description: "Seeded demo checkout used as Hydra's verification target.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a href="/" className="brand">
            Hydra Supply Co.
          </a>
          <span className="muted small">Demo store · no real payments</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
