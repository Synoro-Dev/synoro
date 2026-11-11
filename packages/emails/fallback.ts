export type Provider<T> = {
  name: string;
  send: (message: T) => Promise<unknown>;
};

/**
 * Tries the providers in order and stops at the first that sends. Throws the
 * last error when every one failed, so the caller (`send-email`) retries.
 */
export async function sendWithFallback<T>(
  providers: Provider<T>[],
  message: T,
  onFailure: (failed: string, next: string | null, error: unknown) => void,
) {
  let lastError: unknown;
  for (const [i, provider] of providers.entries()) {
    try {
      await provider.send(message);
      return;
    } catch (error) {
      lastError = error;
      onFailure(provider.name, providers[i + 1]?.name ?? null, error);
    }
  }
  throw lastError;
}
