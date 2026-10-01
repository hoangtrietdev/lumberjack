/** Keyboard, mouse (with optional pointer lock) and touch input in one place. */
export interface InputState {
  moveX: number; // -1..1 (right +)
  moveY: number; // -1..1 (forward +)
  sprint: boolean;
  chop: boolean;
  chopPressed: boolean; // went down this frame
}

export class Input implements InputState {
  moveX = 0;
  moveY = 0;
  sprint = false;
  chop = false;
  chopPressed = false;
  lookDX = 0;
  lookDY = 0;
  zoom = 0;
  enabled = false;
  onPauseRequest: (() => void) | null = null;

  private keys = new Set<string>();
  private joy = { x: 0, y: 0 };
  private touchChop = false;
  private touchSprint = false;
  private mouseChop = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private prevChop = false;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    el.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    el.addEventListener('wheel', this.onWheel, { passive: true });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get locked() {
    return document.pointerLockElement === this.el;
  }

  requestLock() {
    if (matchMedia('(pointer: coarse)').matches) return;
    try {
      const p = this.el.requestPointerLock?.() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* pointer lock not available (e.g. inside some iframes): drag to look instead */
    }
  }

  exitLock() {
    if (this.locked) document.exitPointerLock();
  }

  setJoystick(x: number, y: number) {
    this.joy.x = x;
    this.joy.y = y;
  }

  setTouchButton(name: 'chop' | 'sprint', down: boolean) {
    if (name === 'chop') this.touchChop = down;
    else this.touchSprint = down;
  }

  addLook(dx: number, dy = 0) {
    this.lookDX += dx;
    this.lookDY += dy;
  }

  /** Call once per frame before reading the state. */
  poll() {
    const k = this.keys;
    let x = 0;
    let y = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    x += this.joy.x;
    y += this.joy.y;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    this.moveX = this.enabled ? x : 0;
    this.moveY = this.enabled ? y : 0;
    this.sprint = this.enabled && (k.has('ShiftLeft') || k.has('ShiftRight') || this.touchSprint);
    const chop = this.enabled && (k.has('Space') || k.has('KeyE') || k.has('KeyJ') || this.mouseChop || this.touchChop);
    this.chopPressed = chop && !this.prevChop;
    this.prevChop = chop;
    this.chop = chop;
  }

  consumeLook(): [number, number, number] {
    const r: [number, number, number] = [this.lookDX, this.lookDY, this.zoom];
    this.lookDX = 0;
    this.lookDY = 0;
    this.zoom = 0;
    return r;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if ((e.code === 'Escape' || e.code === 'KeyP') && this.enabled) this.onPauseRequest?.();
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
    this.mouseChop = false;
    this.dragging = false;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (e.button === 0) {
      if (!this.locked) this.requestLock();
      this.mouseChop = true;
    }
    if (e.button === 2 || e.button === 1 || !this.locked) {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseChop = false;
    this.dragging = false;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (this.locked) {
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    } else if (this.dragging) {
      this.lookDX += e.clientX - this.lastX;
      this.lookDY += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  };

  private onWheel = (e: WheelEvent) => {
    this.zoom += Math.sign(e.deltaY);
  };

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.el.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.el.removeEventListener('wheel', this.onWheel);
  }
}
