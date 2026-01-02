// Phase F: ModalManager for centralized modal and notification handling
// Goal: Replace scattered alerts/modals with unified, accessible components
(function (global) {
  class ModalManager {
    constructor() {
      this.activeModals = new Set();
      this.modalCounter = 0;
      this.toastCounter = 0;
      this.initialized = false;
    }

    init() {
      if (this.initialized) return;
      this._createModalContainer();
      this._createToastContainer();
      this._setupKeyboardHandlers();
      this.initialized = true;
      console.log('[ModalManager] Initialized');
    }

    _createModalContainer() {
      if (document.getElementById('modalContainer')) return;
      const container = document.createElement('div');
      container.id = 'modalContainer';
      container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;pointer-events:none;';
      document.body.appendChild(container);
    }

    _createToastContainer() {
      if (document.getElementById('toastContainer')) return;
      const container = document.createElement('div');
      container.id = 'toastContainer';
      container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
      document.body.appendChild(container);
    }

    _setupKeyboardHandlers() {
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.activeModals.size > 0) {
          const topModal = Array.from(this.activeModals).pop();
          if (topModal && topModal.closable !== false) {
            this.closeModal(topModal.id);
          }
        }
      });
    }

    // Modal API
    showModal({ title, content, type = 'default', size = 'medium', closable = true, buttons = [] }) {
      const modalId = `modal_${++this.modalCounter}`;
      const modal = this._createModal({ id: modalId, title, content, type, size, closable, buttons });

      this.activeModals.add({ id: modalId, element: modal, closable });
      this._showModalElement(modal);

      return {
        id: modalId,
        close: () => this.closeModal(modalId),
        updateContent: (newContent) => this._updateModalContent(modalId, newContent)
      };
    }

    closeModal(modalId) {
      const modalData = Array.from(this.activeModals).find(m => m.id === modalId);
      if (!modalData) return false;

      this._hideModalElement(modalData.element);
      this.activeModals.delete(modalData);

      setTimeout(() => {
        modalData.element.remove();
      }, 300); // Allow animation to complete

      return true;
    }

    _createModal({ id, title, content, type, size, closable, buttons }) {
      const overlay = document.createElement('div');
      overlay.className = `modal-overlay modal-${type}`;
      overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: opacity 0.3s ease; pointer-events: all;
      `;

      const dialog = document.createElement('div');
      dialog.className = `modal-dialog modal-${size}`;
      const maxWidth = size === 'small' ? '400px' : size === 'large' ? '800px' : '600px';
      dialog.style.cssText = `
        background: var(--color-surface); border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg); max-width: ${maxWidth}; width: 90%;
        max-height: 90vh; overflow: hidden; transform: scale(0.9);
        transition: transform 0.3s ease;
      `;

      // Header
      if (title || closable) {
        const header = document.createElement('div');
        header.className = 'modal-header';
        header.style.cssText = `
          padding: var(--space-lg); border-bottom: 1px solid var(--color-border);
          display: flex; align-items: center; justify-content: space-between;
        `;

        if (title) {
          const titleEl = document.createElement('h3');
          titleEl.textContent = title;
          titleEl.style.cssText = 'margin: 0; color: var(--color-text); font-size: 18px; font-weight: 600;';
          header.appendChild(titleEl);
        }

        if (closable) {
          const closeBtn = document.createElement('button');
          closeBtn.innerHTML = '×';
          closeBtn.className = 'modal-close-btn';
          closeBtn.style.cssText = `
            background: none; border: none; font-size: 24px; cursor: pointer;
            color: var(--color-textSoft); padding: 0; width: 32px; height: 32px;
            display: flex; align-items: center; justify-content: center;
            border-radius: var(--radius-md); transition: all 0.2s;
          `;
          closeBtn.onmouseover = () => closeBtn.style.background = 'var(--color-surfaceAlt)';
          closeBtn.onmouseout = () => closeBtn.style.background = 'none';
          closeBtn.onclick = () => this.closeModal(id);
          header.appendChild(closeBtn);
        }

        dialog.appendChild(header);
      }

      // Body
      const body = document.createElement('div');
      body.className = 'modal-body';
      body.style.cssText = 'padding: var(--space-lg); overflow-y: auto; max-height: calc(90vh - 160px);';

      if (typeof content === 'string') {
        body.innerHTML = content;
      } else if (content instanceof HTMLElement) {
        body.appendChild(content);
      }

      dialog.appendChild(body);

      // Footer
      if (buttons.length > 0) {
        const footer = document.createElement('div');
        footer.className = 'modal-footer';
        footer.style.cssText = `
          padding: var(--space-lg); border-top: 1px solid var(--color-border);
          display: flex; gap: var(--space-sm); justify-content: flex-end;
        `;

        buttons.forEach(btn => {
          const button = document.createElement('button');
          button.textContent = btn.text || 'Button';
          button.className = btn.primary ? 'btn-primary' : 'btn-secondary';
          button.style.cssText = 'padding: var(--space-sm) var(--space-lg);';
          button.onclick = (e) => {
            if (btn.action) btn.action(e, { modalId: id, close: () => this.closeModal(id) });
          };
          footer.appendChild(button);
        });

        dialog.appendChild(footer);
      }

      overlay.appendChild(dialog);
      overlay.onclick = (e) => {
        if (e.target === overlay && closable) {
          this.closeModal(id);
        }
      };

      return overlay;
    }

    _showModalElement(modal) {
      const container = document.getElementById('modalContainer');
      container.appendChild(modal);

      // Trigger animation
      requestAnimationFrame(() => {
        modal.style.opacity = '1';
        const dialog = modal.querySelector('.modal-dialog');
        if (dialog) dialog.style.transform = 'scale(1)';
      });
    }

    _hideModalElement(modal) {
      modal.style.opacity = '0';
      const dialog = modal.querySelector('.modal-dialog');
      if (dialog) dialog.style.transform = 'scale(0.9)';
    }

    _updateModalContent(modalId, newContent) {
      const modalData = Array.from(this.activeModals).find(m => m.id === modalId);
      if (!modalData) return false;

      const body = modalData.element.querySelector('.modal-body');
      if (body) {
        if (typeof newContent === 'string') {
          body.innerHTML = newContent;
        } else if (newContent instanceof HTMLElement) {
          body.innerHTML = '';
          body.appendChild(newContent);
        }
      }

      return true;
    }

    // Toast/Notification API
    showToast({ message, type = 'info', duration = 5000, persistent = false }) {
      const toastId = `toast_${++this.toastCounter}`;
      const toast = this._createToast({ id: toastId, message, type });

      this._showToastElement(toast);

      if (!persistent && duration > 0) {
        setTimeout(() => {
          this.closeToast(toastId);
        }, duration);
      }

      return {
        id: toastId,
        close: () => this.closeToast(toastId)
      };
    }

    closeToast(toastId) {
      const toast = document.getElementById(toastId);
      if (!toast) return false;

      toast.style.transform = 'translateX(100%)';
      toast.style.opacity = '0';

      setTimeout(() => {
        toast.remove();
      }, 300);

      return true;
    }

    _createToast({ id, message, type }) {
      const toast = document.createElement('div');
      toast.id = id;
      toast.className = `toast toast-${type}`;

      const bgColor = {
        success: 'var(--color-success)',
        error: 'var(--color-danger)',
        warning: 'var(--color-warning)',
        info: 'var(--color-info)'
      }[type] || 'var(--color-info)';

      toast.style.cssText = `
        background: ${bgColor}; color: white; padding: var(--space-md) var(--space-lg);
        border-radius: var(--radius-md); box-shadow: var(--shadow-lg);
        min-width: 300px; max-width: 500px; opacity: 0;
        transform: translateX(100%); transition: all 0.3s ease;
        pointer-events: all; cursor: pointer; display: flex;
        align-items: center; justify-content: space-between;
      `;

      const messageEl = document.createElement('span');
      messageEl.textContent = message;
      toast.appendChild(messageEl);

      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '×';
      closeBtn.style.cssText = `
        background: none; border: none; color: white; font-size: 18px;
        cursor: pointer; padding: 0; margin-left: var(--space-sm);
        width: 24px; height: 24px; display: flex; align-items: center;
        justify-content: center; border-radius: var(--radius-sm);
        opacity: 0.8; transition: opacity 0.2s;
      `;
      closeBtn.onmouseover = () => closeBtn.style.opacity = '1';
      closeBtn.onmouseout = () => closeBtn.style.opacity = '0.8';
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        this.closeToast(id);
      };
      toast.appendChild(closeBtn);

      toast.onclick = () => this.closeToast(id);

      return toast;
    }

    _showToastElement(toast) {
      const container = document.getElementById('toastContainer');
      container.appendChild(toast);

      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
      });
    }

    // Convenience methods
    alert(message, title = 'Alert') {
      return this.showModal({
        title,
        content: `<p style="margin:0;">${message}</p>`,
        type: 'default',
        size: 'small',
        buttons: [{ text: 'OK', primary: true, action: (e, { close }) => close() }]
      });
    }

    confirm(message, title = 'Confirm') {
      return new Promise((resolve) => {
        this.showModal({
          title,
          content: `<p style="margin:0;">${message}</p>`,
          type: 'default',
          size: 'small',
          buttons: [
            { text: 'Cancel', action: (e, { close }) => { close(); resolve(false); } },
            { text: 'OK', primary: true, action: (e, { close }) => { close(); resolve(true); } }
          ]
        });
      });
    }

    success(message) {
      return this.showToast({ message, type: 'success' });
    }

    error(message) {
      return this.showToast({ message, type: 'error' });
    }

    warning(message) {
      return this.showToast({ message, type: 'warning' });
    }

    info(message) {
      return this.showToast({ message, type: 'info' });
    }
  }

  global.ModalManager = new ModalManager();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => global.ModalManager.init());
  } else {
    global.ModalManager.init();
  }
})(window);
