/**
 * Production-ready Bounded O(1) LRU (Least Recently Used) Cache backed by JavaScript Map.
 *
 * In ECMAScript, Map maintains elements in strict insertion order:
 * - On `get(key)`: if present, the entry is re-inserted so it becomes the
 *   most-recently-used (MRU) element at the tail of the Map.
 * - On `set(key, val)`: if `key` already exists, it is re-inserted at MRU.
 *   If `key` is new and `size >= maxSize`, the least-recently-used (LRU) element
 *   at the head (`map.keys().next().value`) is evicted in $O(1)$ time.
 * - On `peek(key)`: reads value without altering recency order.
 * - Guarantees zero large cache-churn spikes, strictly bounded memory, and full
 *   compatibility with nullable/undefined values and arbitrary key types.
 */
export class BoundedCache<K, V> implements Iterable<[K, V]> {
  private readonly max: number;
  private readonly map: Map<K, V> = new Map<K, V>();

  constructor(maxSize = 32768) {
    if (!Number.isSafeInteger(maxSize) || maxSize <= 0) {
      throw new Error(
        `[BoundedCache] maxSize must be a positive safe integer, received: ${String(maxSize)}`
      );
    }
    this.max = maxSize;
  }

  /**
   * Retrieves a cached value for `key` and refreshes its recency to MRU.
   * Returns `undefined` if the key is not present.
   */
  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined;
    }
    const val = this.map.get(key) as V;
    // Re-insert to promote to Most Recently Used (MRU) position
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  /**
   * Inserts or updates `key` with `val`, promoting it to MRU.
   * Evicts the single oldest (LRU) entry in $O(1)$ if capacity is exceeded.
   */
  set(key: K, val: V): this {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.max) {
      const iter = this.map.keys().next();
      if (!iter.done) {
        this.map.delete(iter.value);
      }
    }
    this.map.set(key, val);
    return this;
  }

  /**
   * Retrieves a cached value without altering recency order (non-mutating inspect).
   */
  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  /**
   * Returns true if `key` exists in the cache without altering recency order.
   */
  has(key: K): boolean {
    return this.map.has(key);
  }

  /**
   * Removes a specific key from the cache.
   * Returns true if an element in the Map existed and has been removed, or false if it did not.
   */
  delete(key: K): boolean {
    return this.map.delete(key);
  }

  /**
   * Clears all entries from the cache.
   */
  clear(): void {
    this.map.clear();
  }

  /**
   * Returns the current number of cached entries.
   */
  size(): number {
    return this.map.size;
  }

  /**
   * Returns the maximum capacity limit.
   */
  maxSize(): number {
    return this.max;
  }

  /**
   * Returns an iterable iterator of [key, value] pairs in LRU-to-MRU order.
   */
  entries(): IterableIterator<[K, V]> {
    return this.map.entries();
  }

  /**
   * Returns an iterable iterator of keys in LRU-to-MRU order.
   */
  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  /**
   * Returns an iterable iterator of values in LRU-to-MRU order.
   */
  values(): IterableIterator<V> {
    return this.map.values();
  }

  /**
   * Executes a provided function once per each key/value pair in LRU-to-MRU order.
   */
  forEach(callbackfn: (value: V, key: K, map: BoundedCache<K, V>) => void): void {
    for (const [k, v] of this.map) {
      callbackfn(v, k, this);
    }
  }

  /**
   * Default iterator implementation yielding [key, value] pairs in LRU-to-MRU order.
   */
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.map[Symbol.iterator]();
  }
}
