import type { Metadata } from "next";

export const metadata: Metadata = { title: "Termos de uso" };

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-5 px-4 py-12 leading-relaxed text-fg-2">
      <h1 className="type-headline text-5xl text-fg">Termos de uso</h1>
      <p className="border-l-4 border-warning bg-warning/10 p-3 text-sm text-fg">
        Rascunho técnico. O texto final (CDC, política de cancelamento, meia-entrada, direito de arrependimento) precisa
        ser revisado pelo jurídico antes da produção.
      </p>
      <h2 className="type-headline pt-4 text-2xl text-fg">Compra</h2>
      <p>
        O pedido reserva os ingressos por tempo limitado. Ele só é confirmado depois que o processador de pagamento aprova
        a transação. A taxa de serviço aparece antes da confirmação.
      </p>
      <h2 className="type-headline pt-4 text-2xl text-fg">Ingresso</h2>
      <p>
        Cada ingresso tem um QR Code único que vale para uma entrada. Não compartilhe o QR Code: a primeira leitura
        válida na portaria usa o ingresso.
      </p>
      <h2 className="type-headline pt-4 text-2xl text-fg">Cancelamento e reembolso</h2>
      <p>
        Os reembolsos são feitos pelo mesmo meio de pagamento, pelo processador. Ingressos já utilizados não são
        reembolsáveis. Em caso de cancelamento do evento, o valor total é devolvido.
      </p>
    </article>
  );
}
