// Simple EventBus for decoupled module communication (Phase A)
(function(global){
  class EventBus {
    constructor(){ this.listeners = {}; }
    on(event, handler){
      if(!this.listeners[event]) this.listeners[event] = new Set();
      this.listeners[event].add(handler);
      return ()=> this.off(event, handler);
    }
    off(event, handler){ if(this.listeners[event]) this.listeners[event].delete(handler); }
    emit(event, payload){
      if(!this.listeners[event]) return;
      this.listeners[event].forEach(fn=> { try { fn(payload); } catch(e){ console.warn('EventBus handler error', e); } });
    }
  }
  global.EventBus = new EventBus();
})(window);
