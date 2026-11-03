import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Bento } from "~/components/landing/bento";
import { Domain } from "~/components/landing/domain";
import { Faq } from "~/components/landing/faq";
import { FinalCta, Footer } from "~/components/landing/footer";
import { Header } from "~/components/landing/header";
import { Hero } from "~/components/landing/hero";
import { Pricing } from "~/components/landing/pricing";
import { Section } from "~/components/landing/primitives";
import { ProfessionPoints } from "~/components/landing/profession-points";
import { Scheduling } from "~/components/landing/scheduling";
import { Steps } from "~/components/landing/steps";
import { StickyCta } from "~/components/landing/sticky-cta";
import {
  professionPage,
  professionPages,
  professionPath,
} from "~/lib/professions";
import { site } from "~/lib/site";

export function generateStaticParams() {
  return professionPages.map(({ slug }) => ({ profession: slug }));
}

export async function generateMetadata(
  props: PageProps<"/solutions/[profession]">,
): Promise<Metadata> {
  const page = professionPage((await props.params).profession);
  if (!page) return {};
  const path = professionPath(page);
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: path },
    openGraph: {
      title: page.title,
      description: page.description,
      url: path,
      siteName: site.name,
      locale: "ru_RU",
      type: "website",
    },
  };
}

/**
 * The home page for one profession, in its words: where that profession's
 * Yandex Direct campaign leads (docs/direct-campaigns.md).
 */
export default async function ProfessionLandingPage(
  props: PageProps<"/solutions/[profession]">,
) {
  const page = professionPage((await props.params).profession);
  if (!page) notFound();
  const { links } = site;
  return (
    <>
      <Header links={links} />
      <main>
        <Hero links={links} page={page} />
        <ProfessionPoints page={page} />
        <Scheduling links={links} />
        <Bento />
        <Domain />
        <Steps />
        <Section id="pricing">
          <Pricing signupUrl={links.signup} />
        </Section>
        <Faq first={page.question} />
        <FinalCta links={links} />
      </main>
      <Footer links={links} />
      {/* Room for the mobile sticky CTA, so it never covers the footer. */}
      <div aria-hidden className="h-18 md:hidden" />
      <StickyCta signupUrl={links.signup} />
    </>
  );
}
