import { load, readAnalogBatch, unload } from '../native/index';

// ─── HID Usage Page 0x07 key codes ──────────────────────────────────────────

export const HID = {
  Escape:    0x29,
  Backspace: 0x2A,
  Tab:       0x2B,
  Enter:     0x28,
  Delete:    0x4C,
  Left:      0x50,
  Right:     0x4F,
  Up:        0x52,
  Down:      0x51,
} as const;

export type HIDKey = keyof typeof HID;

export const HID_CODES = Object.values(HID) as number[];

// ─── Bridge ──────────────────────────────────────────────────────────────────

export class WootingBridge {
  private _initialized = false;

  constructor(private readonly dllPath: string) {}

  get initialized(): boolean {
    return this._initialized;
  }

  init(): boolean {
    this._initialized = load(this.dllPath);
    return this._initialized;
  }

  /**
   * Read all tracked keys in a single FFI call.
   * Returns a Map<HIDKey, depth> for easy lookup.
   */
  readAll(): Map<HIDKey, number> {
    const keys = Object.keys(HID) as HIDKey[];
    const depths = readAnalogBatch(HID_CODES);
    const result = new Map<HIDKey, number>();
    keys.forEach((key, i) => result.set(key, depths[i]));
    return result;
  }

  dispose(): void {
    if (this._initialized) {
      unload();
      this._initialized = false;
    }
  }
}
