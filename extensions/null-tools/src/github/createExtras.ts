'use strict';

export interface CreateExtraStep { what: string; run: () => Promise<unknown>; }

/**
 * Runs the steps that follow the REST create call (set the type, link the parent). A failing step never stops the
 * rest and never throws: it is reported by name, so a created issue is never lost to a half-applied form.
 */
export async function runCreateExtras(steps: CreateExtraStep[]): Promise<string[]> {
  const problems: string[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch (err) {
      problems.push(`couldn't ${step.what} (${(err as Error).message})`);
    }
  }
  return problems;
}
