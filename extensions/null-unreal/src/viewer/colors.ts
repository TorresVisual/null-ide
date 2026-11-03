// Pin and node colours for the material graph. Pure data plus lookups; the values are a taste choice, change them here.

// Pin colour by the engine's EMaterialValueType bits (MaterialValueType.h). Checked in this order: first match wins.
// Verify the bit values against the engine version in use when a new value type shows up.
export const PIN_COLORS: { mask: number; color: string }[] = [
  { mask: 16 | 32 | 64 | 128 | 256 | 4096, color: '#e0689a' }, // any texture: pink
  { mask: 8, color: '#b58be0' }, // float4: purple
  { mask: 4, color: '#e8c44a' }, // float3: yellow
  { mask: 2, color: '#7fb8e8' }, // float2: blue
  { mask: 1, color: '#8fd16b' }, // float1 (scalar): green
  { mask: 512 | 8192, color: '#d9534f' }, // bool / static bool: red
];
export const UNKNOWN_PIN = '#8a8a8a';

export function pinColor(typeMask: number | null): string {
  if (typeMask === null) return UNKNOWN_PIN;
  return PIN_COLORS.find((p) => (typeMask & p.mask) !== 0)?.color ?? UNKNOWN_PIN;
}

export type Family = 'parameter' | 'texture' | 'math' | 'constant' | 'utility' | 'function' | 'other';

// Class-name patterns, first match wins. Texture comes before parameter so TextureSampleParameter2D is a texture.
export const FAMILY_PATTERNS: { family: Family; pattern: RegExp }[] = [
  { family: 'texture', pattern: /TextureSample|TextureObject|TextureCoordinate/ },
  { family: 'parameter', pattern: /Parameter/ },
  { family: 'function', pattern: /FunctionInput|FunctionOutput|FunctionCall|MaterialFunction/ },
  { family: 'constant', pattern: /Constant/ },
  { family: 'math', pattern: /^MaterialExpression(Add|Multiply|Divide|Subtract|Lerp|Power|Dot|Cross|Normalize|Saturate|OneMinus|Clamp|Abs|Sqrt|Min|Max|Frac|Floor|Ceil|Round|Step|Smoothstep|ComponentMask|AppendVector|If)$/ },
  { family: 'utility', pattern: /Panner|Rotator|Time|Sine|Noise|Fresnel|Distance|Desaturation|Sphere|Camera|Vertex|Transform/ },
];

const FAMILY_COLORS: Record<Family, string> = {
  parameter: '#d98a3d',
  texture: '#e0689a',
  math: '#6f9fd8',
  constant: '#8fd16b',
  utility: '#4fb3a9',
  function: '#a78bdb',
  other: '#8a8a8a',
};

export function nodeFamily(cls: string): Family {
  return FAMILY_PATTERNS.find((f) => f.pattern.test(cls))?.family ?? 'other';
}

export function familyColor(f: Family): string {
  return FAMILY_COLORS[f];
}
