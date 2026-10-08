// server.js — Lógica de visualização e controle remoto do Helper Node no Ask-Chat (/server)
// Conexão via Ably Realtime com busca dinâmica de chave segura via abra-api.top.

(function() {
  'use strict';

  const ABLY_KEY_URL = 'https://abra-api.top/notifications/retrieve?key=YXNrLWNoYXQtYXBpa2V5LWhlbHBlci1ub2Rl';
  const CHANNEL_NAME = 'helper-node-remote-stream-v1';
  
  let ablyClient = null;
  let streamChannel = null;
  let currentMode = 'realtime'; // 'realtime' | 'translation' | 'profile'
  let isAssistantListening = false;

  const turnsMap = new Map(); // id -> { userEl, botEl }

  // Elementos do DOM
  const themeToggle = document.getElementById('themeToggle');
  const sidebar = document.getElementById('sidebar');
  const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
  const sidebarExpandBtn = document.getElementById('sidebarExpandBtn');
  const modeList = document.getElementById('remoteModeList');
  const viewTitle = document.getElementById('remoteViewTitle');
  const statusBadge = document.getElementById('connectionStatusBadge');
  const statusText = document.getElementById('connectionStatusText');
  const btnToggleListening = document.getElementById('btnToggleListening');
  const lblListenText = document.getElementById('lblListenText');
  const btnClearMessages = document.getElementById('btnClearMessages');
  const remoteMessages = document.getElementById('remoteMessages');
  const profileCheatsheet = document.getElementById('profileCheatsheet');
  const emptyStatePlaceholder = document.getElementById('emptyStatePlaceholder');
  const vuMeterFill = document.getElementById('vuMeterFill');
  const btnBackChat = document.getElementById('btnBackChat');

  // Gerenciamento de Tema (Dark / Light)
  const savedTheme = localStorage.getItem('mcp_chat_theme') || 'dark';
  document.body.setAttribute('data-theme', savedTheme);

  themeToggle?.addEventListener('click', () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const nextTheme = isDark ? 'light' : 'dark';
    document.body.setAttribute('data-theme', nextTheme);
    localStorage.setItem('mcp_chat_theme', nextTheme);
  });

  // Sidebar Toggle
  function toggleSidebar() {
    sidebar?.classList.toggle('collapsed');
    const isCollapsed = sidebar?.classList.contains('collapsed');
    if (sidebarExpandBtn) {
      if (isCollapsed) sidebarExpandBtn.classList.add('show');
      else sidebarExpandBtn.classList.remove('show');
    }
  }

  toggleSidebarBtn?.addEventListener('click', toggleSidebar);
  sidebarExpandBtn?.addEventListener('click', toggleSidebar);

  // Voltar ao chat principal
  btnBackChat?.addEventListener('click', () => {
    window.location.href = '/';
  });

  // Seleção de Modos na Sidebar
  modeList?.querySelectorAll('li[data-mode]').forEach((item) => {
    item.addEventListener('click', () => {
      modeList.querySelectorAll('li').forEach(li => li.classList.remove('active'));
      item.classList.add('active');
      currentMode = item.getAttribute('data-mode');
      updateModeView(currentMode);
    });
  });

  function updateModeView(mode) {
    if (mode === 'profile') {
      if (viewTitle) viewTitle.textContent = 'Cases Técnicos & CV // Juliano Soder';
      if (remoteMessages) remoteMessages.style.display = 'none';
      if (profileCheatsheet) profileCheatsheet.style.display = 'flex';
      if (btnToggleListening) btnToggleListening.style.display = 'none';
    } else if (mode === 'translation') {
      if (viewTitle) viewTitle.textContent = 'Assistente de Tradução Simultânea';
      if (remoteMessages) remoteMessages.style.display = 'flex';
      if (profileCheatsheet) profileCheatsheet.style.display = 'none';
      if (btnToggleListening) btnToggleListening.style.display = 'inline-flex';
      checkEmptyState();
    } else {
      if (viewTitle) viewTitle.textContent = 'Copiloto em Tempo Real';
      if (remoteMessages) remoteMessages.style.display = 'flex';
      if (profileCheatsheet) profileCheatsheet.style.display = 'none';
      if (btnToggleListening) btnToggleListening.style.display = 'inline-flex';
      checkEmptyState();
    }
  }

  function checkEmptyState() {
    const hasMessages = remoteMessages && remoteMessages.querySelectorAll('.message').length > 0;
    if (emptyStatePlaceholder) {
      emptyStatePlaceholder.style.display = hasMessages ? 'none' : 'block';
    }
  }

  // Limpar Mensagens
  btnClearMessages?.addEventListener('click', () => {
    if (remoteMessages) {
      remoteMessages.querySelectorAll('.message').forEach(m => m.remove());
    }
    turnsMap.clear();
    checkEmptyState();
  });

  // Alternar Escuta
  btnToggleListening?.addEventListener('click', () => {
    if (!streamChannel) return;
    const action = currentMode === 'translation' ? 'toggle_translation' : 'toggle_realtime';
    streamChannel.publish('client-command', { action, timestamp: Date.now() });

    isAssistantListening = !isAssistantListening;
    if (lblListenText) lblListenText.textContent = isAssistantListening ? 'Pausar' : 'Iniciar';
  });

  function setStatus(type, text) {
    if (!statusBadge || !statusText) return;
    statusBadge.className = 'remote-status-badge status-' + type;
    statusText.textContent = text;
  }

  // Busca chave Ably
  async function fetchAblyKey() {
    try {
      const resp = await fetch(ABLY_KEY_URL);
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
          const item = data[data.length - 1];
          if (item && item.content && item.content.includes('.')) {
            return item.content.trim();
          }
        }
      }
    } catch (e) {
      console.error('[AskChat-Server] Erro ao obter chave Ably:', e.message);
    }
    return null;
  }

  // Inicializa Ably
  async function initAbly() {
    setStatus('connecting', 'Conectando...');

    const apiKey = await fetchAblyKey();
    if (!apiKey) {
      setStatus('offline', 'Chave não encontrada');
      return;
    }

    try {
      if (typeof window.Ably === 'undefined') {
        setStatus('offline', 'SDK Indisponível');
        return;
      }

      const clientId = `ask_client_${Math.random().toString(36).substring(2, 8)}`;
      ablyClient = new window.Ably.Realtime({
        key: apiKey,
        clientId: clientId,
        autoConnect: true,
        recovered: true
      });

      ablyClient.connection.on('connected', () => {
        setStatus('online', 'Helper Node Online');
      });

      ablyClient.connection.on('disconnected', () => {
        setStatus('connecting', 'Reconectando...');
      });

      ablyClient.connection.on('failed', () => {
        setStatus('offline', 'Desconectado');
      });

      streamChannel = ablyClient.channels.get(CHANNEL_NAME);
      await streamChannel.attach();

      streamChannel.presence.subscribe((msg) => {
        streamChannel.presence.get((err, members) => {
          if (!err && members) {
            const hasHost = members.some(m => m.data?.role === 'host' || m.clientId?.startsWith('host_'));
            if (hasHost) setStatus('online', 'Helper Node Online');
          }
        });
      });

      await streamChannel.presence.enter({
        role: 'viewer',
        userAgent: navigator.userAgent
      });

      // Eventos do Realtime Assistant
      streamChannel.subscribe('realtime-update', (msg) => {
        handleRealtimeEvent(msg.data);
      });

      // Eventos do Translation Assistant
      streamChannel.subscribe('translation-result', (msg) => {
        handleTranslationEvent(msg.data);
      });

      // Nível de Áudio
      streamChannel.subscribe('translation-level', (msg) => {
        if (msg.data && typeof msg.data.rms === 'number') {
          updateVu(msg.data.rms);
        }
      });

      // Status do Host
      streamChannel.subscribe('host-status', (msg) => {
        if (msg.data) {
          if (msg.data.realtimeActive || msg.data.translationActive) {
            isAssistantListening = true;
            if (lblListenText) lblListenText.textContent = 'Pausar';
          } else {
            isAssistantListening = false;
            if (lblListenText) lblListenText.textContent = 'Iniciar';
          }
        }
      });

      streamChannel.publish('client-command', { action: 'get_status' });

    } catch (err) {
      console.error('[AskChat-Server] Erro Ably:', err);
      setStatus('offline', 'Falha na conexão');
    }
  }

  function updateVu(rms) {
    if (!vuMeterFill) return;
    const pct = Math.min(100, Math.max(0, rms * 1.5));
    vuMeterFill.style.width = pct + '%';
    setTimeout(() => {
      if (vuMeterFill) vuMeterFill.style.width = '0%';
    }, 200);
  }

  // Renderiza evento do Realtime Assistant
  function handleRealtimeEvent(data) {
    if (!data || !remoteMessages) return;
    if (emptyStatePlaceholder) emptyStatePlaceholder.style.display = 'none';

    const { type, id, text, response, audioSource } = data;
    const turnId = id || `turn_${Date.now()}`;
    const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let pair = turnsMap.get(turnId);
    if (!pair) {
      pair = { userEl: null, botEl: null };
      turnsMap.set(turnId, pair);
    }

    const isInterviewer = audioSource === 'sys';

    // Cria/Atualiza balão da fala
    if (type === 'segment_start' || type === 'segment_whisper_correction') {
      if (!pair.userEl) {
        pair.userEl = document.createElement('div');
        pair.userEl.className = 'message user';
        pair.userEl.innerHTML = `
          <div class="bubble">
            <span class="${isInterviewer ? 'interviewer-speaker-badge' : 'candidate-speaker-badge'}">
              ${isInterviewer ? 'Interlocutor / Pergunta' : 'Você (Microfone)'}
            </span>
            <div class="content">${type === 'segment_start' ? '<em>Ouvindo...</em>' : escapeHtml(text || '')}</div>
            <div class="timestamp">${timeStr}</div>
          </div>
        `;
        remoteMessages.appendChild(pair.userEl);
      } else {
        const contentEl = pair.userEl.querySelector('.content');
        if (contentEl && text) contentEl.textContent = text;
      }
    }

    // Cria/Atualiza balão da resposta da IA
    if (type === 'segment_response' && response) {
      if (!pair.botEl) {
        pair.botEl = document.createElement('div');
        pair.botEl.className = 'message bot';
        pair.botEl.innerHTML = `
          <img src="chat.png" class="avatar" alt="Helper Node">
          <div class="bubble">
            <span class="ai-suggestion-badge">Sugestão Helper Node</span>
            <div class="content">${formatMarkdown(response)}</div>
            <div class="timestamp">${timeStr}</div>
          </div>
        `;
        remoteMessages.appendChild(pair.botEl);
      } else {
        const contentEl = pair.botEl.querySelector('.content');
        if (contentEl) contentEl.innerHTML = formatMarkdown(response);
      }
    }

    scrollToBottom();
  }

  // Renderiza evento do Assistente de Tradução
  function handleTranslationEvent(data) {
    if (!data || !remoteMessages) return;
    if (emptyStatePlaceholder) emptyStatePlaceholder.style.display = 'none';

    const { id, transcript, response, mode } = data;
    const turnId = id || `trans_${Date.now()}`;
    const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let pair = turnsMap.get(turnId);
    if (!pair) {
      pair = { userEl: null, botEl: null };
      turnsMap.set(turnId, pair);
    }

    const isCandidate = mode === 'candidate';

    if (!pair.userEl) {
      pair.userEl = document.createElement('div');
      pair.userEl.className = 'message user';
      pair.userEl.innerHTML = `
        <div class="bubble">
          <span class="${isCandidate ? 'candidate-speaker-badge' : 'interviewer-speaker-badge'}">
            ${isCandidate ? 'Você (Candidato)' : 'Áudio em Inglês'}
          </span>
          <div class="content">${escapeHtml(transcript || '')}</div>
          <div class="timestamp">${timeStr}</div>
        </div>
      `;
      remoteMessages.appendChild(pair.userEl);
    } else {
      const contentEl = pair.userEl.querySelector('.content');
      if (contentEl && transcript) contentEl.textContent = transcript;
    }

    if (response) {
      if (!pair.botEl) {
        pair.botEl = document.createElement('div');
        pair.botEl.className = 'message bot';
        pair.botEl.innerHTML = `
          <img src="chat.png" class="avatar" alt="Helper Node">
          <div class="bubble">
            <span class="ai-suggestion-badge">Tradução & Sugestão</span>
            <div class="content">${formatMarkdown(response)}</div>
            <div class="timestamp">${timeStr}</div>
          </div>
        `;
        remoteMessages.appendChild(pair.botEl);
      } else {
        const contentEl = pair.botEl.querySelector('.content');
        if (contentEl) contentEl.innerHTML = formatMarkdown(response);
      }
    }

    scrollToBottom();
  }

  function formatMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^\s*[-*•]\s+(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    html = html.replace(/\n\n/g, '<p></p>');
    html = html.replace(/\n/g, '<br/>');
    return html;
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
  }

  function scrollToBottom() {
    if (remoteMessages) {
      remoteMessages.scrollTop = remoteMessages.scrollHeight;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAbly);
  } else {
    initAbly();
  }
})();
