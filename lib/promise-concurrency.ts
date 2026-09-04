type AsyncTask = () => Promise<unknown>;

type TaskResults<T extends readonly AsyncTask[]> = {
  [K in keyof T]: Awaited<ReturnType<T[K]>>;
};

/**
 * Run independent asynchronous work without letting a single request fan out
 * across the entire database pool. Results retain the same order as tasks.
 * After a failure, already-started tasks are drained, no new task is claimed,
 * and the first rejection is rethrown.
 */
export async function runTasksWithConcurrencyLimit<const T extends readonly AsyncTask[]>(
  limit: number,
  tasks: T,
): Promise<TaskResults<T>> {
  if (!tasks.length) return [] as unknown as TaskResults<T>;
  const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit) : 1;
  const concurrency = Math.min(tasks.length, Math.max(1, normalizedLimit));
  const results: unknown[] = new Array(tasks.length);
  let nextIndex = 0;
  let failed = false;
  let firstError: unknown;

  const worker = async (): Promise<void> => {
    while (!failed) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) return;
      try {
        results[index] = await tasks[index]();
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (failed) throw firstError;
  return results as TaskResults<T>;
}
