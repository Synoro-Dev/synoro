import { CreatePracticeForm, PracticeList } from "~/components/booking";
import { SiteHeader } from "~/components/layout";

export default function PracticesPage() {
  return (
    <>
      <SiteHeader title="Практики" />
      <div className="flex max-w-5xl flex-col gap-6 p-4 lg:p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Мои практики</h1>
          <p className="text-muted-foreground">
            Практики, которые вы ведёте как специалист или администратор, и те,
            где вы записываетесь как клиент.
          </p>
        </div>
        <PracticeList />
        <div className="max-w-xl">
          <CreatePracticeForm />
        </div>
      </div>
    </>
  );
}
