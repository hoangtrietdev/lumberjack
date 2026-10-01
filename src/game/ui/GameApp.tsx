import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Game } from '../engine/game';
import { LangSwitch, useI18n } from '../../i18n/react';
import { TREE_CATALOG, speciesName } from '../trees/catalog';
import { formatDuration, formatScore } from '../logic/share';
import { hud, saved, useHud } from './store';
import { SharePanel } from './SharePanel';
import { TouchControls } from './TouchControls';

export interface Challenge {
  score: number;
  from: string;
}

export default function GameApp({ challenge }: { challenge: Challenge | null }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);

  useEffect(() => {
    let g: Game | null = null;
    let cancelled = false;
    hud.reset();
    import('../engine/game').then(({ Game }) => {
      if (cancelled || !mountRef.current) return;
      g = new Game(mountRef.current);
      // `?debug` exposes the engine in the console for testing.
      if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __game: Game }).__game = g;
      setGame(g);
      g.init();
    });
    return () => {
      cancelled = true;
      g?.dispose();
    };
  }, []);

  const phase = useHud((s) => s.phase);

  return (
    <div className={`game-root phase-${phase}`}>
      <div ref={mountRef} className="game-canvas" />
      {game && phase === 'playing' && <Hud game={game} />}
      {game && phase === 'playing' && <TouchControlsGate game={game} />}
      {phase === 'loading' && <Loading />}
      {phase === 'error' && <ErrorScreen />}
      {game && phase === 'menu' && <Menu game={game} challenge={challenge} />}
      {game && phase === 'paused' && <Paused game={game} />}
      {game && phase === 'over' && <GameOver game={game} challenge={challenge} />}
      <Toast />
    </div>
  );
}

function TouchControlsGate({ game }: { game: Game }) {
  const touch = useHud((s) => s.touch);
  return touch ? <TouchControls input={game.input} /> : null;
}

// --------------------------------------------------------------- screens --

function Loading() {
  const p = useHud((s) => s.loading);
  const labelKey = useHud((s) => s.loadingKey);
  const { t } = useI18n();
  return (
    <div className="overlay overlay-solid">
      <div className="loading">
        <Logo />
        <div className="progress">
          <div className="progress-fill" style={{ width: `${Math.round(p * 100)}%` }} />
        </div>
        <p className="muted">
          {t(labelKey)} {Math.round(p * 100)}%
        </p>
        <p className="muted small">{t('loading.note')}</p>
      </div>
    </div>
  );
}

function ErrorScreen() {
  const err = useHud((s) => s.error);
  const { t } = useI18n();
  return (
    <div className="overlay overlay-solid">
      <div className="panel">
        <h2>{t('error.title')}</h2>
        <p className="muted">{t('error.body', { err: err ?? '' })}</p>
        <button className="btn btn-primary" onClick={() => location.reload()}>
          {t('error.retry')}
        </button>
      </div>
    </div>
  );
}

function Logo({ small }: { small?: boolean }) {
  const { t } = useI18n();
  const [a, b] = t('brand').split('&').map((x) => x.trim());
  return (
    <div className={`logo ${small ? 'logo-small' : ''}`}>
      <span className="logo-axe" aria-hidden>
        🪓
      </span>
      <span className="logo-text">
        {a} <em>&amp;</em> {b}
      </span>
      <span className="logo-sub">{t('brand.tagline')}</span>
    </div>
  );
}

function MuteButton({ game }: { game: Game }) {
  const muted = useHud((s) => s.muted);
  const { t } = useI18n();
  const label = muted ? t('audio.unmute') : t('audio.mute');
  return (
    <button className="icon-btn" onClick={() => game.setMuted(!muted)} aria-label={label} title={label}>
      {muted ? '🔇' : '🔊'}
    </button>
  );
}

