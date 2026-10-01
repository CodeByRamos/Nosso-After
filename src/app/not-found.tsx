import Link from "next/link";
import { Chevrons, LogoLockup } from "@/components/brand/brand";

export default function NotFound() {
  return (
    <main className="tex-halftone grid min-h-dvh place-items-center px-4 text-center">
      <div className="flex flex-col items-center">
        <LogoLockup size="md" tagline="none" />
        <p className="type-date mt-10 text-7xl text-primary">404</p>
        <p className="type-headline mt-4 text-2xl">Essa página não existe.</p>
        <p className="mt-2 text-fg-2">Ou a festa já acabou.</p>
        <Link href="/#agenda" className="btn btn-primary mt-8">
          Ver a agenda <Chevrons />
        </Link>
      </div>
    </main>
  );
}
