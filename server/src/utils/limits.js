export const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
export const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', '.output',
  'vendor', '.turbo', '.cache', 'storybook-static', 'out'
]);
export const IGNORED_FILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock',
  'composer.lock', 'Cargo.lock'
]);
export const isSourcePath = (filePath) => SOURCE_EXTENSIONS.has(filePath.slice(filePath.lastIndexOf('.')).toLowerCase());
