import type { Metadata } from "next";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/dm-serif-display/400.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./truthgraph.css";

export const metadata: Metadata = {
  title: "TruthGraph | Which answer applies?",
  description: "Question-first evidence investigations with source provenance, applicability, corrections, and visible conflicts through Sanity Context.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body><a className="tg-skip-link" href="#main">Skip to content</a>{children}</body>
    </html>
  );
}
