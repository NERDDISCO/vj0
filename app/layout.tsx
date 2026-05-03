import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { JetBrains_Mono, Doto } from "next/font/google";
import "./globals.css";
// Patch Studio (the /vj-next route) ships its CSS in a separate file so
// the design layer for the new workspace lives next to its components
// instead of bloating globals.css. Order matters — globals.css first
// (defines tokens like --vj-ink, --vj-edge), then patch-studio.css
// extends those tokens with the vp-* classes.
import "./patch-studio.css";

// Type system for the new "Patch Studio" design (/vj-next):
//  - JetBrains Mono is the body — sharper terminal-glyph feel than Geist Mono,
//    with the disambiguated 0/O/l/1 set that VJ data displays really need.
//  - Doto is a variable dot-matrix display font that's used for major scene
//    titles, drawer headers, and the OUTPUT readouts. It sells the "live
//    hardware LED rack" identity at a glance, which the original UI's
//    plain-mono titles couldn't.
// Both are CSS variable bound so .css and Tailwind can both reach them.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jb-mono",
  display: "swap",
});

const doto = Doto({
  subsets: ["latin"],
  variable: "--font-doto",
  display: "swap",
  weight: ["400", "600", "800", "900"],
});

export const metadata: Metadata = {
  title: "vj0 — live audio-reactive visuals",
  description: "Real-time audio visualization for live visual artists",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning on BOTH <html> and <body>: browser extensions
    // inject attributes on these top-level elements before React hydrates,
    // and there's no way to make the SSR output match. Known offenders:
    //   <html>: Google Analytics Opt-out (data-google-analytics-opt-out),
    //           Dark Reader (data-darkreader-*)
    //   <body>: ColorZilla (cz-shortcut-listen),
    //           Grammarly (data-gr-*, data-new-gr-c-s-*),
    //           various password managers
    // The flag is one-level-deep — only this element's own attributes are
    // exempted, children are still hydration-checked normally.
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} ${jetbrainsMono.variable} ${doto.variable} antialiased`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
