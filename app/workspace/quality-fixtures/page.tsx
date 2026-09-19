import { requirePageAccess } from "@/lib/page-access";
import { loadQualityFixtures } from "@/lib/quality-fixture-queries";
import QualityFixtureWorkbench from "@/components/quality-fixtures/QualityFixtureWorkbench";
import "../purchases/purchases.css";
import "./quality-fixtures.css";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams?: Record<string, string> }) {
  const user = await requirePageAccess("/workspace/quality-fixtures");
  const q = new URLSearchParams(searchParams || {});
  const data = await loadQualityFixtures(q, user);
  return <QualityFixtureWorkbench user={user} initialData={data} initialView={q.get("view") || "review"} initialStatus={q.get("status") || ""} initialWeek={q.get("week") || ""} initialQuery={searchParams} />;
}
