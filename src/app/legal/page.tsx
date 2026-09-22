import type { Metadata } from "next";
import { headers } from "next/headers";
import LegalArticle from "@/app/LegalArticle";
import SiteFooter from "@/app/SiteFooter";
import { pickLocale } from "@/lib/i18n";
import { legalDocs } from "@/lib/legal";
import { legalFacts } from "@/lib/legal-facts";

async function doc() {
  const locale = pickLocale((await headers()).get("accept-language"));
  return { locale, doc: legalDocs(locale, legalFacts()).legal };
}

export async function generateMetadata(): Promise<Metadata> {
  const { doc: d } = await doc();
  return { title: `${d.title} · Booking`, description: d.intro };
}

export default async function Page() {
  const { locale, doc: d } = await doc();
  return (
    <>
      <LegalArticle doc={d} />
      <SiteFooter locale={locale} />
    </>
  );
}
