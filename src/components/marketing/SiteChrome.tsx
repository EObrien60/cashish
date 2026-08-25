import Link from "next/link";

export function SiteNav({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header className="mk-hairline sticky top-0 z-20 border-t-0 bg-[color:var(--paper)]/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="mk-display text-xl font-medium tracking-tight">cashish</span>
          <span className="hidden text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] sm:inline">
            books, sorted
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-4">
          <Link
            href="/pricing"
            className="hidden px-2 py-1 text-[color:var(--ink-soft)] hover:text-[color:var(--ink)] sm:inline"
          >
            Pricing
          </Link>
          {signedIn ? (
            <Link href="/" className="mk-btn mk-btn-primary">
              Open the app
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="px-2 py-1 text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
              >
                Sign in
              </Link>
              <Link href="/register" className="mk-btn mk-btn-primary">
                Start free
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mk-hairline mt-24">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-sm">
            <div className="mk-display text-lg">cashish</div>
            <p className="mt-2 text-sm leading-relaxed text-[color:var(--ink-faint)]">
              EUR bookkeeping for a small Irish business. It works out the figures;
              you file them. Check anything against ROS before you submit it.
            </p>
          </div>
          <div className="flex gap-12 text-sm">
            <div>
              <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-faint)]">
                Product
              </div>
              <ul className="space-y-1.5">
                <li>
                  <Link href="/pricing" className="text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]">
                    Pricing
                  </Link>
                </li>
                <li>
                  <Link href="/register" className="text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]">
                    Create an account
                  </Link>
                </li>
                <li>
                  <Link href="/login" className="text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]">
                    Sign in
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-faint)]">
                Where things are
              </div>
              <ul className="space-y-1.5 text-[color:var(--ink-faint)]">
                <li>Data in Frankfurt, inside the EU</li>
                <li>Euro only, by design</li>
                <li>Cash or invoice basis VAT</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mk-hairline mt-10 pt-5 text-xs text-[color:var(--ink-faint)]">
          Not a Revenue-approved filing service. cashish computes; you review and file.
        </div>
      </div>
    </footer>
  );
}
