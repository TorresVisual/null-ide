'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectSuggestedButtons = detectSuggestedButtons;
const SUGGESTIONS_BY_MANIFEST = {
    'Cargo.toml': [
        { id: 'cargo-run', label: 'cargo run', command: 'cargo run', icon: 'play' },
        { id: 'cargo-build', label: 'cargo build', command: 'cargo build', icon: 'tools' },
        { id: 'cargo-test', label: 'cargo test', command: 'cargo test', icon: 'beaker' },
    ],
    'CMakeLists.txt': [
        { id: 'cmake-configure', label: 'cmake configure', command: 'cmake -B build', icon: 'gear' },
        { id: 'cmake-build', label: 'cmake build', command: 'cmake --build build', icon: 'tools' },
    ],
    '.csproj': [
        { id: 'dotnet-build', label: 'dotnet build', command: 'dotnet build', icon: 'tools' },
        { id: 'dotnet-run', label: 'dotnet run', command: 'dotnet run', icon: 'play' },
    ],
};
/** Which manifests exist is null-env's job (`detect`); this only maps them to buttons. */
function detectSuggestedButtons(folderPath, detect) {
    return detect(folderPath).flatMap(project => SUGGESTIONS_BY_MANIFEST[project.manifest] ?? []);
}
//# sourceMappingURL=projectDetector.js.map