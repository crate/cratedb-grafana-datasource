// in-flight coalescing: concurrent callers for a key share one pending promise,
// dropped once it settles. No frontend TTL — freshness is the backend cache's job.
export class InFlightCache<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  get(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }
    const promise = load().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }
}
