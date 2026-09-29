import type { Metadata } from "next";

export const metadata: Metadata = { title: "Política de privacidade" };

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-5 px-4 py-12 leading-relaxed text-sand-2">
      <h1 className="display text-5xl text-sand">Privacidade</h1>
      <p className="rounded-xl border border-warn/60 p-3 text-sm text-warn">
        Rascunho técnico. O texto final precisa ser revisado pelo jurídico antes da produção, com o controlador e o
        encarregado (DPO) identificados.
      </p>
      <h2 className="text-xl font-semibold text-sand">Quais dados coletamos e por quê</h2>
      <ul className="list-disc space-y-2 pl-5">
        <li><strong>Compra:</strong> nome, e-mail e celular, para emitir e entregar ingressos e dar suporte (execução de contrato).</li>
        <li><strong>CPF (opcional):</strong> repassado ao processador de pagamento para identificar o pagador, quando exigido.</li>
        <li><strong>Pagamento:</strong> dados de cartão são digitados no formulário seguro do processador (Mercado Pago). Não recebemos nem armazenamos número, validade ou CVV. Guardamos só bandeira e 4 últimos dígitos.</li>
        <li><strong>Operação:</strong> registros de acesso (IP, horário) para segurança e prevenção a fraude (legítimo interesse).</li>
        <li><strong>Comunicação:</strong> novidades só com o seu consentimento, revogável a qualquer momento.</li>
      </ul>
      <h2 className="text-xl font-semibold text-sand">Retenção</h2>
      <p>
        Dados de pedidos e pagamentos ficam guardados pelo prazo exigido pela legislação fiscal e para atender
        contestações (chargebacks). Depois disso, os dados pessoais são anonimizados. O IP dos pedidos é descartado em até
        180 dias. Detalhes em DATABASE.md (política de retenção).
      </p>
      <h2 className="text-xl font-semibold text-sand">Seus direitos (LGPD, art. 18)</h2>
      <p>
        Você pode pedir confirmação, acesso, correção, portabilidade e exclusão dos seus dados, quando legalmente
        aplicável, pelo e-mail de contato. Pedidos de exclusão respeitam as obrigações legais de guarda.
      </p>
      <h2 className="text-xl font-semibold text-sand">Compartilhamento</h2>
      <p>Com o processador de pagamento (para cobrar) e com provedores de infraestrutura (hospedagem, e-mail), só no necessário.</p>
    </article>
  );
}
