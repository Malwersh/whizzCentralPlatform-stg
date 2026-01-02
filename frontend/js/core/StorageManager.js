// Persistence Layer for OOP Architecture
// Goal: Centralized localStorage management with encryption and data integrity
(function (global) {
  class StorageManager {
    constructor() {
      this.prefix = 'supportApp_';
      this.encryptionKey = this._generateKey();
      this.maxAge = 24 * 60 * 60 * 1000; // 24 hours default
      this.compressionThreshold = 1024; // Compress data > 1KB
    }

    // Core Storage Operations
    set(key, value, options = {}) {
      try {
        const data = {
          value,
          timestamp: Date.now(),
          expires: options.maxAge ? Date.now() + options.maxAge : Date.now() + this.maxAge,
          compressed: false,
          encrypted: options.encrypt || false
        };

        let serialized = JSON.stringify(data.value);

        // Compression for large data
        if (serialized.length > this.compressionThreshold) {
          serialized = this._compress(serialized);
          data.compressed = true;
        }

        // Encryption if requested
        if (data.encrypted) {
          serialized = this._encrypt(serialized);
        }

        data.value = serialized;
        const finalData = JSON.stringify(data);

        localStorage.setItem(this.prefix + key, finalData);
        return true;
      } catch (error) {
        console.warn(`[StorageManager] Failed to set ${key}:`, error);
        return false;
      }
    }

    get(key, defaultValue = null) {
      try {
        const raw = localStorage.getItem(this.prefix + key);
        if (!raw) return defaultValue;

        const data = JSON.parse(raw);

        // Check expiration
        if (data.expires && Date.now() > data.expires) {
          this.remove(key);
          return defaultValue;
        }

        let value = data.value;

        // Decrypt if needed
        if (data.encrypted) {
          value = this._decrypt(value);
        }

        // Decompress if needed
        if (data.compressed) {
          value = this._decompress(value);
        }

        // Parse back to original format
        if (typeof value === 'string' && value !== data.value) {
          value = JSON.parse(value);
        }

        return value;
      } catch (error) {
        console.warn(`[StorageManager] Failed to get ${key}:`, error);
        return defaultValue;
      }
    }

    remove(key) {
      try {
        localStorage.removeItem(this.prefix + key);
        return true;
      } catch (error) {
        console.warn(`[StorageManager] Failed to remove ${key}:`, error);
        return false;
      }
    }

    // Batch Operations
    setMultiple(items, options = {}) {
      const results = {};
      for (const [key, value] of Object.entries(items)) {
        results[key] = this.set(key, value, options);
      }
      return results;
    }

    getMultiple(keys, defaultValue = null) {
      const results = {};
      keys.forEach(key => {
        results[key] = this.get(key, defaultValue);
      });
      return results;
    }

    // Specialized Methods for Support App
    saveChatSessions(sessions) {
      const sessionData = Array.from(sessions.entries()).map(([id, session]) => ({
        id,
        ...session,
        // Don't persist all messages for performance, just recent ones
        messages: session.messages.slice(-50)
      }));

      return this.set('chatSessions', sessionData, { maxAge: 4 * 60 * 60 * 1000 }); // 4 hours
    }

    loadChatSessions() {
      const sessionData = this.get('chatSessions', []);
      const sessions = new Map();

      sessionData.forEach(session => {
        sessions.set(session.id, {
          ...session,
          messages: session.messages || []
        });
      });

      return sessions;
    }

    saveThemePreference(themeName) {
      return this.set('theme', themeName, { maxAge: 365 * 24 * 60 * 60 * 1000 }); // 1 year
    }

    loadThemePreference() {
      return this.get('theme', 'light');
    }

    saveUserPreferences(preferences) {
      const existing = this.get('userPreferences', {});
      const updated = { ...existing, ...preferences, lastUpdated: Date.now() };
      return this.set('userPreferences', updated, { maxAge: 30 * 24 * 60 * 60 * 1000 }); // 30 days
    }

    loadUserPreferences() {
      return this.get('userPreferences', {
        notifications: true,
        autoRefresh: true,
        compactMode: false,
        soundEnabled: true
      });
    }

    saveUnreadCounts(counts) {
      return this.set('unreadCounts', counts, { maxAge: 24 * 60 * 60 * 1000 }); // 24 hours
    }

    loadUnreadCounts() {
      return this.get('unreadCounts', {});
    }

    // Cache Management
    clearExpired() {
      let cleared = 0;
      const keys = this._getAllKeys();

      keys.forEach(key => {
        try {
          const raw = localStorage.getItem(key);
          if (!raw) return;

          const data = JSON.parse(raw);
          if (data.expires && Date.now() > data.expires) {
            localStorage.removeItem(key);
            cleared++;
          }
        } catch (error) {
          // Invalid data, remove it
          localStorage.removeItem(key);
          cleared++;
        }
      });

      console.log(`[StorageManager] Cleared ${cleared} expired items`);
      return cleared;
    }

    getStorageInfo() {
      const keys = this._getAllKeys();
      let totalSize = 0;
      const itemInfo = {};

      keys.forEach(fullKey => {
        const key = fullKey.replace(this.prefix, '');
        const value = localStorage.getItem(fullKey);
        const size = new Blob([value]).size;
        totalSize += size;

        try {
          const data = JSON.parse(value);
          itemInfo[key] = {
            size,
            created: new Date(data.timestamp).toISOString(),
            expires: data.expires ? new Date(data.expires).toISOString() : 'Never',
            compressed: data.compressed,
            encrypted: data.encrypted
          };
        } catch {
          itemInfo[key] = { size, error: 'Invalid data format' };
        }
      });

      return {
        totalItems: keys.length,
        totalSize,
        items: itemInfo,
        quota: this._getStorageQuota()
      };
    }

    // Utility Methods
    _getAllKeys() {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this.prefix)) {
          keys.push(key);
        }
      }
      return keys;
    }

    _getStorageQuota() {
      try {
        const test = 'storage-quota-test';
        let size = 0;

        // Rough estimation of available space
        try {
          for (let i = 0; i < 10000; i++) {
            localStorage.setItem(test + i, '0'.repeat(1000));
            size += 1000;
          }
        } catch {
          // Hit quota, clean up test data
          for (let i = 0; i < 10000; i++) {
            localStorage.removeItem(test + i);
          }
        }

        return { estimated: size, available: true };
      } catch {
        return { estimated: 0, available: false };
      }
    }

    _generateKey() {
      // Simple key generation for basic encryption
      return btoa(Math.random().toString(36) + Date.now()).slice(0, 16);
    }

    _encrypt(text) {
      // Basic XOR encryption (not cryptographically secure, just obfuscation)
      return btoa(text.split('').map((char, i) =>
        String.fromCharCode(char.charCodeAt(0) ^ this.encryptionKey.charCodeAt(i % this.encryptionKey.length))
      ).join(''));
    }

    _decrypt(encrypted) {
      try {
        const text = atob(encrypted);
        return text.split('').map((char, i) =>
          String.fromCharCode(char.charCodeAt(0) ^ this.encryptionKey.charCodeAt(i % this.encryptionKey.length))
        ).join('');
      } catch {
        return encrypted;
      }
    }

    _compress(text) {
      // Simple compression using repeated character encoding
      return text.replace(/(.)\1+/g, (match, char) =>
        match.length > 3 ? `${char}*${match.length}` : match
      );
    }

    _decompress(compressed) {
      // Decompress simple encoding
      return compressed.replace(/(.)\*(\d+)/g, (match, char, count) =>
        char.repeat(parseInt(count))
      );
    }

    // Migration support
    migrate(oldVersion, newVersion) {
      console.log(`[StorageManager] Migrating data from v${oldVersion} to v${newVersion}`);

      // Add migration logic here as needed
      switch (newVersion) {
        case '2.0.0':
          // Example: rename old keys
          const oldTheme = localStorage.getItem('theme');
          if (oldTheme) {
            this.set('theme', oldTheme);
            localStorage.removeItem('theme');
          }
          break;
      }

      this.set('dataVersion', newVersion);
    }
  }

  global.StorageManager = new StorageManager();

  // Auto-cleanup expired items on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      global.StorageManager.clearExpired();
    });
  } else {
    global.StorageManager.clearExpired();
  }

  console.log('[StorageManager] Persistence layer initialized');
})(window);
