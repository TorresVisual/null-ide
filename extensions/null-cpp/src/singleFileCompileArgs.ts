import * as path from 'node:path';
import { toWslPath } from './wslPath';

export interface CompileArgsOptions {
  filePath: string;
  sourceDir?: string;
  extraArgs?: string[];
  includeDirs?: string[];
  outputBinaryPath?: string;
  syntaxOnly?: boolean;
  isWsl?: boolean;
}

const HEADER_EXTENSIONS = new Set(['.h', '.hpp', '.hxx', '.hh', '.h++', '.inl', '.tcc']);

export function isHeaderFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return HEADER_EXTENSIONS.has(ext);
}

export function resolveOutputBinaryPath(filePath: string, isWsl: boolean, outputDir?: string): string {
  const ext = path.extname(filePath);
  const baseName = path.basename(filePath, ext);
  const targetDir = outputDir ? outputDir : path.dirname(filePath);
  const binaryExt = isWsl ? '' : '.exe';
  return path.join(targetDir, `${baseName}${binaryExt}`);
}

export function buildCompileArgs(options: CompileArgsOptions): string[] {
  const isWsl = options.isWsl ?? false;
  const isHeader = isHeaderFile(options.filePath);
  const syntaxOnly = options.syntaxOnly ?? isHeader;

  const defaultFlags = ['-std=c++20', '-Wall', '-Wextra'];
  const userFlags = options.extraArgs && options.extraArgs.length > 0 ? options.extraArgs : defaultFlags;
  const args = [...userFlags];

  if (syntaxOnly) {
    if (!args.includes('-fsyntax-only')) {
      args.push('-fsyntax-only');
    }
  } else if (options.outputBinaryPath) {
    const outPath = isWsl ? toWslPath(options.outputBinaryPath) : options.outputBinaryPath;
    args.push('-o', outPath);
  }

  // Include current file's directory
  const fileDir = path.dirname(options.filePath);
  const fileDirArg = isWsl ? toWslPath(fileDir) : fileDir;
  args.push(`-I${fileDirArg}`);

  // Include workspace source dir
  if (options.sourceDir && options.sourceDir !== fileDir) {
    const srcDirArg = isWsl ? toWslPath(options.sourceDir) : options.sourceDir;
    args.push(`-I${srcDirArg}`);
  }

  // Include optional extra include paths
  if (options.includeDirs) {
    for (const inc of options.includeDirs) {
      const incArg = isWsl ? toWslPath(inc) : inc;
      args.push(`-I${incArg}`);
    }
  }

  // Input file path
  const inputArg = isWsl ? toWslPath(options.filePath) : options.filePath;
  args.push(inputArg);

  return args;
}
