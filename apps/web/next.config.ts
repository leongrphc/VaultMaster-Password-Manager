import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  ...(process.env.VAULTMASTER_STATIC_EXPORT === "1"
    ? { output: "export" as const, trailingSlash: true, images: { unoptimized: true } }
    : {}),
  turbopack: { root: process.cwd().replace(/[\\/]apps[\\/]web$/, "") },
};

export default withSentryConfig(nextConfig, {
  silent: true,
});
