import { requirePageAccess } from "@/lib/page-access";
import { loadPurchasing } from "@/lib/purchasing-queries";
import { PC_VIEWS } from "@/lib/purchasing-domain";
import PurchasingWorkbench from "@/components/purchasing/PurchasingWorkbench";
import "./purchases.css";
export const dynamic = "force-dynamic";
export default async function PurchasesPage({
  searchParams,
}: {
  searchParams?: { view?: string; record?: string };
}) {
  const user = await requirePageAccess("/workspace/purchases");
  const view = PC_VIEWS.some((v) => v.id === searchParams?.view)
    ? searchParams!.view!
    : "all";
  const data = await loadPurchasing({ view }, user);
  return (
    <PurchasingWorkbench
      user={user}
      initialData={data}
      initialView={view}
      initialRecord={searchParams?.record || ""}
    />
  );
}
