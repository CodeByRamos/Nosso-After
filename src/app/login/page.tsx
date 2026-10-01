import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogoLockup } from "@/components/brand/brand";
import { getAuth } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getAuth()) redirect("/admin");
  return (
    <main className="tex-halftone grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <LogoLockup size="md" tagline="none" />
        <p className="type-label mt-6 text-muted">Acesso da produção e da portaria</p>
        <LoginForm />
      </div>
    </main>
  );
}
