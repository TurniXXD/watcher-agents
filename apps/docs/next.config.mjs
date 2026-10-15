import { createMDX } from 'fumadocs-mdx/next';
import { fileURLToPath, URL } from 'node:url';

const withMDX = createMDX();
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  outputFileTracingRoot: repositoryRoot,
  reactStrictMode: true,
  poweredByHeader: false,
};

export default withMDX(config);
