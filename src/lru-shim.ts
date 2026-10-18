/**
 * Baileys builds its caches with `ttlAutopurge: true`, which gives lru-cache one
 * setTimeout per entry. workerd allows 10,000 pending timers per object, and the
 * first history sync blows through that. Without autopurge, expired entries are
 * still dropped lazily on access, which is all these caches need.
 */
import { LRUCache as Base } from '../node_modules/lru-cache/dist/esm/index.js';

export class LRUCache<K extends {}, V extends {}, FC = unknown> extends Base<K, V, FC> {
  constructor(options: any) {
    super({ ...options, ttlAutopurge: false });
  }
}
export default LRUCache;
