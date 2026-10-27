import { Audience } from "~/components/landing/audience";
import { Bento } from "~/components/landing/bento";
import { Domain } from "~/components/landing/domain";
import { Faq } from "~/components/landing/faq";
import { FinalCta, Footer } from "~/components/landing/footer";
import { Header } from "~/components/landing/header";
import { Hero } from "~/components/landing/hero";
import { Pricing } from "~/components/landing/pricing";
import { Section } from "~/components/landing/primitives";
import { Scheduling } from "~/components/landing/scheduling";
import { Steps } from "~/components/landing/steps";
import { site } from "~/lib/site";

export default function HomePage() {
  const { links } = site;
  return (
    <>
      <Header links={links} />
      <main>
        <Hero links={links} />
        <Audience />
        <Scheduling links={links} />
        <Bento />
        <Domain />
        <Steps />
        <Section id="pricing">
          <Pricing signupUrl={links.signup} />
        </Section>
        <Faq />
        <FinalCta links={links} />
      </main>
      <Footer links={links} />
    </>
  );
}
