import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';

const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
async function readJson(file) {
  try { return parseJsonc(await fs.readFile(file, 'utf8')); } catch { return null; }
}

export async function buildResolver(rootDir, fileSet) {
  const tsconfig = await readJson(path.join(rootDir, 'tsconfig.json')) || {};
  const compiler = tsconfig.compilerOptions || {};
  const baseUrl = compiler.baseUrl ? path.resolve(rootDir, compiler.baseUrl) : rootDir;
  const aliases = Object.entries(compiler.paths || {}).map(([pattern, replacements]) => ({
    pattern, prefix: pattern.endsWith('/*') ? pattern.slice(0, -1) : null,
    exact: pattern.endsWith('/*') ? null : pattern,
    replacements: Array.isArray(replacements) ? replacements : []
  })).sort((a, b) => (b.exact || b.prefix || '').length - (a.exact || a.prefix || '').length);
  const packageJson = await readJson(path.join(rootDir, 'package.json')) || {};
  const workspacesValue = Array.isArray(packageJson.workspaces) ? packageJson.workspaces : (packageJson.workspaces?.packages || []);
  const workspacePackages = new Map();
  for (const pattern of workspacesValue) {
    if (typeof pattern !== 'string' || pattern.includes('..')) continue;
    if (pattern.includes('*')) {
      const parent = pattern.slice(0, pattern.indexOf('*')).replace(/\/$/, '');
      let dirs = [];
      try { dirs = await fs.readdir(path.join(rootDir, parent), { withFileTypes: true }); } catch {}
      for (const d of dirs.filter(item => item.isDirectory() && !item.isSymbolicLink())) await registerWorkspace(path.join(rootDir, parent, d.name));
    } else {
      await registerWorkspace(path.join(rootDir, pattern));
    }
  }
  async function registerWorkspace(dir) {
    const pkg = await readJson(path.join(dir, 'package.json'));
    if (!pkg?.name) return;
    const entries = [pkg.source, pkg.module, pkg.main, 'src/index.ts', 'src/index.tsx', 'src/index.js', 'index.ts', 'index.js'].filter(Boolean);
    workspacePackages.set(pkg.name, { root: dir, entries });
  }
  return { rootDir, fileSet, baseUrl, aliases, workspacePackages };
}

function aliasBases(spec, ctx) {
  for (const alias of ctx.aliases) {
    let captures;
    if (alias.exact && spec === alias.exact) captures = null;
    else if (alias.prefix && spec.startsWith(alias.prefix)) captures = spec.slice(alias.prefix.length);
    else continue;
    if (captures === null || captures !== '') {
      return alias.replacements.map(replacement => path.resolve(ctx.baseUrl, replacement.replace(/\*$/, captures ?? '')));
    }
  }
  return [];
}

function candidateFileIds(base, ctx) {
  const absolute = path.resolve(base);
  const relBase = path.relative(ctx.rootDir, absolute).replace(/\\/g, '/');
  const candidates = [relBase];
  const ext = path.extname(relBase);
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
    const stem = relBase.slice(0, -ext.length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`);
  }
  if (!ext) for (const suffix of EXTENSIONS) candidates.push(`${relBase}${suffix}`);
  for (const suffix of EXTENSIONS) candidates.push(`${relBase}/index${suffix}`);
  return [...new Set(candidates)];
}

export function resolveImport(fromFile, spec, ctx) {
  if (typeof spec !== 'string' || !spec.trim()) return null;
  let bases = [];
  if (spec.startsWith('./') || spec.startsWith('../')) {
    bases.push(path.resolve(ctx.rootDir, path.dirname(fromFile), spec));
  } else {
    const alias = aliasBases(spec, ctx);
    if (alias.length) bases.push(...alias);
    else {
      const workspaceName = [...ctx.workspacePackages.keys()].find(name => spec === name || spec.startsWith(`${name}/`));
      if (workspaceName) {
        const workspace = ctx.workspacePackages.get(workspaceName);
        const subpath = spec === workspaceName ? null : spec.slice(workspaceName.length + 1);
        if (subpath) bases.push(path.join(workspace.root, subpath));
        else bases.push(...workspace.entries.map(entry => path.join(workspace.root, entry)));
      } else return 'external';
    }
  }
  for (const base of bases) {
    for (const candidate of candidateFileIds(base, ctx)) {
      if (ctx.fileSet.has(candidate)) return candidate;
    }
  }
  return null;
}
