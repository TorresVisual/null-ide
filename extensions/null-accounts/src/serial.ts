'use strict';

/** Runs the tasks it is given one at a time, in order; a task that fails doesn't stop the ones queued behind it. */
export function serial(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return task => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}
