const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateClassName(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'Class name cannot be empty.';
  }
  if (!VALID_NAME.test(trimmed)) {
    return 'Class name must start with a letter or underscore and contain only letters, numbers, and underscores.';
  }
  return undefined;
}

export function headerFileName(name: string): string {
  return `${name}.hpp`;
}

export function sourceFileName(name: string): string {
  return `${name}.cpp`;
}

export function headerContent(): string {
  return '#pragma once\n\n';
}

export function sourceContent(name: string): string {
  return `#include "${headerFileName(name)}"\n\n`;
}
