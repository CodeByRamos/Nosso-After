import { PhaseTwo } from "@/components/admin/phase-two";
import { adminContext } from "@/server/auth/admin-context";

export const metadata = { title: "Cupons" };

export default async function CouponsPage() {
  await adminContext("events:write");
  return (
    <PhaseTwo
      title="Cupons"
      description="O schema de pedidos já tem discount_amount e a cotação já separa desconto; falta o cadastro e a validação."
      items={["Percentual ou valor fixo", "Quantidade máxima e limite por comprador", "Validade e lotes/eventos permitidos", "Validação 100% no backend, com contagem atômica de uso"]}
    />
  );
}
