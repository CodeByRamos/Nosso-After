import { Notice, PageHeader } from "./ui";

/** Honest placeholder for modules scheduled for phase 2 — no fake data. */
export function PhaseTwo({ title, description, items }: { title: string; description: string; items: string[] }) {
  return (
    <div className="max-w-2xl">
      <PageHeader title={title} />
      <Notice tone="info">
        <p className="font-semibold">Módulo planejado para a Fase 2.</p>
        <p className="mt-1">{description}</p>
        <ul className="mt-2 list-disc pl-5">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </Notice>
    </div>
  );
}
