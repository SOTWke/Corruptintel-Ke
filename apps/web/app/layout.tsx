import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CorruptIntel — Evidence-Backed Corruption Intelligence",
  description:
    "Follow the Money. Track the Evidence. Expose the Pattern. An evidence-backed intelligence platform for public-sector accountability.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <a href="/" className="brand">
              Corrupt<span className="brand-accent">Intel</span>
            </a>
            <nav>
              <a href="/dashboard">Dashboard</a>
              <a href="/cases">Cases</a>
              <a href="/search">Search</a>
              <a href="/admin/review-queue">Review Queue</a>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <p>Evidence. Transparency. Accountability.</p>
        </footer>
      </body>
    </html>
  );
}
