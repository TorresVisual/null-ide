const COMPILATION_DATABASE_RE = /^(\s*)CompilationDatabase:\s*.*$/;

function toYamlPath(binaryDir: string): string {
  return binaryDir.replace(/\\/g, '/');
}

/**
 * Computes the updated contents of a workspace-root `.clangd` so clangd always points at the
 * currently-selected preset's `compile_commands.json`. Only touches the `CompileFlags.
 * CompilationDatabase` key — any other content in the file (including hand-written CompileFlags
 * sub-keys) is preserved, since `.clangd` is a file the developer may otherwise edit by hand.
 */
export function updateClangdContent(existing: string | undefined, binaryDir: string): string {
  const dbPath = toYamlPath(binaryDir);
  const hasContent = existing !== undefined && existing.trim().length > 0;
  if (!hasContent) {
    return `CompileFlags:\n  CompilationDatabase: ${dbPath}\n`;
  }

  const lines = (existing as string).split(/\r?\n/);
  const flagsIndex = lines.findIndex((l) => l.trim() === 'CompileFlags:');
  if (flagsIndex === -1) {
    const trimmed = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
    return [...trimmed, 'CompileFlags:', `  CompilationDatabase: ${dbPath}`, ''].join('\n');
  }

  let blockEnd = flagsIndex + 1;
  while (blockEnd < lines.length && (lines[blockEnd].startsWith('  ') || lines[blockEnd].trim() === '')) {
    blockEnd++;
  }
  const block = lines.slice(flagsIndex + 1, blockEnd);
  const dbLineIndex = block.findIndex((l) => COMPILATION_DATABASE_RE.test(l));
  if (dbLineIndex !== -1) {
    const indent = COMPILATION_DATABASE_RE.exec(block[dbLineIndex])?.[1] ?? '  ';
    block[dbLineIndex] = `${indent}CompilationDatabase: ${dbPath}`;
  } else {
    block.push(`  CompilationDatabase: ${dbPath}`);
  }

  return [...lines.slice(0, flagsIndex + 1), ...block, ...lines.slice(blockEnd)].join('\n');
}