function Menu({ game, challenge }: { game: Game; challenge: Challenge | null }) {
  const best = useHud((s) => s.best);
  // First visit: open the how-to automatically.
  const [showHelp, setShowHelp] = useState(() => !saved.tutorialSeen());
  const { t, rich } = useI18n();
  return (
    <div className="overlay overlay-menu">
      <div className="menu">
        <Logo />
        {challenge && (
          <div className="challenge">
            {rich('menu.challenge', { from: challenge.from || t('menu.friend'), score: formatScore(challenge.score) })}
          </div>
        )}
        <button className="btn btn-primary btn-xl" onClick={() => game.start()} autoFocus>
          {t('menu.play')}
        </button>
        <div className="menu-row">
          <button className="btn" onClick={() => setShowHelp((v) => !v)}>
            {showHelp ? t('menu.hideHowto') : t('menu.howto')}
          </button>
          <Link className="btn" href="/trees">
            {t('menu.trees')}
          </Link>
          <MuteButton game={game} />
          <LangSwitch />
        </div>
        {best > 0 && <p className="best">{t('menu.best', { score: formatScore(best) })}</p>}
        {showHelp && <HowTo />}
      </div>
    </div>
  );
}

export function HowTo() {
  const touch = useHud((s) => s.touch);
  const { rich } = useI18n();
  const keys = touch ? (['howto.touch1', 'howto.touch2'] as const) : (['howto.desk1', 'howto.desk2'] as const);
  const rules = ['howto.r1', 'howto.r2', 'howto.r3', 'howto.r4', 'howto.r5', 'howto.r6'] as const;
  return (
    <div className="howto">
      <ul>
        {[...keys, ...rules].map((k) => (
          <li key={k}>{rich(k)}</li>
        ))}
      </ul>
    </div>
  );
}

function Paused({ game }: { game: Game }) {
  const { t } = useI18n();
  return (
    <div className="overlay overlay-dim">
      <div className="panel">
        <h2>{t('pause.title')}</h2>
        <button className="btn btn-primary btn-xl" onClick={() => game.resume()} autoFocus>
          {t('pause.resume')}
        </button>
        <div className="menu-row">
          <button className="btn" onClick={() => game.start()}>
            {t('pause.restart')}
          </button>
          <button className="btn" onClick={() => game.toMenu()}>
            {t('pause.menu')}
          </button>
          <MuteButton game={game} />
          <LangSwitch />
        </div>
        <HowTo />
      </div>
    </div>
  );
}

