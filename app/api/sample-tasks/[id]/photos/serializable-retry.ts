export async function withSamplePhotoSerializableRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if ((error as { code?: string }).code !== 'P2034' || attempt === maxAttempts) throw error;
    }
  }
  throw lastError;
}
