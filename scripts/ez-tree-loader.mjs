// Node module hooks so the vendored ez-tree source (written for bundlers:
// extensionless relative imports + bare JSON imports) can run in plain Node.
// Used only by scripts/generate-tree-catalog.mjs.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const url = new URL(specifier, context.parentURL);
    const path = fileURLToPath(url);
    if (!existsSync(path) && existsSync(path + '.js')) {
      return nextResolve(specifier + '.js', context);
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) {
    const text = await readFile(fileURLToPath(url), 'utf8');
    return { format: 'module', source: `export default ${text};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
