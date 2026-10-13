import type { Metadata } from "next";
import { headers } from "next/headers";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { pickLocale } from "@/lib/i18n";
import "./globals.css";

const grotesk = Space_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const APP_URL = process.env.APP_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Booking — PacketFence meeting scheduling",
    template: "%s · Booking",
  },
  description:
    "Book meetings with the PacketFence team: pick a time that fits both calendars, get a confirmed invite with a join link. No account needed.",
  openGraph: {
    siteName: "Booking",
    type: "website",
    locale: "en_US",
  },
  robots: { index: true, follow: true },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = pickLocale((await headers()).get("accept-language"));
  return (
    <html
      lang={locale}
      className={`${grotesk.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
