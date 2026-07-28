import { InFlightCache } from './cache';

describe('InFlightCache', () => {
  it('deduplicates concurrent in-flight calls', async () => {
    const cache = new InFlightCache<number>();
    let calls = 0;
    let resolve!: (v: number) => void;
    const load = () => {
      calls++;
      return new Promise<number>((r) => {
        resolve = r;
      });
    };

    const p1 = cache.get('k', load);
    const p2 = cache.get('k', load);
    resolve(42);
    expect(await p1).toBe(42);
    expect(await p2).toBe(42);
    expect(calls).toBe(1); // load ran once for both callers
  });

  it('reloads once the previous call has settled (no stale serving)', async () => {
    const cache = new InFlightCache<number>();
    let calls = 0;
    const load = () => Promise.resolve(++calls);

    expect(await cache.get('k', load)).toBe(1);
    // the first load settled and was dropped, so the next call re-fetches
    expect(await cache.get('k', load)).toBe(2);
  });

  it('does not retain rejections', async () => {
    const cache = new InFlightCache<number>();
    let calls = 0;
    const load = () => {
      calls++;
      return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(99);
    };

    await expect(cache.get('k', load)).rejects.toThrow('boom');
    expect(await cache.get('k', load)).toBe(99); // retried, failure not retained
  });
});
