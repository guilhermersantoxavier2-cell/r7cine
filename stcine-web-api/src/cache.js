'use strict';

/**
 * Cache leve em memória com expiração TTL e limite LRU simples.
 * Evita chamadas repetidas ao backend upstream e acelera a navegação Web.
 */
class MemoryCache {
  constructor(maxEntries = 600) {
    this.maxEntries = maxEntries;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    // Renova posição LRU
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlSeconds = 60) {
    if (ttlSeconds <= 0) return;
    if (this.store.has(key)) this.store.delete(key);
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  delete(key) {
    this.store.delete(key);
  }

  clearPrefix(prefix) {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  stats() {
    let active = 0;
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (now <= v.expiresAt) active++;
      else this.store.delete(k);
    }
    return { activeEntries: active, maxEntries: this.maxEntries };
  }
}

module.exports = { MemoryCache };
