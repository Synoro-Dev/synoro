import { Footer } from "~/components/landing/footer";
import { LegalHeader } from "~/components/legal/header";
import { site } from "~/lib/site";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <LegalHeader links={site.links} />
      {children}
      <Footer links={site.links} />
    </>
  );
}
