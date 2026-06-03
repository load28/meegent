import { computeFileHash } from "./format.js";

/** Stores file content seen this session, keyed by `path#TAG`, for stale-tag 3-way recovery. */
export interface SnapshotStore {
  /** Record content under its own computed tag (called on read and after each successful edit). */
  record(path: string, content: string): void;
  /** Look up the content a given tag was minted from, if still retained. */
  lookup(path: string, tag: string): string | undefined;
}

/** Create a bounded snapshot store (oldest entries evicted past `max`). */
export function createSnapshotStore(max = 64): SnapshotStore {
  const map = new Map<string, string>();
  return {
    record(path, content) {
      const key = `${path}#${computeFileHash(content)}`;
      map.delete(key); // refresh recency
      map.set(key, content);
      while (map.size > max) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
    lookup(path, tag) {
      return map.get(`${path}#${tag}`);
    },
  };
}

/** Process-wide snapshot store shared by the read-view hook, the hashedit tool, and diff preview. */
export const snapshots = createSnapshotStore();
