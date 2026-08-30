"use client";

import { useTransition } from "react";
import { Card } from "./ui";
import type { ApproveInput } from "@/app/oauth/authorize/actions";

const SCOPE_LABELS: Record<string, string> = {
  "books:read": "Read your books — transactions, invoices, customers, reports and VAT",
  "books:write":
    "Change your books — categorise transactions, write rules, raise invoices and record payments",
};

export function ConsentForm({
  clientName,
  businessName,
  role,
  scopes,
  params,
  action,
}: {
  clientName: string;
  businessName: string;
  role: string;
  scopes: string[];
  params: ApproveInput;
  action: (input: ApproveInput) => Promise<void>;
}) {
  const [pending, start] = useTransition();

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold">
        Allow <span className="text-brand">{clientName}</span> to access {businessName}?
      </h1>
      <p className="mt-1 text-sm text-ink-soft">
        You are signed in as <strong>{role}</strong>. Access is limited to this business and to
        what your own role allows.
      </p>

      <ul className="mt-4 space-y-2">
        {scopes.map((scope) => (
          <li key={scope} className="flex gap-2 text-sm">
            <span aria-hidden className="text-brand">
              •
            </span>
            <span>{SCOPE_LABELS[scope] ?? scope}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => { await action(params); })}
          className="btn-primary flex-1 justify-center"
        >
          {pending ? "Approving…" : "Allow"}
        </button>
        <a href={`${params.redirectUri}?error=access_denied${params.state ? `&state=${encodeURIComponent(params.state)}` : ""}`}
           className="btn-outline flex-1 justify-center">
          Cancel
        </a>
      </div>

      <p className="mt-4 text-xs text-ink-faint">
        You can revoke this at any time from Settings.
      </p>
    </Card>
  );
}
