/**
 * Fixed-capacity circular ring buffer ensuring flat memory allocations
 * and preventing GC pauses during long telemetry sessions.
 */
export class CircularBuffer<T> {
  private buffer: Array<T | undefined>;
  private head = 0;
  private tail = 0;
  private size = 0;
  public readonly capacity: number;

  constructor(capacity: number = 300) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  public push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;

    if (this.size < this.capacity) {
      this.size++;
    } else {
      this.tail = (this.tail + 1) % this.capacity;
    }
  }

  public toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.size; i++) {
      const idx = (this.tail + i) % this.capacity;
      const val = this.buffer[idx];
      if (val !== undefined) {
        result.push(val);
      }
    }
    return result;
  }

  public peekLast(): T | undefined {
    if (this.size === 0) return undefined;
    const lastIdx = (this.head - 1 + this.capacity) % this.capacity;
    return this.buffer[lastIdx];
  }

  public clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  public getSize(): number {
    return this.size;
  }
}
