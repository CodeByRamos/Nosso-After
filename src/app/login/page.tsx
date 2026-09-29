import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/site/site-chrome";
import { getAuth } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getAuth()) redirect("/admin");
  return (
    <main className="grain grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <Wordmark className="text-4xl" />
        <p className="mt-2 text-sm text-mute">Acesso da produção e da portaria</p>
        <LoginForm />
      </div>
    </main>
  );
}
