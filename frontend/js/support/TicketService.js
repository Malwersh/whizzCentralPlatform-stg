// Phase B (initial): TicketService extracts ticket data loading & normalization logic from legacy support.js
(function (global) {
  class TicketService {
    constructor() {
      this.tickets = [];
      this.initialized = false;
    }
    init() {
      if (this.initialized) return;
      // If legacy global tickets already populated (after page init), sync them in
      if (Array.isArray(global.tickets) && global.tickets.length) {
        this.tickets = global.tickets.slice();
      }
      this.initialized = true;
    }
    setTickets(arr) {
      this.tickets = Array.isArray(arr) ? arr : [];
      global.tickets = this.tickets; // keep legacy global in sync
      if (global.EventBus) global.EventBus.emit('tickets.changed', { tickets: this.tickets });
    }
    getTickets() { return this.tickets; }
    addTicket(ticket) {
      this.tickets.push(ticket);
      if (global.EventBus) global.EventBus.emit('tickets.added', { ticket, tickets: this.tickets });
    }
    loadSampleTickets() {
      const sample = [
        { id: 'TKT001', customer: { name: 'John Smith', email: 'john.smith@email.com', avatar: 'https://i.pravatar.cc/40?img=1' }, subject: 'Order delivery delay', category: 'delivery', priority: 'high', status: 'open', assignedTo: 'Lisa Support', created: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), description: "My order #12345 was supposed to arrive 2 hours ago but I haven't received it yet. Can you please check the status?" },
        { id: 'TKT002', customer: { name: 'Sarah Johnson', email: 'sarah.j@email.com', avatar: 'https://i.pravatar.cc/40?img=2' }, subject: 'Payment issue with credit card', category: 'payment', priority: 'medium', status: 'in_progress', assignedTo: 'John Support', created: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), description: "I'm having trouble adding my credit card to the payment methods. It keeps showing an error message." },
        { id: 'TKT003', customer: { name: 'Mike Wilson', email: 'mike.wilson@email.com', avatar: 'https://i.pravatar.cc/40?img=3' }, subject: 'App crash on iOS', category: 'app', priority: 'high', status: 'resolved', assignedTo: 'Tom Support', created: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), description: 'The app keeps crashing when I try to place an order. I\'m using iPhone 13 with iOS 16.2.' },
        { id: 'TKT004', customer: { name: 'Emma Davis', email: 'emma.davis@email.com', avatar: 'https://i.pravatar.cc/40?img=4' }, subject: 'Account verification problem', category: 'account', priority: 'medium', status: 'open', assignedTo: 'Unassigned', created: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), description: "I've uploaded my documents for verification but the status hasn't changed. How long does verification usually take?" }
      ];
      this.setTickets(sample);
      if (global.EventBus) global.EventBus.emit('tickets.sampleLoaded', { tickets: this.tickets });
    }
    async loadFromDataService() {
      try {
        if (!global.dataService) return false;
        await global.dataService.initialize?.();
        const supportTickets = await global.dataService.getSupportTickets();
        if (supportTickets && supportTickets.length) {
          const mapped = supportTickets.map(t => this.convertDynamoTicket(t));
          this.setTickets(mapped);
          if (global.EventBus) global.EventBus.emit('tickets.loaded', { source: 'dynamodb', count: mapped.length });
          return true;
        }
        return false;
      } catch (e) { console.error('[TicketService] loadFromDataService error', e); return false; }
    }
    convertDynamoTicket(dynamoItem) {
      const getValue = (field) => { if (!field) return ''; return field.S || field.N || field || ''; };
      return {
        id: getValue(dynamoItem.ticketId) || getValue(dynamoItem.id) || 'Unknown',
        customer: {
          name: getValue(dynamoItem.customerName) || 'Unknown Customer',
          email: getValue(dynamoItem.customerEmail) || 'No email',
          avatar: `https://i.pravatar.cc/40?img=${Math.floor(Math.random() * 20) + 1}`
        },
        subject: getValue(dynamoItem.subject) || 'No subject',
        category: getValue(dynamoItem.category) || 'general',
        priority: getValue(dynamoItem.priority) || 'medium',
        status: getValue(dynamoItem.status) || 'open',
        assignedTo: getValue(dynamoItem.assignedTo) || 'Unassigned',
        created: getValue(dynamoItem.createdAt) || getValue(dynamoItem.created) || new Date().toISOString(),
        description: getValue(dynamoItem.description) || 'No description'
      };
    }
    async refreshFromDatabase() {
      // Minimal adaptation of legacy refreshTicketsFromDatabase (UI feedback handled in TicketUI later)
      const ok = await this.loadFromDataService();
      if (!ok && this.tickets.length === 0) {
        this.loadSampleTickets();
      }
      if (global.EventBus) global.EventBus.emit('tickets.refreshed', { tickets: this.tickets });
    }
  }
  global.TicketService = new TicketService();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => global.TicketService.init());
  } else { global.TicketService.init(); }
})(window);
