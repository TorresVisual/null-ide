"use strict";
// Pin and node colours for the material graph. Pure data plus lookups; the values are a taste choice, change them here.
Object.defineProperty(exports, "__esModule", { value: true });
exports.FAMILY_PATTERNS = exports.UNKNOWN_PIN = exports.PIN_COLORS = void 0;
exports.pinColor = pinColor;
exports.nodeFamily = nodeFamily;
exports.familyColor = familyColor;
// Pin colour by the engine's EMaterialValueType bits (MaterialValueType.h). Checked in this order: first match wins.
// Verify the bit values against the engine version in use when a new value type shows up.
exports.PIN_COLORS = [
    { mask: 16 | 32 | 64 | 128 | 256 | 4096, color: '#e0689a' }, // any texture: pink
    { mask: 8, color: '#b58be0' }, // float4: purple
    { mask: 4, color: '#e8c44a' }, // float3: yellow
    { mask: 2, color: '#7fb8e8' }, // float2: blue
    { mask: 1, color: '#8fd16b' }, // float1 (scalar): green
    { mask: 512 | 8192, color: '#d9534f' }, // bool / static bool: red
];
exports.UNKNOWN_PIN = '#8a8a8a';
function pinColor(typeMask) {
    if (typeMask === null)
        return exports.UNKNOWN_PIN;
    return exports.PIN_COLORS.find((p) => (typeMask & p.mask) !== 0)?.color ?? exports.UNKNOWN_PIN;
}
// Class-name patterns, first match wins. Texture comes before parameter so TextureSampleParameter2D is a texture.
exports.FAMILY_PATTERNS = [
    { family: 'texture', pattern: /TextureSample|TextureObject|TextureCoordinate/ },
    { family: 'parameter', pattern: /Parameter/ },
    { family: 'function', pattern: /FunctionInput|FunctionOutput|FunctionCall|MaterialFunction/ },
    { family: 'constant', pattern: /Constant/ },
    { family: 'math', pattern: /^MaterialExpression(Add|Multiply|Divide|Subtract|Lerp|Power|Dot|Cross|Normalize|Saturate|OneMinus|Clamp|Abs|Sqrt|Min|Max|Frac|Floor|Ceil|Round|Step|Smoothstep|ComponentMask|AppendVector|If)$/ },
    { family: 'utility', pattern: /Panner|Rotator|Time|Sine|Noise|Fresnel|Distance|Desaturation|Sphere|Camera|Vertex|Transform/ },
];
const FAMILY_COLORS = {
    parameter: '#d98a3d',
    texture: '#e0689a',
    math: '#6f9fd8',
    constant: '#8fd16b',
    utility: '#4fb3a9',
    function: '#a78bdb',
    other: '#8a8a8a',
};
function nodeFamily(cls) {
    return exports.FAMILY_PATTERNS.find((f) => f.pattern.test(cls))?.family ?? 'other';
}
function familyColor(f) {
    return FAMILY_COLORS[f];
}
//# sourceMappingURL=colors.js.map