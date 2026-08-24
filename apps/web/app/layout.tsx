import type { Metadata } from "next";
import "@tanys/design-tokens/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "tanys — video editor",
  description: "Video editor browser-based, GPU lato client",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
