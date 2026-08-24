import { describe, it, expect, beforeEach } from "vitest";
import { BoundedCache } from "../geo/boundedCache";
import { classifyIpAddress, clearClassifierCache } from "../geo/ipClassifier";

describe("BoundedCache (Production-Ready O(1) True LRU)", () => {
  describe("Constructor & Validation", () => {
    it("initializes with given capacity and empty state", () => {
      const cache = new BoundedCache<string, number>(10);
      expect(cache.size()).toBe(0);
      expect(cache.maxSize()).toBe(10);
    });

    it("throws error for non-positive or non-integer maxSize", () => {
      expect(() => new BoundedCache<string, number>(0)).toThrow(/positive safe integer/);
      expect(() => new BoundedCache<string, number>(-5)).toThrow(/positive safe integer/);
      expect(() => new BoundedCache<string, number>(1.5)).toThrow(/positive safe integer/);
      expect(() => new BoundedCache<string, number>(NaN)).toThrow(/positive safe integer/);
      expect(() => new BoundedCache<string, number>(Infinity)).toThrow(/positive safe integer/);
    });
  });

  describe("Core LRU Operations & Edge Cases", () => {
    it("stores and retrieves items correctly", () => {
      const cache = new BoundedCache<string, string>(5);
      cache.set("k1", "v1");
      cache.set("k2", "v2");

      expect(cache.get("k1")).toBe("v1");
      expect(cache.get("k2")).toBe("v2");
      expect(cache.get("k3")).toBeUndefined();
      expect(cache.size()).toBe(2);
    });

    it("handles undefined and nullable stored values without losing recency tracking", () => {
      const cache = new BoundedCache<string, string | undefined | null>(3);
      cache.set("a", undefined);
      cache.set("b", null);
      cache.set("c", "value");

      expect(cache.has("a")).toBe(true);
      expect(cache.has("b")).toBe(true);
      expect(cache.get("a")).toBeUndefined(); // Returns stored undefined, refreshes 'a' to MRU

      // Insert 'd' -> 'b' (oldest) must be evicted, 'a' retained
      cache.set("d", "new");

      expect(cache.size()).toBe(3);
      expect(cache.has("b")).toBe(false); // 'b' evicted
      expect(cache.has("a")).toBe(true);  // 'a' retained
      expect(cache.has("c")).toBe(true);
      expect(cache.has("d")).toBe(true);
    });

    it("handles undefined / falsy keys without breaking iterator-based eviction", () => {
      const cache = new BoundedCache<unknown, string>(2);
      cache.set(undefined, "undefinedKey");
      cache.set("b", "bVal");

      // Cache is at capacity (2). Inserting 3rd element must evict undefined key
      cache.set("c", "cVal");

      expect(cache.size()).toBe(2);
      expect(cache.has(undefined)).toBe(false);
      expect(cache.get("b")).toBe("bVal");
      expect(cache.get("c")).toBe("cVal");
    });

    it("correctly handles maxSize = 1", () => {
      const cache = new BoundedCache<string, number>(1);
      cache.set("a", 1);
      expect(cache.get("a")).toBe(1);
      expect(cache.size()).toBe(1);

      cache.set("b", 2);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.size()).toBe(1);

      cache.set("b", 200);
      expect(cache.get("b")).toBe(200);
      expect(cache.size()).toBe(1);
    });

    it("checks existence via has() and deletes via delete()", () => {
      const cache = new BoundedCache<string, number>(5);
      cache.set("a", 1);
      expect(cache.has("a")).toBe(true);
      expect(cache.has("b")).toBe(false);

      expect(cache.delete("a")).toBe(true);
      expect(cache.has("a")).toBe(false);
      expect(cache.delete("a")).toBe(false);
      expect(cache.size()).toBe(0);
    });

    it("clears all entries on clear()", () => {
      const cache = new BoundedCache<string, number>(5);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBeUndefined();
    });

    it("peek() inspects values without altering recency order", () => {
      const cache = new BoundedCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // peek('a') should NOT promote 'a'
      expect(cache.peek("a")).toBe(1);
      expect(cache.peek("nonexistent")).toBeUndefined();

      // Insert 'd' -> 'a' must be evicted because peek didn't promote it
      cache.set("d", 4);

      expect(cache.size()).toBe(3);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });

    it("refreshes recency on get() (true LRU semantics)", () => {
      const cache = new BoundedCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // Access 'a' -> recency order becomes: b (oldest), c, a (newest)
      expect(cache.get("a")).toBe(1);

      // Insert 'd' -> 'b' must be evicted, NOT 'a'
      cache.set("d", 4);

      expect(cache.size()).toBe(3);
      expect(cache.get("b")).toBeUndefined(); // 'b' was evicted
      expect(cache.get("a")).toBe(1);          // 'a' retained
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);

      // Access 'c' -> recency order becomes: a, d, c
      expect(cache.get("c")).toBe(3);

      // Insert 'e' -> 'a' must be evicted
      cache.set("e", 5);
      expect(cache.size()).toBe(3);
      expect(cache.get("a")).toBeUndefined(); // 'a' evicted
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
      expect(cache.get("e")).toBe(5);
    });

    it("refreshes recency on set() for existing keys", () => {
      const cache = new BoundedCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // Update 'a' -> recency order becomes: b (oldest), c, a (newest)
      cache.set("a", 100);

      // Insert 'd' -> 'b' should be evicted
      cache.set("d", 4);

      expect(cache.size()).toBe(3);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("a")).toBe(100);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });

    it("does not refresh recency on has() check", () => {
      const cache = new BoundedCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // has('a') should NOT update recency order: 'a' remains oldest
      expect(cache.has("a")).toBe(true);

      // Insert 'd' -> 'a' should be evicted
      cache.set("d", 4);

      expect(cache.size()).toBe(3);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });
  });

  describe("Iteration & Map-Like Collection Support", () => {
    it("iterates in LRU-to-MRU order via entries(), keys(), values(), forEach, and Symbol.iterator", () => {
      const cache = new BoundedCache<string, number>(3);
      cache.set("x", 10);
      cache.set("y", 20);
      cache.set("z", 30);

      // Promote 'y' to MRU
      cache.get("y"); // Order is now: x, z, y

      expect([...cache.keys()]).toEqual(["x", "z", "y"]);
      expect([...cache.values()]).toEqual([10, 30, 20]);
      expect([...cache.entries()]).toEqual([
        ["x", 10],
        ["z", 30],
        ["y", 20],
      ]);
      expect([...cache]).toEqual([
        ["x", 10],
        ["z", 30],
        ["y", 20],
      ]);

      const visited: [string, number][] = [];
      cache.forEach((v, k) => visited.push([k, v]));
      expect(visited).toEqual([
        ["x", 10],
        ["z", 30],
        ["y", 20],
      ]);
    });
  });

  describe("Scale & Continuous Stream Turnover", () => {
    it("handles high turnover without exceeding capacity or churning all items", () => {
      const capacity = 100;
      const cache = new BoundedCache<number, number>(capacity);

      for (let i = 0; i < 1000; i++) {
        cache.set(i, i * 10);
        expect(cache.size()).toBeLessThanOrEqual(capacity);
      }

      expect(cache.size()).toBe(capacity);
      // Keys 900..999 must be present
      for (let i = 900; i < 1000; i++) {
        expect(cache.get(i)).toBe(i * 10);
      }
      // Older keys must have been evicted incrementally
      for (let i = 0; i < 900; i++) {
        expect(cache.get(i)).toBeUndefined();
      }
    });
  });
});

describe("IP Classification Bounded Cache", () => {
  beforeEach(() => {
    clearClassifierCache();
  });

  it("classifies and caches IP addresses with bounded eviction", () => {
    const r1 = classifyIpAddress("1.1.1.1");
    const r2 = classifyIpAddress("1.1.1.1");
    expect(r1).toBe(r2); // Same object reference returned from cache

    clearClassifierCache();
    const r3 = classifyIpAddress("1.1.1.1");
    expect(r3).toEqual(r1);
  });
});
