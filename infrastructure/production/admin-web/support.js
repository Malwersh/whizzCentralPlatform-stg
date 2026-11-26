(() => {
  'use strict';

  const byId = id => document.getElementById('support-' + id);
  const typeLabels = {customer: 'الزبون', merchant: 'المطعم', driver: 'السائق', agent: 'فريق الدعم', system: 'النظام'};
  const statusLabels = {waiting_for_agent: 'بانتظار الدعم', active: 'جارية', closed: 'مغلقة'};
  const sessions = new Map();
  const messages = new Map();
  const formatter = new Intl.DateTimeFormat('ar-IQ', {
    timeZone: 'Asia/Baghdad', dateStyle: 'short', timeStyle: 'short',
  });
  const thread = byId('thread');
  const input = byId('text');
  const reply = byId('reply');
  const closeDialog = byId('close-dialog');
  let socket, generation = 0, attempts = 0, reconnectTimer, heartbeat, handshakeTimer;
  let permissions = new Set(), selected, nextCursor, historyRequest, pending, closing, ready = false;
  let selectionBeforeConnect;

  function text(id, value) {
    byId(id).textContent = value;
  }

  function emit(message) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  function name(session) {
    return session.customerName || session.merchantName || session.driverName ||
      (session.userDisplayName === 'User' ? '' : session.userDisplayName) || typeLabels[session.userType] || 'مستخدم';
  }

  function renderQueue() {
    const entries = [...sessions.values()]
      .filter(session => !byId('filter').value || session.userType === byId('filter').value)
      .sort((first, second) => String(second.lastMessageAt || '').localeCompare(String(first.lastMessageAt || '')));
    const nodes = entries.map(session => {
      const row = document.createElement('li');
      const button = document.createElement('button');
      const label = document.createElement('strong');
      const summary = document.createElement('small');
      button.type = 'button';
      if (session.sessionId === selected) button.setAttribute('aria-current', 'true');
      label.textContent = name(session);
      summary.textContent = [typeLabels[session.userType], statusLabels[session.status]].filter(Boolean).join(' · ');
      button.append(label, summary);
      button.addEventListener('click', () => select(session.sessionId, true));
      row.append(button);
      return row;
    });
    byId('sessions').replaceChildren(...nodes);
    byId('empty').hidden = nodes.length > 0;
  }

  function renderControls() {
    const session = sessions.get(selected);
    const open = session && session.status !== 'closed';
    thread.hidden = !session;
    byId('older').hidden = !nextCursor || !session;
    byId('older').disabled = !!historyRequest || !ready;
    reply.hidden = !open || !permissions.has('support.reply');
    byId('send').disabled = !ready || !!closing || (!!pending && pending.waiting);
    byId('send').textContent = pending ? 'إعادة إرسال الرد' : 'إرسال';
    input.readOnly = !!pending || !!closing;
    byId('close').hidden = !open || !permissions.has('support.close');
    byId('close').disabled = !ready || !!closing || !!pending;
    text('title', session ? name(session) : 'اختر محادثة');
    text('context', session ? [typeLabels[session.userType], statusLabels[session.status],
      session.orderId ? 'الطلب ' + session.orderId : null].filter(Boolean).join(' · ') : '');
  }

  function addMessages(entries, scrollToLatest) {
    const wasNearEnd = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40;
    const heightBefore = thread.scrollHeight;
    const list = byId('messages');
    for (const message of entries) {
      if (!message.messageId || messages.has(message.messageId)) continue;
      const item = document.createElement('li');
      const heading = document.createElement('small');
      const timestamp = new Date(message.createdAt || message.timestamp);
      const sender = typeLabels[message.senderType];
      heading.textContent = [sender, isNaN(timestamp) ? null : formatter.format(timestamp)].filter(Boolean).join(' · ');
      item.append(heading);
      if (message.senderType === 'agent') item.dataset.own = '';
      if (message.text) {
        const body = document.createElement('p');
        body.dir = 'auto';
        body.textContent = message.text;
        item.append(body);
      }
      if (message.attachment?.attachmentId) item.append(window.SupportAttachments.createPreview(message.attachment, selected));
      const key = String(message.messageKey || message.createdAt || message.timestamp || '') + message.messageId;
      const after = Array.from(list.children).find(row => row.dataset.sortKey > key);
      item.dataset.sortKey = key;
      if (after) list.insertBefore(item, after);
      else list.append(item);
      messages.set(message.messageId, item);
    }
    if (scrollToLatest && wasNearEnd) thread.scrollTop = thread.scrollHeight;
    if (!scrollToLatest) thread.scrollTop += thread.scrollHeight - heightBefore;
  }

  function fetchHistory(join = false) {
    const requestId = crypto.randomUUID();
    const cursor = join ? null : nextCursor;
    if (!emit({type: join ? 'join_channel' : 'get_session_messages', sessionId: selected, requestId, limit: 6,
      ...(cursor ? {cursor} : {})})) return;
    historyRequest = {requestId, prepend: !!cursor, timer: setTimeout(() => {
      historyRequest = null;
      text('feedback', 'تعذّر تحميل الرسائل. افتح المحادثة مجددًا.');
      renderControls();
    }, 12000)};
    renderControls();
  }

  function select(id, focus = false) {
    if (!sessions.has(id) || !ready) return;
    if ((pending || closing) && selected !== id) {
      text('feedback', 'أكمل الإجراء في المحادثة الحالية أولًا.');
      return;
    }
    clearTimeout(historyRequest?.timer);
    historyRequest = null;
    if (selected !== id) {
      input.value = '';
      nextCursor = null;
      messages.clear();
      byId('messages').replaceChildren();
    }
    selected = id;
    text('feedback', '');
    renderQueue();
    renderControls();
    if (focus) byId('title').focus();
    fetchHistory(true);
  }

  function process(event) {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    const {type, sessionId, requestId} = data;
    if (type === 'agent_connected') return;
    if (type === 'active_sessions' || type === 'new_chat_session') {
      if (type === 'active_sessions' && !data.delta) sessions.clear();
      const updates = type === 'active_sessions' ? data.sessions : [{...data, createdAt: data.timestamp, status: 'waiting_for_agent'}];
      for (const entry of updates || []) if (entry.sessionId) sessions.set(entry.sessionId, entry);
      if (!ready && type === 'active_sessions') {
        ready = true;
        attempts = 0;
        clearTimeout(handshakeTimer);
        text('status', '');
        byId('workspace').hidden = false;
        if (selectionBeforeConnect && sessions.has(selectionBeforeConnect)) select(selectionBeforeConnect);
        if (closing && !sessions.has(selected)) {
          closing = null;
          text('feedback', 'حدّثت قائمة المحادثات.');
        }
      }
      renderQueue();
      renderControls();
    } else if (type === 'session_messages' && sessionId === selected && historyRequest?.requestId === requestId) {
      clearTimeout(historyRequest.timer);
      addMessages(data.messages || [], !historyRequest.prepend);
      historyRequest = null;
      nextCursor = data.nextCursor;
      renderControls();
    } else if (type === 'chat_message' && sessions.has(sessionId)) {
      sessions.get(sessionId).lastMessageAt = data.message?.createdAt || data.timestamp;
      if (selected === sessionId && data.message) addMessages([data.message], true);
      renderQueue();
    } else if (type === 'message_ack' && pending?.frame.sessionId === sessionId && pending.frame.clientMessageId === data.clientMessageId) {
      clearTimeout(pending.timer);
      pending = null;
      input.value = '';
      text('feedback', 'أُرسل الرد.');
      renderControls();
      fetchHistory(true);
    } else if (['session_closed', 'chat_session_closed'].includes(type) && sessions.has(sessionId)) {
      sessions.get(sessionId).status = 'closed';
      if (sessionId === selected) finishClose();
      renderQueue();
      renderControls();
    } else if (type === 'history_error' && historyRequest?.requestId === requestId) {
      clearTimeout(historyRequest.timer);
      historyRequest = null;
      text('feedback', 'تعذّر تحميل الرسائل. افتح المحادثة مجددًا.');
      renderControls();
    } else if (type === 'error') {
      if (data.code === 'AUTH_REQUIRED') socket.close();
      text('feedback', 'تعذّر تنفيذ الإجراء. تحقّق من الصلاحيات وحالة المحادثة.');
    }
  }

  function finishClose() {
    clearTimeout(closing?.timer);
    closing = null;
    clearTimeout(pending?.timer);
    pending = null;
    text('feedback', 'أُغلقت المحادثة.');
    renderControls();
  }

  async function request(path, method = 'GET') {
    await window.Auth.ensureSession();
    const response = await fetch(path, {method, cache: 'no-store', signal: AbortSignal.timeout(12000), headers: {
      Authorization: 'Bearer ' + window.Auth.getToken('accessToken'),
    }});
    if (!response.ok) throw Object.assign(new Error('SUPPORT_REQUEST_FAILED'), {status: response.status});
    return response.json();
  }

  async function connect() {
    const current = ++generation;
    clearTimeout(reconnectTimer);
    clearTimeout(handshakeTimer);
    clearInterval(heartbeat);
    clearTimeout(historyRequest?.timer);
    historyRequest = null;
    socket?.close();
    selectionBeforeConnect = selected;
    ready = false;
    renderControls();
    text('status', attempts ? 'تعذّر الاتصال بالدعم. جارٍ إعادة المحاولة…' : 'جارٍ الاتصال بالدعم…');
    try {
      const profile = await request('/staff/me');
      if (current !== generation) return;
      permissions = new Set(profile.permissions);
      if (!permissions.has('support.read')) throw Object.assign(new Error(), {status: 403});
      const endpoint = new URL(window.WIZZ_SUPPORT_CONFIG.socketUrl);
      if (!/^wss:\/\/[a-z0-9]{10}\.execute-api\.us-east-1\.amazonaws\.com\/production$/.test(endpoint.href)) throw Error('Invalid endpoint');
      const {ticket} = await request('/support-api/socket-ticket', 'POST');
      if (current !== generation) return;
      if (!/^[\w-]{43}$/.test(ticket)) throw Error('Invalid ticket');
      endpoint.searchParams.set('userType', 'agent');
      endpoint.searchParams.set('ticket', ticket);
      socket = new WebSocket(endpoint);
      const connection = socket;
      handshakeTimer = setTimeout(() => connection.close(), 12000);
      connection.addEventListener('open', () => {
        if (current !== generation) return;
        emit({type: 'chat_agent_connect'});
        heartbeat = setInterval(() => emit({type: 'ping'}), 60000);
      });
      connection.addEventListener('message', event => {
        if (current === generation) process(event);
      });
      connection.addEventListener('error', () => {
        if (current === generation) text('status', 'تعذّر الاتصال بالدعم.');
      });
      connection.addEventListener('close', () => {
        if (current !== generation) return;
        clearTimeout(handshakeTimer);
        clearInterval(heartbeat);
        text('status', ready ? 'انقطع الاتصال بالدعم.' : 'تعذّر الاتصال بالدعم.');
        ready = false;
        renderControls();
        if (++attempts <= 3) reconnectTimer = setTimeout(connect, 1000 * 2 ** attempts);
      });
    } catch (error) {
      if (current !== generation) return;
      if ([401, 403].includes(error.status) || error.code === 'SessionExpired') byId('workspace').hidden = true;
      text('status', error.status === 403 ? 'تحتاج صلاحية محادثات الدعم.' :
        error.status === 401 || error.code === 'SessionExpired' ? 'انتهت الجلسة. سجّل الدخول مجددًا.' : 'تعذّر الاتصال بالدعم. أعد المحاولة.');
    }
  }

  reply.addEventListener('submit', event => {
    event.preventDefault();
    if (!ready || !selected || !input.value.trim() || closing || pending?.waiting) return;
    pending ||= {frame: {type: 'chat_message', messageText: input.value.trim(), sessionId: selected, clientMessageId: crypto.randomUUID()}};
    if (!emit(pending.frame)) return;
    pending.waiting = true;
    pending.timer = setTimeout(() => {
      pending.waiting = false;
      text('feedback', 'تعذّر تأكيد الإرسال. يمكنك إعادة إرسال الرد.');
      renderControls();
    }, 12000);
    text('feedback', 'جارٍ إرسال الرد…');
    renderControls();
  });
  byId('close').addEventListener('click', () => { closeDialog.returnValue = ''; closeDialog.showModal(); });
  closeDialog.addEventListener('close', () => {
    if (closeDialog.returnValue !== 'close' || !ready || !selected ||
      !emit({type: 'chat_session_close', sessionId: selected})) return;
    closing = {timer: setTimeout(() => {
      closing = null;
      text('feedback', 'تعذّر تأكيد الإغلاق. حدّث المحادثات للتحقّق.');
      renderControls();
    }, 12000)};
    renderControls();
  });
  byId('older').addEventListener('click', () => fetchHistory());
  byId('filter').addEventListener('change', renderQueue);
  byId('refresh').addEventListener('click', () => { attempts = 0; connect(); });
  window.addEventListener('pagehide', () => {
    generation++;
    clearTimeout(reconnectTimer);
    clearTimeout(handshakeTimer);
    clearInterval(heartbeat);
    socket?.close();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) connect(); });
  connect();
})();
