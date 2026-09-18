export interface SymbolPosition {
  line: number;
  character: number;
}

export interface SymbolRange {
  start: SymbolPosition;
  end: SymbolPosition;
}

export interface SymbolNode {
  name: string;
  range: SymbolRange;
  children: SymbolNode[];
}

export interface EnclosingSymbol {
  node: SymbolNode;
  qualifiedName: string;
}

function isPositionInRange(position: SymbolPosition, range: SymbolRange): boolean {
  if (position.line < range.start.line || position.line > range.end.line) {
    return false;
  }
  if (position.line === range.start.line && position.character < range.start.character) {
    return false;
  }
  if (position.line === range.end.line && position.character > range.end.character) {
    return false;
  }
  return true;
}

export function findEnclosingSymbol(
  symbols: SymbolNode[],
  position: SymbolPosition,
  ancestors: string[] = []
): EnclosingSymbol | undefined {
  for (const node of symbols) {
    if (!isPositionInRange(position, node.range)) {
      continue;
    }
    const qualifiedName = [...ancestors, node.name].join('::');
    const childMatch = findEnclosingSymbol(node.children, position, [...ancestors, node.name]);
    return childMatch ?? { node, qualifiedName };
  }
  return undefined;
}

export function findSymbolByQualifiedName(
  symbols: SymbolNode[],
  qualifiedName: string,
  ancestors: string[] = []
): SymbolNode | undefined {
  for (const node of symbols) {
    const nodeName = [...ancestors, node.name].join('::');
    if (nodeName === qualifiedName) {
      return node;
    }
    const childMatch = findSymbolByQualifiedName(node.children, qualifiedName, [...ancestors, node.name]);
    if (childMatch) {
      return childMatch;
    }
  }
  return undefined;
}
