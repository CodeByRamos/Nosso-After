import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <p className="display text-8xl text-sunset">404</p>
        <p className="mt-4 text-sand-2">Essa página não existe (ou a festa já acabou).</p>
        <Link href="/" className="mt-6 inline-block font-semibold underline">
          Voltar ao início
        </Link>
      </div>
    </main>
  );
}
