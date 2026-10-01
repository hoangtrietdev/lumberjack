// Typed access to the generated tree list (see scripts/generate-tree-catalog.mjs).
import data from './catalog.json';
import type { Lang } from '../../i18n';

export interface TreeVariant {
  seed: number;
  height: number;
  canopyRadius: number;
  trunkRadius: number;
  tris: number;
  volume: number;
  hp: number;
  points: number;
  noise: number;
}

export interface TreeSpecies {
  id: string;
  kind: 'tree' | 'bush';
  preset: string;
  name: string;
  nameEn: string;
  leaf: string;
  bark: string;
  evergreen: boolean;
  scale: number;
  value: number;
  weights: { pine: number; broadleaf: number };
  variants: TreeVariant[];
}

export const TREE_CATALOG: TreeSpecies[] = (data as { species: TreeSpecies[] }).species;

/** Ancient trees count as "rare" for the share card. */
export function isRare(s: TreeSpecies): boolean {
  return s.kind === 'tree' && s.id.endsWith('-l');
}

/** Species display name in the given language. */
export function speciesName(s: TreeSpecies, lang: Lang): string {
  return lang === 'en' ? s.nameEn : s.name;
}
