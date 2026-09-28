import { WootingBridge, HIDKey, HID } from './wootingBridge';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Depth above which a key is considered physically pressed. */
const PRESS_THRESHOLD = 0.08;

/** Poll interval in ms. 8ms ≈ 120 Hz. */
const POLL_MS = 8;

// ─── Types ───────────────────────────────────────────────────────────────────

interface KeyState {
  isDown: boolean;
  /** Highest depth recorded during the current (or most recent) press. */
  peakDepth: number;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export class AnalogKeyHandler {
  private readonly states = new Map<HIDKey, KeyState>(
    (Object.keys(HID) as HIDKey[]).map(key => [key, { isDown: false, peakDepth: 0 }])
  );
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly bridge: WootingBridge) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Peak depth (0–1) recorded since the last press of this key.
   * Read this inside your VS Code command handler — by the time VS Code
   * dispatches the command the key is at or past its peak.
   */
  peakDepth(key: HIDKey): number {
    return this.states.get(key)?.peakDepth ?? 0;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private poll(): void {
    // Single batch FFI call — one round-trip into Rust for all keys.
    const depths = this.bridge.readAll();

    for (const [key, state] of this.states) {
      const depth = depths.get(key) ?? 0;

      if (!state.isDown && depth > PRESS_THRESHOLD) {
        // Rising edge
        state.isDown = true;
        state.peakDepth = depth;
      } else if (state.isDown && depth > PRESS_THRESHOLD) {
        // Key held — track peak
        if (depth > state.peakDepth) state.peakDepth = depth;
      } else if (state.isDown && depth <= PRESS_THRESHOLD) {
        // Falling edge — leave peakDepth for command handler to read
        state.isDown = false;
      }
    }
  }
}
