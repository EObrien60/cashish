/** @type {import('next').NextConfig} */
const nextConfig = {
  // `pg` is a native-ish driver with dynamic requires; keep it out of the bundle.
  serverExternalPackages: ["pg"],
  // @cashish/core is consumed as TypeScript source, so Next must compile it.
  transpilePackages: ["@cashish/core"],
  // @react-pdf/renderer's PDF engine (pdfkit) loads its standard font metrics
  // (.afm data, and the .cjs/.mjs wrappers around them) from disk at RUNTIME,
  // not via a static import — so Next's file-tracer can't see the dependency
  // and leaves them out of the serverless function, which then 500s the
  // first time an invoice is actually emailed:
  // "Cannot find module '.../pdfkit/js/standard-fonts/Helvetica.cjs'".
  // Traced in production on 2026-09-07; fixed by naming the files explicitly
  // rather than guessing, since the tracer's whole problem is that it can't
  // find them on its own.
  // This is an npm workspace: pdfkit is hoisted to the monorepo root's
  // node_modules, not apps/books/node_modules, hence ../../ rather than ./.
  outputFileTracingIncludes: {
    "/invoices/[id]": ["../../node_modules/pdfkit/js/**/*"],
  },
  experimental: {
    serverActions: {
      // Statement import posts the file through a server action, and Next
      // defaults this to 1 MB — which a single year of a personal Revolut
      // export already exceeds, failing as an opaque 500 (413 in the log)
      // before any of our code runs.
      //
      // 4 MB rather than more: Vercel caps a serverless request body at 4.5 MB
      // whatever is configured here, so a larger number would only move the
      // same failure to a place we cannot give a good error from. The client
      // checks the size before posting for that reason.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
