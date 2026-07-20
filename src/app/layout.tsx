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

export const metadata: Metadata = {
  title: "Booking",
  description: "Simple meeting scheduling",
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