function GameOver({ game, challenge }: { game: Game; challenge: Challenge | null }) {
  const r = useHud((s) => s.result);
  const best = useHud((s) => s.best);
  const [show, setShow] = useState(false);
  const { t, rich, lang } = useI18n();
  useEffect(() => {
    const id = setTimeout(() => setShow(true), 1100);
    return () => clearTimeout(id);
  }, []);
  if (!r) return null;
  return (
    <div className={`overlay overlay-dim ${show ? 'show' : 'pre'}`}>
      <div className="stamp">{t('over.stamp')}</div>
      {show && (
        <div className="panel gameover">
          <p className="muted">{t('over.caughtAfter', { time: formatDuration(r.time, lang) })}</p>
          <div className="final-score">
            {formatScore(r.score, lang)}
            <span>{t('over.points')}</span>
          </div>
          {r.isNewBest ? <div className="badge badge-gold">{t('over.newBest')}</div> : <p className="muted">{t('over.best', { score: formatScore(best, lang) })}</p>}
          {challenge && (
            <div className={`challenge ${r.score > challenge.score ? 'won' : ''}`}>
              {r.score > challenge.score
                ? rich('over.beat', { from: challenge.from || t('menu.friend'), score: formatScore(challenge.score, lang) })
                : rich('over.short', { need: formatScore(challenge.score - r.score + 1, lang), from: challenge.from || t('menu.friend') })}
            </div>
          )}
          <div className="stats">
            <Stat label={t('stat.felled')} value={r.felled} />
            <Stat label={t('stat.wood')} value={formatScore(r.wood, lang)} />
            <Stat label={t('stat.combo')} value={`×${r.bestChain}`} />
            <Stat label={t('stat.rare')} value={r.rare} />
            <Stat label={t('stat.stunned')} value={r.stunned} />
            <Stat label={t('stat.time')} value={formatDuration(r.time, lang)} />
          </div>
          <SharePanel result={r} />
          <div className="menu-row">
            <button className="btn btn-primary btn-xl" onClick={() => game.start()}>
              {t('over.again')}
            </button>
            <button className="btn" onClick={() => game.toMenu()}>
              {t('over.menu')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

// ------------------------------------------------------------------ HUD --

function Hud({ game }: { game: Game }) {
  const minimapRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    game.setMinimapCanvas(minimapRef.current);
    return () => game.setMinimapCanvas(null);
  }, [game]);

  const score = useHud((s) => s.score);
  const time = useHud((s) => s.time);
  const felled = useHud((s) => s.felled);
  const chain = useHud((s) => s.chain);
  const multiplier = useHud((s) => s.multiplier);
  const comboLeft = useHud((s) => s.comboLeft);
  const heatLevel = useHud((s) => s.heatLevel);
  const heat = useHud((s) => s.heat);
  const bounty = useHud((s) => s.bounty);
  const stamina = useHud((s) => s.stamina);
  const hidden = useHud((s) => s.hidden);
  const chasing = useHud((s) => s.chasing);
  const alerted = useHud((s) => s.alerted);
  const target = useHud((s) => s.target);
  const touch = useHud((s) => s.touch);
  const locked = useHud((s) => s.locked);
  const { t, lang } = useI18n();

  const status =
    chasing > 0 ? t(chasing === 1 ? 'hud.chasing1' : 'hud.chasingN', { n: chasing }) : alerted > 0 ? t('hud.suspicious') : hidden ? t('hud.hidden') : '';

  return (
    <div className={`hud ${chasing > 0 ? 'hud-chase' : ''}`}>
      <div className="vignette" />
      <div className="hud-tl">
        <div className="hud-score">{formatScore(score, lang)}</div>
        <div className="hud-sub">
          🌲 {felled} · ⏱ {formatDuration(time, lang)}
        </div>
        {comboLeft > 0 && chain > 0 && (
          <div className="combo">
            <span>{t('hud.combo', { m: multiplier })}</span>
            <div className="combo-bar">
              <div style={{ width: `${(comboLeft / 9) * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="hud-tc">
        <div className="stars" title={t('hud.wanted')}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={i < heatLevel ? 'on' : i === heatLevel ? 'partial' : ''} style={i === heatLevel ? { ['--p' as string]: `${(heat % 20) * 5}%` } : undefined}>
              ★
            </span>
          ))}
        </div>
        {bounty > 0 && (
          <div className="bounty" title={t('hud.bountyTitle')}>
            {t('hud.bounty', { n: bounty })}
          </div>
        )}
        {status && <div className={`status ${chasing > 0 ? 'bad' : alerted > 0 ? 'warn' : 'good'}`}>{status}</div>}
      </div>

      <div className="hud-tr">
        <canvas ref={minimapRef} className="minimap" />
        <div className="hud-buttons">
          <MuteButton game={game} />
          <button className="icon-btn" onClick={() => game.pause()} aria-label={t('hud.pause')} title={t('hud.pause')}>
            ⏸
          </button>
        </div>
      </div>

      <div className={`hud-bl ${touch ? 'touch' : ''}`}>
        <div className="stamina" title={t('hud.stamina')}>
          <div className={stamina < 30 ? 'low' : ''} style={{ width: `${stamina}%` }} />
        </div>
        {hidden && <div className="badge badge-green">{t('hud.hidingBadge')}</div>}
      </div>

      {target && (
        <div className={`target ${touch ? 'touch' : ''}`}>
          <div className="target-name">
            {speciesName(TREE_CATALOG[target.species], lang)} <span>+{target.points}</span>
          </div>
          <div className="hp">
            {Array.from({ length: target.maxHp }, (_, i) => (
              <i key={i} className={i < target.hp ? 'full' : ''} />
            ))}
          </div>
          {!touch && <div className="hint">{t('hud.chopHint')}</div>}
        </div>
      )}
      {!touch && !locked && <div className="lock-hint">{t('hud.lockHint')}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- toast --

function Toast() {
  const t = useHud((s) => s.toast);
  if (!t) return null;
  return (
    <div key={t.id} className={`toast toast-${t.tone}`} role="status">
      {t.text}
    </div>
  );
}
