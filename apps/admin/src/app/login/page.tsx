import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="text-xl font-semibold tracking-tight">cashish</span>
            <span className="adm-pill bg-accent text-white">admin</span>
          </div>
          <p className="text-sm text-ink-faint">
            Platform administration. Not the customer sign-in.
          </p>
        </div>
        <div className="adm-card p-6">
          <LoginForm next={next ?? "/tenants"} />
        </div>
        <p className="text-[11px] text-ink-faint text-center mt-4">
          Accounts are created from the command line. There is no sign-up.
        </p>
      </div>
    </div>
  );
}
