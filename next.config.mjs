/** @type {import('next').NextConfig} */
const nextConfig = {
  // `pg` is a native-ish driver with dynamic requires; keep it out of the bundle.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
