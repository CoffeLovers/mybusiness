import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Monorepo pnpm: la traza de ficheros debe partir de la raíz del repo para que
  // el output standalone incluya las dependencias hoisted.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // El output standalone sólo se activa en el build de imagen Docker.
  ...(process.env.NEXT_OUTPUT_STANDALONE === 'true' ? { output: 'standalone' as const } : {}),
};

export default nextConfig;
