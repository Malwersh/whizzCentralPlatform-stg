/**
 * WebSocket Compatibility Shim - Connection Deduplication
 * 
 * Ensures all `new WebSocket(url)` calls for the same URL share one underlying socket.
 * Preserves native API: onopen/onmessage/onerror/onclose, addEventListener/removeEventListener, send, close, readyState.
 * 
 * Feature flag: window.WS_DEDUP (default: true)
 */

(function () {
  'use strict';
  
  // Feature flag to enable/disable dedup without changing callers
  const ENABLE_DEDUP = (window.WS_DEDUP !== false);
  
  if (!ENABLE_DEDUP || !window.WebSocket) {
    console.log('🔌 WebSocket dedup shim: DISABLED');
    return;
  }

  const NativeWS = window.WebSocket;
  const pool = new Map(); // url -> PoolEntry
  
  console.log('🔌 WebSocket dedup shim: ENABLED');

  class PoolEntry {
    constructor(url) {
      this.url = url;
      this.ws = null;
      this.refs = new Set(); // Set of VirtualSocket instances
      this.listeners = new Map([
        ['open', new Set()], 
        ['message', new Set()], 
        ['error', new Set()], 
        ['close', new Set()]
      ]);
      this.userCount = 0;
      this.sendQueue = [];
      this.backoff = 1000;
      this.maxBackoff = 30000;
      this.reconnectTimer = null;
      
      this.connect();
    }

    connect() {
      try {
        console.log(`🔌 Creating native WebSocket for: ${this.url}`);
        this.ws = new NativeWS(this.url);
        this.setupEventHandlers();
      } catch (e) {
        console.error('🔌 WebSocket creation failed:', e);
        this.scheduleReconnect();
      }
    }

    setupEventHandlers() {
      const ws = this.ws;
      
      ws.addEventListener('open', (ev) => {
        console.log(`🔌 WebSocket connected: ${this.url}`);
        this.backoff = 1000; // Reset backoff on successful connection
        this.flushSendQueue();
        this.dispatch('open', ev);
      });

      ws.addEventListener('message', (ev) => {
        this.dispatch('message', ev);
      });

      ws.addEventListener('error', (ev) => {
        console.warn(`🔌 WebSocket error: ${this.url}`, ev);
        this.dispatch('error', ev);
      });

      ws.addEventListener('close', (ev) => {
        console.log(`🔌 WebSocket closed: ${this.url}`, ev.code, ev.reason);
        this.dispatch('close', ev);
        
        // Auto-reconnect if we still have active refs
        if (this.refs.size > 0) {
          this.scheduleReconnect();
        }
      });
    }

    dispatch(type, event) {
      // Dispatch to addEventListener handlers
      const listenerSet = this.listeners.get(type);
      if (listenerSet) {
        listenerSet.forEach(fn => {
          try { fn(event); } catch (e) { console.error('🔌 Listener error:', e); }
        });
      }

      // Dispatch to property-style handlers on virtual sockets
      this.refs.forEach(virtualSocket => {
        const handler = virtualSocket['on' + type];
        if (typeof handler === 'function') {
          try { handler(event); } catch (e) { console.error('🔌 Handler error:', e); }
        }
      });
    }

    flushSendQueue() {
      if (!this.ws || this.ws.readyState !== NativeWS.OPEN) return;
      
      while (this.sendQueue.length > 0) {
        const data = this.sendQueue.shift();
        try {
          this.ws.send(data);
        } catch (e) {
          console.error('🔌 Failed to send queued message:', e);
          break;
        }
      }
    }

    scheduleReconnect() {
      if (this.reconnectTimer) return; // Already scheduled
      
      console.log(`🔌 Scheduling reconnect in ${this.backoff}ms for: ${this.url}`);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, this.backoff);
      
      this.backoff = Math.min(this.backoff * 2, this.maxBackoff);
    }

    addRef(virtualSocket) {
      this.refs.add(virtualSocket);
      this.userCount++;
      console.log(`🔌 Added ref for ${this.url}. Total refs: ${this.refs.size}`);
    }

    removeRef(virtualSocket) {
      if (this.refs.has(virtualSocket)) {
        this.refs.delete(virtualSocket);
        this.userCount = Math.max(0, this.userCount - 1);
        console.log(`🔌 Removed ref for ${this.url}. Total refs: ${this.refs.size}`);
        
        // Close underlying socket if no more refs
        if (this.refs.size === 0) {
          console.log(`🔌 No more refs, closing underlying socket: ${this.url}`);
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          if (this.ws && this.ws.readyState < NativeWS.CLOSING) {
            try { this.ws.close(); } catch (e) { console.error('🔌 Close error:', e); }
          }
          pool.delete(this.url);
        }
      }
    }

    send(data) {
      if (!this.ws || this.ws.readyState !== NativeWS.OPEN) {
        this.sendQueue.push(data);
        console.log(`🔌 Queued message for ${this.url}. Queue size: ${this.sendQueue.length}`);
        return;
      }
      
      try {
        this.ws.send(data);
      } catch (e) {
        console.error('🔌 Send failed, queuing:', e);
        this.sendQueue.push(data);
      }
    }

    addEventListener(type, fn) {
      const set = this.listeners.get(type);
      if (set) set.add(fn);
    }

    removeEventListener(type, fn) {
      const set = this.listeners.get(type);
      if (set) set.delete(fn);
    }

    get readyState() {
      return this.ws ? this.ws.readyState : NativeWS.CLOSED;
    }
  }

  function VirtualSocket(url, protocols) {
    if (protocols && protocols.length > 0) {
      console.warn('🔌 WebSocket protocols not supported in dedup shim:', protocols);
    }

    // Get or create pool entry
    let entry = pool.get(url);
    if (!entry) {
      entry = new PoolEntry(url);
      pool.set(url, entry);
    }

    // Track this virtual socket
    entry.addRef(this);

    // Public properties
    Object.defineProperty(this, 'readyState', {
      enumerable: true,
      get() { return entry.readyState; }
    });
    
    Object.defineProperty(this, 'url', { 
      enumerable: true, 
      value: url 
    });

    Object.defineProperty(this, 'protocol', { 
      enumerable: true, 
      value: '' 
    });

    Object.defineProperty(this, 'extensions', { 
      enumerable: true, 
      value: '' 
    });

    // Public methods
    this.addEventListener = (type, fn) => {
      entry.addEventListener(type, fn);
    };

    this.removeEventListener = (type, fn) => {
      entry.removeEventListener(type, fn);
    };

    this.send = (data) => {
      entry.send(data);
    };

    this.close = (code, reason) => {
      entry.removeRef(this);
    };

    // Property-style event handlers (will be set by user)
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
  }

  // Copy constants
  VirtualSocket.CONNECTING = NativeWS.CONNECTING;
  VirtualSocket.OPEN = NativeWS.OPEN;
  VirtualSocket.CLOSING = NativeWS.CLOSING;
  VirtualSocket.CLOSED = NativeWS.CLOSED;

  // Replace global WebSocket constructor
  window.WebSocket = VirtualSocket;
  
  // Keep reference to native implementation
  window.NativeWebSocket = NativeWS;
  
  // Debug utilities
  window.WS_DEBUG = {
    getPool: () => pool,
    getPoolSize: () => pool.size,
    getActiveConnections: () => {
      const result = {};
      pool.forEach((entry, url) => {
        result[url] = {
          refs: entry.refs.size,
          readyState: entry.readyState,
          queueSize: entry.sendQueue.length
        };
      });
      return result;
    }
  };

  console.log('🔌 WebSocket dedup shim installed successfully');
})();
