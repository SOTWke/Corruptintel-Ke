import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CorruptIntel — Evidence-Backed Corruption Intelligence",
    template: "%s | CorruptIntel",
  },
  description:
    "Follow the money, track the evidence, and expose patterns in public-sector accountability.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fafaf8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <a href="/" className="brand" aria-label="CorruptIntel home">
              Corrupt<span className="brand-accent">Intel</span>
            </a>
            <nav aria-label="Primary navigation">
              <a href="/dashboard">Dashboard</a>
              <a href="/cases">Cases</a>
              <a href="/search">Research</a>
              <a href="/login" className="nav-login">Researcher login</a>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <p>Evidence. Transparency. Accountability.</p>
          <p className="footer-disclaimer">CorruptIntel distinguishes allegations, investigations, charges, court cases, convictions, and proven facts.</p>
        </footer>
      </body>
    </html>
  );
}
