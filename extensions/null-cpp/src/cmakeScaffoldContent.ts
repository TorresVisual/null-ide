import type { Toolchain } from './toolchainRegistry';

export function cmakeListsContent(projectName: string): string {
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

export const MAIN_CPP_CONTENT = 'int main() {\n    return 0;\n}\n';

/** CMake preset names must be simple tokens for `cmake --preset <name>` — slugify the toolchain id. */
export function slugifyToolchainId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function presetFor(toolchain: Toolchain): Record<string, unknown> {
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
    },
  };
}

export function presetsJsonContent(toolchains: Toolchain[]): string {
  return `${JSON.stringify({ version: 3, configurePresets: toolchains.map(presetFor) }, null, 2)}\n`;
}
