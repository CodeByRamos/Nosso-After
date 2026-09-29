import { PhaseTwo } from "@/components/admin/phase-two";
import { adminContext } from "@/server/auth/admin-context";

export const metadata = { title: "Promoters" };

export default async function PromotersPage() {
  await adminContext("events:write");
  return (
    <PhaseTwo
      title="Promoters"
      description="Atribuição por link /r/CODIGO, gravada em cookie httpOnly assinado no servidor (não manipulável pelo frontend)."
      items={["Código e link exclusivo", "Vendas atribuídas por pedido pago", "Comissão configurável", "Papel PROMOTER com acesso só às próprias vendas"]}
    />
  );
}
