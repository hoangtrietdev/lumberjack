import { useEffect, useState } from 'react';
import Link from 'next/link';
import * as THREE from 'three';
import { TREE_CATALOG, isRare, speciesName, type TreeSpecies } from '../trees/catalog';
import { LangSwitch, useI18n } from '../../i18n/react';
import type { DictKey } from '../../i18n';

/**
 * The tree list: every species/variant the forest uses, grown live with
 * EZ-Tree from preset + seed and rendered to a thumbnail.
 */
export default function TreeCatalogView() {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState(0);
  const { t, rich } = useI18n();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ loadAssets }, { TreeLibrary }] = await Promise.all([import('../engine/assets'), import('../engine/trees')]);
      const assets = await loadAssets(() => {});
      const lib = new TreeLibrary(TREE_CATALOG, assets);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setSize(320, 400);
      renderer.setPixelRatio(1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight('#dfeeff', '#4d5a2c', 1.4));
      const sun = new THREE.DirectionalLight('#fff0d8', 2.4);
      sun.position.set(-5, 8, 6);
      scene.add(sun);
      const camera = new THREE.PerspectiveCamera(35, 320 / 400, 0.1, 200);
      const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshStandardMaterial({ color: '#7d8f55', roughness: 1 }));
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);

      const out: Record<string, string> = {};
      let i = 0;
      const total = TREE_CATALOG.reduce((n, s) => n + s.variants.length, 0);
      for (let si = 0; si < TREE_CATALOG.length; si++) {
        const sp = TREE_CATALOG[si];
        for (let vi = 0; vi < sp.variants.length; vi++) {
          if (cancelled) return;
          const v = sp.variants[vi];
          const tree = lib.growPreview(si, vi);
          scene.add(tree);
          const h = Math.max(v.height, v.canopyRadius * 2);
          ground.scale.setScalar(Math.max(1.5, v.canopyRadius * 1.3));
          camera.position.set(h * 0.95, h * 0.55, h * 1.55);
          camera.lookAt(0, v.height * 0.45, 0);
          // Wait for textures to be on the GPU before snapping the thumbnail.
          renderer.render(scene, camera);
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          renderer.render(scene, camera);
          out[`${sp.id}:${vi}`] = renderer.domElement.toDataURL('image/webp', 0.85);
          scene.remove(tree);
          setProgress(++i / total);
          if (vi === sp.variants.length - 1) setThumbs({ ...out });
        }
      }
      renderer.dispose();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const trees = TREE_CATALOG.filter((s) => s.kind === 'tree');
  const bushes = TREE_CATALOG.filter((s) => s.kind === 'bush');

  return (
    <main className="catalog">
      <header className="catalog-head">
        <Link href="/" className="btn">
          {t('trees.back')}
        </Link>
        <div className="catalog-title">
          <h1>{t('trees.title')}</h1>
          <p className="muted">
            {rich('trees.intro', {
              species: TREE_CATALOG.length,
              variants: TREE_CATALOG.reduce((n, s) => n + s.variants.length, 0),
              ezt: (
                <a href="https://github.com/dgreenheck/ez-tree" target="_blank" rel="noreferrer">
                  EZ-Tree
                </a>
              ),
            })}
            {progress < 1 && ` ${t('trees.growing', { p: Math.round(progress * 100) })}`}
          </p>
        </div>
        <LangSwitch className="catalog-lang" />
      </header>
      <section>
        <h2>{t('trees.choppable')}</h2>
        <div className="catalog-grid">
          {trees.map((s) => (
            <SpeciesCard key={s.id} s={s} thumbs={thumbs} />
          ))}
        </div>
      </section>
      <section>
        <h2>{t('trees.bushes')}</h2>
        <div className="catalog-grid">
          {bushes.map((s) => (
            <SpeciesCard key={s.id} s={s} thumbs={thumbs} />
          ))}
        </div>
      </section>
    </main>
  );
}

const LEAF_KEYS: Record<string, DictKey> = { ash: 'leaf.ash', aspen: 'leaf.aspen', oak: 'leaf.oak', pine: 'leaf.pine' };

function SpeciesCard({ s, thumbs }: { s: TreeSpecies; thumbs: Record<string, string> }) {
  const [vi, setVi] = useState(0);
  const { t, rich, lang } = useI18n();
  const v = s.variants[vi];
  const src = thumbs[`${s.id}:${vi}`];
  const name = speciesName(s, lang);
  const other = speciesName(s, lang === 'en' ? 'vi' : 'en');
  return (
    <article className={`tree-card ${isRare(s) ? 'rare' : ''}`}>
      <div className="tree-thumb">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={name} />
        ) : (
          <div className="thumb-wait">🌱</div>
        )}
      </div>
      <div className="tree-body">
        <h3>
          {name} <small>{other}</small>
        </h3>
        <div className="tree-meta">
          {rich('trees.meta', {
            preset: <code>{s.preset}</code>,
            leaf: LEAF_KEYS[s.leaf] ? t(LEAF_KEYS[s.leaf]) : s.leaf,
            kind: s.evergreen ? t('trees.evergreen') : t('trees.deciduous'),
          })}
        </div>
        <div className="variant-tabs">
          {s.variants.map((x, i) => (
            <button key={x.seed} className={i === vi ? 'on' : ''} onClick={() => setVi(i)}>
              seed {x.seed}
            </button>
          ))}
        </div>
        <dl className="tree-stats">
          <div>
            <dt>{t('trees.height')}</dt>
            <dd>{v.height} m</dd>
          </div>
          {s.kind === 'tree' ? (
            <>
              <div>
                <dt>{t('trees.trunk')}</dt>
                <dd>Ø {(v.trunkRadius * 200).toFixed(0)} cm</dd>
              </div>
              <div>
                <dt>{t('trees.hp')}</dt>
                <dd>{v.hp}</dd>
              </div>
              <div>
                <dt>{t('trees.points')}</dt>
                <dd>+{v.points}</dd>
              </div>
              <div>
                <dt>{t('trees.noise')}</dt>
                <dd>{v.noise} m</dd>
              </div>
            </>
          ) : (
            <div>
              <dt>{t('trees.canopy')}</dt>
              <dd>{v.canopyRadius} m</dd>
            </div>
          )}
          <div>
            <dt>{t('trees.tris')}</dt>
            <dd>{(v.tris / 1000).toFixed(1)}k</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
