// The nav item for a path is the one whose href is its longest prefix, so
// /reports/cashflow lights up Cash flow and not Reports as well. "/" only
// matches itself, or it would match everything.
export function activeHref(path: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const hit = href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
    if (hit && (!best || href.length > best.length)) best = href;
  }
  return best;
}
