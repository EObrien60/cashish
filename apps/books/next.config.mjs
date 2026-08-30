/** @type {import('next').NextConfig} */
const nextConfig = {
  // `pg` is a native-ish driver with dynamic requires; keep it out of the bundle.
  serverExternalPackages: ["pg"],
  // @cashish/core is consumed as TypeScript source, so Next must compile it.
  transpilePackages: ["@cashish/core"],
};

export default nextConfig;
