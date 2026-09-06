/** @type {import('next').NextConfig} */
const nextConfig = {
  // `pg` is a native-ish driver with dynamic requires; keep it out of the bundle.
  serverExternalPackages: ["pg"],
  // @cashish/core is consumed as TypeScript source, so Next must compile it.
  transpilePackages: ["@cashish/core"],
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
