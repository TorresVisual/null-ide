import * as vscode from 'vscode';
import { EnclosingSymbol, SymbolNode, findEnclosingSymbol, findSymbolByQualifiedName } from './symbolTree';

interface CacheEntry {
  version: number;
  symbols: SymbolNode[];
}

const cache = new Map<string, CacheEntry>();

function toSymbolNode(symbol: vscode.DocumentSymbol): SymbolNode {
  return {
    name: symbol.name,
    range: {
      start: { line: symbol.range.start.line, character: symbol.range.start.character },
      end: { line: symbol.range.end.line, character: symbol.range.end.character },
    },
    children: symbol.children.map(toSymbolNode),
  };
}

export async function getSymbols(doc: vscode.TextDocument): Promise<SymbolNode[]> {
  const key = doc.uri.toString();
  const cached = cache.get(key);
  if (cached && cached.version === doc.version) {
    return cached.symbols;
  }

  // clangd's provider always returns hierarchical DocumentSymbol, never flat SymbolInformation.
  const result = (await vscode.commands.executeCommand(
    'vscode.executeDocumentSymbolProvider',
    doc.uri
  )) as vscode.DocumentSymbol[] | undefined;

  const symbols = (result ?? []).map(toSymbolNode);
  cache.set(key, { version: doc.version, symbols });
  return symbols;
}

export function invalidate(uri: vscode.Uri): void {
  cache.delete(uri.toString());
}

export async function findEnclosing(
  doc: vscode.TextDocument,
  position: vscode.Position
): Promise<EnclosingSymbol | undefined> {
  const symbols = await getSymbols(doc);
  return findEnclosingSymbol(symbols, { line: position.line, character: position.character });
}

export async function findByQualifiedName(
  doc: vscode.TextDocument,
  qualifiedName: string
): Promise<SymbolNode | undefined> {
  const symbols = await getSymbols(doc);
  return findSymbolByQualifiedName(symbols, qualifiedName);
}
