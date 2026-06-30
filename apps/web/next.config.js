import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = join(__dirname, "..", "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle for the Docker image.
  output: "standalone",
  // Pin the workspace root so Turbopack/file-tracing resolve correctly
  // from within the monorepo.
  turbopack: { root: monorepoRoot },
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ["@repo/ui", "@repo/db"],
  experimental: {
    // Test uploads are forwarded through a Server Action; raise the default
    // 1 MB body cap. Headroom above the 10 MB per-file limit (lib/upload-config)
    // covers multipart boundaries and the api-key form field.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
