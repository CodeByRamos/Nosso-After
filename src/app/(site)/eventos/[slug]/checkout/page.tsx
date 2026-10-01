import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckoutFlow } from "@/components/site/checkout-flow";
import { getActiveProvider } from "@/server/payments/registry";
import { getPublicEventBySlug } from "@/server/services/catalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Checkout", robots: { index: false, follow: false } };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ itens?: string }> };

export default async function CheckoutPage({ params, searchParams }: Props) {
  const data = await getPublicEventBySlug((await params).slug);
  if (!data) notFound();
  const raw = (await searchParams).itens ?? "";

  const items = raw
    .split(",")
    .map((p) => p.split(":"))
    .map(([id, n]) => ({ batch: data.batches.find((b) => b.id === id), quantity: Number(n) }))
    .filter((x) => x.batch && x.batch.state === "ON_SALE" && Number.isInteger(x.quantity) && x.quantity > 0)
    .map((x) => ({
      batchId: x.batch!.id,
      label: `${x.batch!.typeName} · ${x.batch!.name}`,
      unitPrice: x.batch!.price,
      quantity: Math.min(x.quantity, x.batch!.maxPerCustomer),
    }));

  if (!data.sale.ok || items.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-fg-2">{data.sale.ok ? "Selecione seus ingressos para continuar." : data.sale.reason}</p>
        <Link href={`/eventos/${data.event.slug}`} className="mt-6 inline-block text-primary underline">
          Voltar ao evento
        </Link>
      </div>
    );
  }

  const provider = getActiveProvider();
  return (
    <CheckoutFlow
      event={{
        id: data.event.id,
        name: data.event.name,
        slug: data.event.slug,
        startsAt: data.event.startsAt.toISOString(),
        accentColor: data.event.accentColor,
      }}
      items={items}
      methods={{ pix: provider.capabilities.pix, card: provider.capabilities.creditCard }}
    />
  );
}
