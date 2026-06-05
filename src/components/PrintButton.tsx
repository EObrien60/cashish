"use client";

import { IconPrint } from "@/components/icons";

export function PrintButton({ label = "Print / save PDF" }: { label?: string }) {
  return (
    <button className="btn-outline no-print" onClick={() => window.print()}>
      <IconPrint className="h-4 w-4" /> {label}
    </button>
  );
}
