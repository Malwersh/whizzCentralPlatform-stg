// Phase B (initial): TicketUI handles rendering & filtering; wraps legacy global functions gradually.
(function (global) {
  class TicketUI {
    constructor() {
      this.filterState = { search: '', status: '', priority: '', category: '' };
    }
    init() {
      // Wire EventBus to re-render
      if (global.EventBus) {
        global.EventBus.on('tickets.changed', () => this.render());
        global.EventBus.on('tickets.loaded', () => this.render());
        global.EventBus.on('tickets.sampleLoaded', () => this.render());
        global.EventBus.on('tickets.refreshed', () => this.render());
        global.EventBus.on('tickets.added', () => this.render());
      }
      // Intercept legacy filter inputs if present
      const searchInput = document.getElementById('searchInput');
      if (searchInput) searchInput.addEventListener('input', (e) => { this.filterState.search = e.target.value.toLowerCase(); this.render(); });
      const statusFilter = document.getElementById('statusFilter');
      if (statusFilter) statusFilter.addEventListener('change', e => { this.filterState.status = e.target.value; this.render(); });
      const priorityFilter = document.getElementById('priorityFilter');
      if (priorityFilter) priorityFilter.addEventListener('change', e => { this.filterState.priority = e.target.value; this.render(); });
      const categoryFilter = document.getElementById('categoryFilter');
      if (categoryFilter) categoryFilter.addEventListener('change', e => { this.filterState.category = e.target.value; this.render(); });
      this.render();
    }
    getAllTickets() {
      if (global.TicketService) return global.TicketService.getTickets();
      return global.tickets || [];
    }
    applyFilters(list) {
      const fs = this.filterState;
      return list.filter(t => {
        const searchMatch = !fs.search || (t.customer?.name || '').toLowerCase().includes(fs.search) || (t.customer?.email || '').toLowerCase().includes(fs.search) || (t.subject || '').toLowerCase().includes(fs.search) || (t.id || '').toLowerCase().includes(fs.search);
        const status = t.status || t.ticketStatus;
        const statusMatch = !fs.status || status === fs.status;
        const priorityMatch = !fs.priority || t.priority === fs.priority;
        const categoryMatch = !fs.category || t.category === fs.category;
        return searchMatch && statusMatch && priorityMatch && categoryMatch;
      });
    }
    render() {
      const tbody = document.getElementById('ticketsTableBody');
      if (!tbody) return;
      const tickets = this.applyFilters(this.getAllTickets());
      if (!tickets.length) {
        tbody.innerHTML = `<tr><td colspan="9" style="padding:40px;text-align:center;color:var(--color-textSoft);">No Support Tickets</td></tr>`;
        return;
      }
      tbody.innerHTML = tickets.map(t => this._rowTemplate(t)).join('');
    }
    _rowTemplate(ticket) {
      const id = ticket.ticketId || ticket.id || 'N/A';
      const customer = ticket.customer || { name: ticket.customerName || 'Unknown', email: ticket.customerEmail || 'No email', avatar: 'https://i.pravatar.cc/40?img=1' };
      const subject = ticket.subject || ticket.title || 'No subject';
      const category = ticket.category || 'general';
      const priority = ticket.priority || 'medium';
      const status = ticket.status || 'open';
      const assignedTo = ticket.assignedTo || ticket.assignee || 'Unassigned';
      const created = ticket.createdAt || ticket.created || new Date().toISOString();
      return `<tr>
        <td>#${id}</td>
        <td><div class="customer-info"><div class="customer-avatar"><img src="${customer.avatar}" alt="${customer.name}"></div><div><div class="customer-name">${customer.name}</div><div class="customer-email">${customer.email}</div></div></div></td>
        <td>${subject}</td>
        <td><span class="category-badge ${category}">${this._categoryName(category)}</span></td>
        <td><span class="priority-badge ${priority}">${this._cap(priority)}</span></td>
        <td><span class="status-badge ${status}">${this._statusName(status)}</span></td>
        <td>${assignedTo}</td>
        <td>${this._formatDate(created)}</td>
        <td><div class="actions">
          <button class="btn-action" onclick="viewTicket('${id}')" title="View Details"><i class="fas fa-eye"></i></button>
          <button class="btn-action" onclick="assignTicket('${id}')" title="Assign"><i class="fas fa-user-plus"></i></button>
          <button class="btn-action" onclick="resolveTicket('${id}')" title="Resolve"><i class="fas fa-check"></i></button>
        </div></td>
      </tr>`;
    }
    _cap(str) { return (str || '').charAt(0).toUpperCase() + (str || '').slice(1); }
    _categoryName(cat) { const map = { order: 'Order Issues', payment: 'Payment', delivery: 'Delivery', app: 'App Issues', account: 'Account' }; return map[cat] || cat; }
    _statusName(st) { const map = { open: 'Open', 'in-progress': 'In Progress', resolved: 'Resolved', closed: 'Closed', 'in_progress': 'In Progress', assigned: 'In Progress' }; return map[st] || st; }
    _formatDate(dateString) { if (!dateString) return 'N/A'; try { const date = new Date(dateString); const now = new Date(); const diffMs = now - date; const diffMins = Math.floor(diffMs / 60000); const diffHours = Math.floor(diffMs / 3600000); const diffDays = Math.floor(diffMs / 86400000); if (diffMins < 60) return diffMins <= 1 ? 'Just now' : `${diffMins} minutes ago`; if (diffHours < 24) return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`; if (diffDays < 7) return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`; return date.toLocaleDateString(); } catch (e) { return dateString; } }
  }
  global.TicketUI = new TicketUI();
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => global.TicketUI.init()); } else { global.TicketUI.init(); }
})(window);
