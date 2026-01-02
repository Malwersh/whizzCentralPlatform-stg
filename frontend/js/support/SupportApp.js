// SupportApp bootstrap (Phase A, B, C, D, E & F)
// Bridges legacy global functions with new modular architecture.
(function (global) {
  class SupportApp {
    constructor() {
      this.initialized = false;
      this.version = '1.0.0-oop-phaseF';
    }
    init() {
      if (this.initialized) return;
      console.log('[SupportApp] Initializing (Phase F)...');

      // Phase A: Theme & EventBus
      if (global.ThemeManager) global.ThemeManager.applyToDocument();

      // Phase B: Initialize services in order
      this._initializeServices();

      // Legacy patches
      this._patchLegacy();

      this.initialized = true;
      console.log('[SupportApp] Ready (Theme + Tickets + Chat + Legacy patches).');
    }

    _initializeServices() {
      // Core services (Phase A, E, F)
      if (global.ModalManager) global.ModalManager.init();

      // Phase B: Ticket services
      if (global.TicketService) global.TicketService.init();
      if (global.TicketUI) global.TicketUI.init();

      // Phase C: Chat services (order matters)
      if (global.ChatSessionService) global.ChatSessionService.init();
      if (global.LiveChatUI) global.LiveChatUI.init();

      console.log('[SupportApp] Services initialized:', {
        modalManager: !!global.ModalManager,
        ticketService: !!global.TicketService,
        ticketUI: !!global.TicketUI,
        chatSessionService: !!global.ChatSessionService,
        liveChatUI: !!global.LiveChatUI
      });
    }

    _patchLegacy() {
      // Example: route certain legacy actions through EventBus later
      if (!global.EventBus) return;
      // Tickets update hook
      const origRenderTickets = global.renderTicketsTable;
      if (typeof origRenderTickets === 'function') {
        global.renderTicketsTable = function () {
          const res = origRenderTickets.apply(this, arguments);
          global.EventBus.emit('tickets.rendered', { timestamp: Date.now() });
          return res;
        };
      }
    }
  }
  global.SupportApp = new SupportApp();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => global.SupportApp.init());
  } else {
    global.SupportApp.init();
  }
})(window);
