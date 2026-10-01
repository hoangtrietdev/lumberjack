import { useRef, useState } from 'react';
import type { Input } from '../engine/input';
import { useI18n } from '../../i18n/react';

/** On-screen joystick, CHOP / RUN buttons and drag-to-look for phones. */
export function TouchControls({ input }: { input: Input }) {
  const base = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const joyId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const last = useRef({ x: 0, y: 0 });

  const moveJoy = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    const R = r.width / 2;
    let dx = (e.clientX - (r.left + R)) / R;
    let dy = (e.clientY - (r.top + R)) / R;
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    setKnob({ x: dx * R * 0.6, y: dy * R * 0.6 });
    input.setJoystick(dx, -dy);
  };

  return (
    <div className="touch">
      <div
        className="look-pad"
        onPointerDown={(e) => {
          if (lookId.current !== null) return;
          lookId.current = e.pointerId;
          last.current = { x: e.clientX, y: e.clientY };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.pointerId !== lookId.current) return;
          input.addLook((e.clientX - last.current.x) * 2.2, (e.clientY - last.current.y) * 1.5);
          last.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          if (e.pointerId === lookId.current) lookId.current = null;
        }}
        onPointerCancel={() => (lookId.current = null)}
      />
      <div
        ref={base}
        className="joy"
        onPointerDown={(e) => {
          joyId.current = e.pointerId;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          moveJoy(e);
        }}
        onPointerMove={(e) => e.pointerId === joyId.current && moveJoy(e)}
        onPointerUp={() => {
          joyId.current = null;
          setKnob({ x: 0, y: 0 });
          input.setJoystick(0, 0);
        }}
        onPointerCancel={() => {
          joyId.current = null;
          setKnob({ x: 0, y: 0 });
          input.setJoystick(0, 0);
        }}
      >
        <div className="joy-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      </div>
      <div className="touch-buttons">
        <button
          className="tbtn tbtn-sprint"
          onPointerDown={() => input.setTouchButton('sprint', true)}
          onPointerUp={() => input.setTouchButton('sprint', false)}
          onPointerCancel={() => input.setTouchButton('sprint', false)}
          onPointerLeave={() => input.setTouchButton('sprint', false)}
        >
          {t('touch.run')}
        </button>
        <button
          className="tbtn tbtn-chop"
          onPointerDown={() => input.setTouchButton('chop', true)}
          onPointerUp={() => input.setTouchButton('chop', false)}
          onPointerCancel={() => input.setTouchButton('chop', false)}
          onPointerLeave={() => input.setTouchButton('chop', false)}
        >
          🪓
          <span>{t('touch.chop')}</span>
        </button>
      </div>
    </div>
  );
}
