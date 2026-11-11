import type { Metadata } from "next";

import { JsonLd } from "~/components/json-ld";
import { Audience } from "~/components/landing/audience";
import { Author } from "~/components/landing/author";
import { Bento } from "~/components/landing/bento";
import { Domain } from "~/components/landing/domain";
import { Embed } from "~/components/landing/embed";
import { Faq } from "~/components/landing/faq";
import { FinalCta, Footer } from "~/components/landing/footer";
import { Header } from "~/components/landing/header";
import { Hero } from "~/components/landing/hero";
import { Pricing } from "~/components/landing/pricing";
import { Section } from "~/components/landing/primitives";
import { Scheduling } from "~/components/landing/scheduling";
import { Steps } from "~/components/landing/steps";
import { StickyCta } from "~/components/landing/sticky-cta";
import { Trust } from "~/components/landing/trust";
import { ScrollReveal } from "~/components/scroll-reveal";
import { homeTitle, openGraph } from "~/lib/seo";
import { site } from "~/lib/site";
import { organization, softwareApplication } from "~/lib/structured-data";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: openGraph({
    title: homeTitle,
    description: site.description,
    url: "/",
    card: "home",
  }),
};

export default function HomePage() {
  const { links } = site;
  return (
    <>
      <JsonLd data={organization} />
      <JsonLd data={softwareApplication} />
      <Header links={links} />
      <main>
        <Hero links={links} />
        <Audience />
        <Scheduling links={links} />
        <Bento />
        <Domain />
        <Embed />
        <Steps />
        <Section id="pricing">
          <Pricing signupUrl={links.signup} />
        </Section>
        <Trust />
        <Author />
        <Faq />
        <FinalCta links={links} />
      </main>
      <Footer links={links} />
      {/* Room for the mobile sticky CTA, so it never covers the footer. */}
      <div aria-hidden className="h-18 md:hidden" />
      <StickyCta signupUrl={links.signup} />
      <ScrollReveal />
    </>
  );
}
