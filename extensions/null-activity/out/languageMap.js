'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.languageId = languageId;
/** WakaTime display name → VS Code languageId, for names whose slug would not match the id. */
const KNOWN = {
    'C++': 'cpp',
    'C#': 'csharp',
    'F#': 'fsharp',
    'Objective-C++': 'objective-cpp',
    Batchfile: 'bat',
    Bash: 'shellscript',
    Text: 'plaintext',
    'Git Config': 'properties',
    'JSON with Comments': 'jsonc',
    TSConfig: 'jsonc',
    Docker: 'dockerfile',
    GDScript3: 'gdscript',
    XAML: 'xml',
    'Vue.js': 'vue',
};
function languageId(wakatimeName) {
    if (Object.prototype.hasOwnProperty.call(KNOWN, wakatimeName))
        return KNOWN[wakatimeName];
    return wakatimeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
//# sourceMappingURL=languageMap.js.map