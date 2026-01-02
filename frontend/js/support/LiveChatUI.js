// LiveChatUI Phase C: Updated to integrate with ChatSessionService
// Goal: Use centralized session state while maintaining backward compatibility
(function (global) {
  class LiveChatUI {
    constructor() {
      this.activeSessionId = null;
      this.rootIds = {
        chipContainer: 'liveChatSessionList',
        transcript: 'liveChatTranscript'
      };
      this.sessionService = null;
    }
    init() {
      // Connect to ChatSessionService
      if (global.ChatSessionService) {
        this.sessionService = global.ChatSessionService;

        // Subscribe to session events
        this.sessionService.subscribe((event, data) => {
          switch (event) {
            case 'sessionAdded':
            case 'sessionRemoved':
            case 'sessionUpdated':
              this.renderSessionChips();
              break;
            case 'activeSessionChanged':
              this.activeSessionId = data.sessionId;
              this.renderSessionChips();
              break;
            case 'messageAdded':
              // Update unread for non-active, or re-render transcript for active
              if (data.sessionId !== this.activeSessionId) {
                this._updateUnreadBadge(data.sessionId, data.session.unreadCount);
              } else {
                this.renderActiveTranscript();
              }
              break;
          }
        });

        // Sync initial state
        this.activeSessionId = this.sessionService.activeSessionId;
      }

      // Legacy sync fallback
      if (global.liveChatUIState && global.liveChatUIState.activeSessionId) {
        this.activeSessionId = global.liveChatUIState.activeSessionId;
      } else {
        if (!global.liveChatUIState) global.liveChatUIState = {};
        global.liveChatUIState.activeSessionId = this.activeSessionId;
      }
    }
    getSessions() {
      // Use ChatSessionService if available, fallback to legacy globals
      if (this.sessionService) {
        return this.sessionService.getSessionEntries();
      }
      return Object.entries(global.liveChatSessions || {});
    }
    renderSessionChips() {
      const list = document.getElementById(this.rootIds.chipContainer) || document.getElementById('chat-sessions-list');
      if (!list) return;
      const sessions = this.getSessions();
      if (!sessions.length) { list.innerHTML = '<div class="no-sessions"><div class="icon">💬</div>Waiting for incoming chat sessions...</div>'; return; }

      // If no active session is selected yet, auto-select the first one
      if (this.sessionService && !this.sessionService.activeSessionId && sessions.length > 0) {
        const firstId = sessions[0][0];
        this.sessionService.setActiveSession(firstId);
        this.activeSessionId = firstId;
      }

      const statusColorMap = { waiting_for_agent: 'var(--color-warning)', active: 'var(--color-success)', closing: 'var(--color-warning)', closed: 'var(--color-textFaint)' };
      list.innerHTML = sessions.map(([id, s]) => {
        const driverName = (s.driverName || s.driverInfo?.driverName || s.driverInfo?.name || 'Driver');
        const active = this.activeSessionId === id;
        const status = s.status || 'waiting_for_agent';
        const dotColor = statusColorMap[status] || 'var(--color-textSoft)';
        const unread = this._getUnreadCount(id);
        const slaBadge = s.firstResponseTimeShort ? `<span title="First response time" style="background:var(--color-slate700,#334155);color:#fff;border-radius:10px;padding:0 6px;font-size:10px;line-height:16px;">${s.firstResponseTimeShort}</span>` : '';
        return `<div data-session-id="${id}" class="lc-session-chip${active ? ' active' : ''}" style="cursor:pointer;padding:6px 10px;border:1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'};border-radius:20px;font-size:12px;display:inline-flex;align-items:center;gap:6px;background:${active ? 'var(--color-primaryHover)' : 'var(--color-surface)'};color:${active ? '#fff' : 'var(--color-text)'};">` +
          `<span style="width:8px;height:8px;border-radius:50%;background:${dotColor};display:inline-block;"></span>` +
          `<span>${driverName}</span>` +
          `${slaBadge}` +
          `<span class="lc-unread" style="${unread ? '' : 'display:none;'}background:var(--color-danger);color:#fff;border-radius:10px;padding:0 6px;font-size:10px;line-height:16px;">${unread || 0}</span></div>`;
      }).join('');
      list.querySelectorAll('.lc-session-chip').forEach(chip => chip.addEventListener('click', () => this.setActiveSession(chip.getAttribute('data-session-id'))));

      // Also render transcript for current active after chips update
      this.renderActiveTranscript();
    }

    renderActiveTranscript() {
      const convoArea = document.getElementById('conversation-area');
      let transcript = document.getElementById(this.rootIds.transcript);
      if (!transcript) {
        transcript = document.createElement('div');
        transcript.id = this.rootIds.transcript;
        transcript.className = 'chat-transcript';
        if (convoArea) {
          convoArea.innerHTML = '';
          convoArea.appendChild(transcript);
          const indicator = document.createElement('div');
          indicator.id = 'liveChatTypingIndicator';
          indicator.className = 'chat-typing-indicator';
          indicator.style.display = 'none';
          convoArea.appendChild(indicator);
        }
      }

      // Render messages for active session
      if (!this.sessionService) return;
      const active = this.sessionService.getActiveSession();
      if (!active) {
        transcript.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎧</div><h3>Welcome to Live Chat Support</h3><p>You are automatically online and ready to help customers</p></div>';
        return;
      }

      // Clear transcript and append messages
      transcript.innerHTML = '';
      const messages = active.messages || [];
      messages.forEach(m => {
        const wrapper = document.createElement('div');
        const sender = (m.senderName || m.senderType || 'unknown');
        const role = (m.senderType || '');
        const content = (m.messageText || m.message || m.text || '');
        const ts = (m.timestamp || new Date().toISOString());
        const isAgent = (m.senderType === 'agent' || m.senderType === 'support');
        wrapper.className = `chat-message ${isAgent ? 'agent-message' : 'driver-message'}`;
        wrapper.innerHTML = `<div class="chat-message-header"><strong>${sender}</strong> <span class="chat-message-sender">${role}</span> <span class="chat-message-timestamp">${ts}</span></div><div class="chat-message-content">${content}</div>`;
        transcript.appendChild(wrapper);
      });
      
      // Add reply input interface if this is an active driver session
      this._addReplyInterface(transcript, active.sessionId);
      
      transcript.scrollTop = transcript.scrollHeight;
    }

    setActiveSession(sessionId) {
      // Use ChatSessionService if available
      if (this.sessionService) {
        this.sessionService.setActiveSession(sessionId);
        // Service will notify us via event, so don't duplicate work
        return;
      }

      // Legacy fallback
      this.activeSessionId = sessionId;
      if (!global.liveChatUIState) global.liveChatUIState = {};
      global.liveChatUIState.activeSessionId = sessionId;

      // Reset unread badge
      const chip = document.querySelector(`[data-session-id="${sessionId}"] .lc-unread`);
      if (chip) { chip.textContent = '0'; chip.style.display = 'none'; }

      if (typeof global.renderTranscriptForActiveSession === 'function') {
        global.renderTranscriptForActiveSession();
      }
      this.renderSessionChips();
      const ti = document.getElementById('liveChatTypingIndicator'); if (ti) ti.style.display = 'none';
    }
    incrementUnread(sessionId) {
      if (sessionId === this.activeSessionId) return; // active session already renders directly
      const chip = document.querySelector(`[data-session-id="${sessionId}"] .lc-unread`);
      if (chip) {
        const cur = parseInt(chip.textContent || '0', 10) + 1; chip.textContent = String(cur); chip.style.display = 'inline-flex';
      }
    }
    _getUnreadCount(id) {
      // Use ChatSessionService if available
      if (this.sessionService) {
        const session = this.sessionService.getSession(id);
        return session ? session.unreadCount : 0;
      }

      // Legacy fallback: check DOM badge
      const chip = document.querySelector(`[data-session-id="${id}"] .lc-unread`);
      if (!chip) return 0;
      return parseInt(chip.textContent || '0', 10) || 0;
    }

    _updateUnreadBadge(sessionId, count) {
      const chip = document.querySelector(`[data-session-id="${sessionId}"] .lc-unread`);
      if (chip) {
        chip.textContent = String(count);
        chip.style.display = count > 0 ? 'inline-flex' : 'none';
      }
    }

    _addReplyInterface(transcript, sessionId) {
      // Remove existing reply interface
      const existingReply = transcript.querySelector('.chat-reply-interface');
      if (existingReply) existingReply.remove();

      // Create reply interface
      const replyDiv = document.createElement('div');
      replyDiv.className = 'chat-reply-interface';
      replyDiv.style.cssText = `
        margin-top: 20px;
        padding: 15px;
        border-top: 1px solid #e5e7eb;
        background: #f8fafc;
        border-radius: 0 0 8px 8px;
      `;

      replyDiv.innerHTML = `
        <div class="reply-tools" style="margin-bottom: 10px;">
          <div class="quick-replies" style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="quick-reply-btn" data-text="👋 Hello! How can I help you today?" style="font-size: 11px; padding: 4px 8px; border: 1px solid #d1d5db; background: #fff; border-radius: 12px; cursor: pointer;">
              👋 Greeting
            </button>
            <button class="quick-reply-btn" data-text="📍 Please share your current location so I can assist you better." style="font-size: 11px; padding: 4px 8px; border: 1px solid #d1d5db; background: #fff; border-radius: 12px; cursor: pointer;">
              📍 Location
            </button>
            <button class="quick-reply-btn" data-text="🚗 I'm checking on your order status now. Please wait a moment." style="font-size: 11px; padding: 4px 8px; border: 1px solid #d1d5db; background: #fff; border-radius: 12px; cursor: pointer;">
              🚗 Status
            </button>
            <button class="quick-reply-btn" data-text="✅ Issue resolved! Is there anything else I can help you with?" style="font-size: 11px; padding: 4px 8px; border: 1px solid #d1d5db; background: #fff; border-radius: 12px; cursor: pointer;">
              ✅ Resolved
            </button>
          </div>
        </div>
        <div class="reply-input-container" style="display: flex; gap: 10px; align-items: flex-end;">
          <textarea 
            id="replyInput-${sessionId}" 
            placeholder="Type your reply to the driver..." 
            style="flex: 1; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; min-height: 60px; max-height: 120px; resize: vertical; font-family: inherit;"
          ></textarea>
          <button 
            id="sendReply-${sessionId}" 
            class="send-reply-btn"
            style="padding: 12px 20px; background: #1d4ed8; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; min-height: 60px;"
          >
            <i class="fas fa-paper-plane"></i>
            Send
          </button>
        </div>
        <div class="reply-info" style="margin-top: 8px; font-size: 12px; color: #6b7280;">
          Press Enter to send • Be professional and helpful
        </div>
      `;

      transcript.appendChild(replyDiv);

      // Add event listeners
      const replyInput = replyDiv.querySelector(`#replyInput-${sessionId}`);
      const sendBtn = replyDiv.querySelector(`#sendReply-${sessionId}`);
      const quickReplyBtns = replyDiv.querySelectorAll('.quick-reply-btn');

      // Quick reply buttons
      quickReplyBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          replyInput.value = btn.getAttribute('data-text');
          replyInput.focus();
        });
      });

      // Send button
      sendBtn.addEventListener('click', () => this._sendReply(sessionId, replyInput));

      // Enter key to send (Ctrl+Enter for new line)
      replyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
          e.preventDefault();
          this._sendReply(sessionId, replyInput);
        }
      });

      // Auto-resize textarea
      replyInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      });
    }

    _sendReply(sessionId, inputElement) {
      const message = inputElement.value.trim();
      if (!message) return;

      console.log('📤 Sending reply to driver:', message);

      // Show sending state
      const sendBtn = document.querySelector(`#sendReply-${sessionId}`);
      if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
      }

      try {
        // Send via LiveChatSocket if available
        if (global.liveChatSocket && typeof global.liveChatSocket.sendChatMessage === 'function') {
          const success = global.liveChatSocket.sendChatMessage(sessionId, message);
          
          if (success) {
            // Clear input
            inputElement.value = '';
            inputElement.style.height = 'auto';
            
            // Add message to UI immediately for better UX
            this._addLocalMessage(sessionId, message);
            
            // Show success feedback
            this._showMessageStatus('Message sent ✓', 'success');
          } else {
            throw new Error('Failed to send message - WebSocket not connected');
          }
        } else {
          throw new Error('Live chat socket not available');
        }
      } catch (error) {
        console.error('❌ Failed to send reply:', error);
        this._showMessageStatus('Failed to send message ✗', 'error');
      } finally {
        // Reset send button
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send';
        }
      }
    }

    _addLocalMessage(sessionId, messageText) {
      // Add message to session via ChatSessionService
      if (this.sessionService) {
        const agentMessage = {
          messageText: messageText,
          senderType: 'agent',
          senderName: 'Support Agent',
          timestamp: new Date().toISOString()
        };
        this.sessionService.addMessage(sessionId, agentMessage);
      }
    }

    _showMessageStatus(message, type) {
      // Create or update status element
      let statusElement = document.getElementById('reply-message-status');
      if (!statusElement) {
        statusElement = document.createElement('div');
        statusElement.id = 'reply-message-status';
        statusElement.style.cssText = `
          position: fixed;
          bottom: 20px;
          right: 20px;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
          z-index: 1000;
          transition: all 0.3s ease;
        `;
        document.body.appendChild(statusElement);
      }

      statusElement.textContent = message;
      statusElement.style.background = type === 'success' ? '#10b981' : '#ef4444';
      statusElement.style.color = 'white';
      statusElement.style.opacity = '1';

      // Auto-hide after 3 seconds
      setTimeout(() => {
        if (statusElement) {
          statusElement.style.opacity = '0';
          setTimeout(() => {
            if (statusElement && statusElement.parentNode) {
              statusElement.parentNode.removeChild(statusElement);
            }
          }, 300);
        }
      }, 3000);
    }
  }
  global.LiveChatUI = new LiveChatUI();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => global.LiveChatUI.init());
  } else { global.LiveChatUI.init(); }
})(window);
