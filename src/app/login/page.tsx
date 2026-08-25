import { login } from "../auth-actions";
import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">cashish</h1>
          <p className="mt-1 text-sm text-ink-soft">Sign in to your books.</p>
        </div>
        <LoginForm action={login} next={next ?? "/"} />
      </div>
    </div>
  );
}
