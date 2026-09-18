export class PairRegistry {
  private pairs = new Map<string, string>();

  record(uriA: string, uriB: string): void {
    this.pairs.set(uriA, uriB);
    this.pairs.set(uriB, uriA);
  }

  getCounterpart(uri: string): string | undefined {
    return this.pairs.get(uri);
  }

  has(uri: string): boolean {
    return this.pairs.has(uri);
  }

  remove(uri: string): void {
    const counterpart = this.pairs.get(uri);
    this.pairs.delete(uri);
    if (counterpart !== undefined) {
      this.pairs.delete(counterpart);
    }
  }
}
