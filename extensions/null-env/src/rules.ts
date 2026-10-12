import type { Requirement } from './types';

const install = (extensionId: string) => ({ kind: 'install', extensionId }) as const;
const url = (u: string) => ({ kind: 'url', url: u }) as const;

export const RULES: readonly Requirement[] = [
  // C / C++
  { id: 'ext.clangd', label: 'clangd extension', languages: ['cpp'], kind: 'extension', anyOf: ['llvm-vs-code-extensions.vscode-clangd'], severity: 'required', fix: install('llvm-vs-code-extensions.vscode-clangd') },
  { id: 'ext.cpptools', label: 'C/C++ (cpptools) extension', languages: ['cpp'], kind: 'extension', anyOf: ['ms-vscode.cpptools'], severity: 'required', fix: install('ms-vscode.cpptools') },
  { id: 'ext.codelldb', label: 'CodeLLDB extension', languages: ['cpp'], kind: 'extension', anyOf: ['vadimcn.vscode-lldb'], severity: 'required', fix: install('vadimcn.vscode-lldb') },
  { id: 'tool.cmake', label: 'cmake', languages: ['cpp'], kind: 'tool', anyOf: ['cmake'], severity: 'required', fix: url('https://cmake.org/download/') },
  // The clangd extension can download clangd itself, so a missing binary is only a recommendation.
  { id: 'tool.clangd', label: 'clangd', languages: ['cpp'], kind: 'tool', anyOf: ['clangd'], severity: 'recommended', fix: url('https://clangd.llvm.org/installation') },
  // MSVC presets debug through CodeLLDB and need neither; native Clang/GCC presets need gdb.
  { id: 'tool.debugger', label: 'gdb or lldb', languages: ['cpp'], kind: 'tool', anyOf: ['gdb', 'lldb'], severity: 'recommended', fix: url('https://www.msys2.org/') },
  { id: 'tool.clang-format', label: 'clang-format', languages: ['cpp'], kind: 'tool', anyOf: ['clang-format'], severity: 'recommended', fix: url('https://github.com/llvm/llvm-project/releases') },
  // Rust
  { id: 'ext.rust-analyzer', label: 'rust-analyzer extension', languages: ['rust'], kind: 'extension', anyOf: ['rust-lang.rust-analyzer'], severity: 'required', fix: install('rust-lang.rust-analyzer') },
  { id: 'tool.cargo', label: 'cargo', languages: ['rust'], kind: 'tool', anyOf: ['cargo'], severity: 'required', fix: url('https://rustup.rs/') },
  { id: 'tool.rustfmt', label: 'rustfmt', languages: ['rust'], kind: 'tool', anyOf: ['rustfmt'], severity: 'required', fix: url('https://rustup.rs/') },
  // Node
  { id: 'tool.node', label: 'node', languages: ['node'], kind: 'tool', anyOf: ['node'], severity: 'required', fix: url('https://nodejs.org/en/download') },
  // Every workspace: Null IDE's AI workflow
  { id: 'ext.claude-code', label: 'Claude Code extension', languages: 'all', kind: 'extension', anyOf: ['anthropic.claude-code'], severity: 'recommended', fix: install('anthropic.claude-code') },
  { id: 'tool.claude', label: 'claude CLI', languages: 'all', kind: 'tool', anyOf: ['claude'], severity: 'recommended', fix: url('https://docs.claude.com/en/docs/claude-code/setup') },
];

const DEBUG_TYPE_EXTENSIONS = new Map<string, { extensionId: string; label: string }>([
  ['lldb', { extensionId: 'vadimcn.vscode-lldb', label: 'CodeLLDB' }],
  ['cppdbg', { extensionId: 'ms-vscode.cpptools', label: 'C/C++ (cpptools)' }],
]);

/** The extension that provides debug type `type` for the configs null-cpp synthesizes; undefined for any other type. */
export function debugExtensionFor(type: string): { extensionId: string; label: string } | undefined {
  return DEBUG_TYPE_EXTENSIONS.get(type);
}
