"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAIN_CPP_CONTENT = void 0;
exports.cmakeListsContent = cmakeListsContent;
exports.nestedCMakeListsContent = nestedCMakeListsContent;
exports.appendAddSubdirectory = appendAddSubdirectory;
exports.slugifyToolchainId = slugifyToolchainId;
exports.presetFor = presetFor;
exports.presetsJsonContent = presetsJsonContent;
function cmakeListsContent(projectName) {
    const sourcesVar = `${projectName.toUpperCase()}_SOURCES`;
    return `cmake_minimum_required(VERSION 3.20)
project(${projectName} CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

file(GLOB_RECURSE ${sourcesVar} CONFIGURE_DEPENDS "src/*.cpp")
add_executable(${projectName} \${${sourcesVar}})
target_include_directories(${projectName} PRIVATE src)
`;
}
exports.MAIN_CPP_CONTENT = 'int main() {\n    return 0;\n}\n';
/** For a folder nested under an existing CMake project: a library target, not a standalone project(). */
function nestedCMakeListsContent(targetName) {
    const sourcesVar = `${targetName.toUpperCase()}_SOURCES`;
    return `file(GLOB_RECURSE ${sourcesVar} CONFIGURE_DEPENDS "*.cpp")
add_library(${targetName} STATIC \${${sourcesVar}})
target_include_directories(${targetName} PUBLIC \${CMAKE_CURRENT_SOURCE_DIR})
`;
}
/** Wires a nested module into its parent CMakeLists.txt; no-op if already present. */
function appendAddSubdirectory(parentContent, relativeDir) {
    const posixDir = relativeDir.replace(/\\/g, '/');
    const escaped = posixDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`add_subdirectory\\(\\s*${escaped}\\s*\\)`).test(parentContent)) {
        return parentContent;
    }
    return `${parentContent.replace(/\n+$/, '')}\nadd_subdirectory(${posixDir})\n`;
}
/** CMake preset names must be simple tokens for `cmake --preset <name>` — slugify the toolchain id. */
function slugifyToolchainId(id) {
    return id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function presetFor(toolchain) {
    const isWsl = toolchain.kind === 'wsl-gcc' || toolchain.kind === 'wsl-clang';
    const name = `${slugifyToolchainId(toolchain.id)}-debug`;
    return {
        name,
        displayName: `${toolchain.displayName} Debug`,
        generator: isWsl ? 'Unix Makefiles' : 'Ninja',
        binaryDir: `\${sourceDir}/build/${name}`,
        cacheVariables: {
            CMAKE_BUILD_TYPE: 'Debug',
            CMAKE_CXX_COMPILER: toolchain.compilerPath,
            // clangd needs compile_commands.json — force it on even for hand-written CMakeLists.txt
            // (like shell-ext's) that predate this generator and never set it themselves.
            CMAKE_EXPORT_COMPILE_COMMANDS: 'ON',
        },
    };
}
function presetsJsonContent(toolchains) {
    return `${JSON.stringify({ version: 3, configurePresets: toolchains.map(presetFor) }, null, 2)}\n`;
}
//# sourceMappingURL=cmakeScaffoldContent.js.map