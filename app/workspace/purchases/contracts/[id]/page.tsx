import { requirePageAccess } from "@/lib/page-access";
import { purchasingContract } from "@/lib/purchasing-queries";
import "../contract.css";
import PurchaseContract from "@/components/purchasing/PurchaseContract";
export const dynamic = "force-dynamic";
export default async function ContractPage({
  params,
}: {
  params: { id: string };
}) {
  await requirePageAccess("/workspace/purchases");
  const contract = await purchasingContract(params.id);
  return <PurchaseContract contract={contract} />;
}
