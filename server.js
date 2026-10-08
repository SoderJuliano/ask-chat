// server.js — Lógica de visualização e controle remoto do Helper Node no Ask-Chat (/server)
// Conexão via Ably Realtime com busca dinâmica de chave segura via abra-api.top.

(function() {
  'use strict';

  const ABLY_KEY_URL = 'https://abra-api.top/notifications/retrieve?key=YXNrLWNoYXQtYXBpa2V5LWhlbHBlci1ub2Rl';
  const CHANNEL_NAME = 'helper-node-remote-stream-v1';
  
  let ablyClient = null;
  let streamChannel = null;
  let isHostConnected = false;
  let activeTab = 'tab-realtime';
  let isAssistantActive = false;

  const turnsMap = new Map(); // id -> DOMElement

  // Elementos do DOM
  const statusPill = document.getElementById('connection-status');
  const statusLabel = document.getElementById('status-label');
  const vuBar = document.getElementById('vu-bar-level');
  const toggleBtn = document.getElementById('btn-toggle-assistant');
  const toggleIcon = document.getElementById('toggle-icon');
  const toggleLabel = document.getElementById('toggle-label');
  const clearBtn = document.getElementById('btn-clear-stream');
  const realtimeList = document.getElementById('realtime-stream-list');
  const translationList = document.getElementById('translation-stream-list');
  const realtimeEmpty = document.getElementById('realtime-empty');
  const translationEmpty = document.getElementById('translation-empty');
  const tabButtons = document.querySelectorAll('.tab-btn');

  // Inicialização de Abas
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      activeTab = btn.getAttribute('data-tab');
      const targetContent = document.getElementById(activeTab);
      if (targetContent) targetContent.classList.add('active');
    });
  });

  // Limpar histórico na tela
  clearBtn?.addEventListener('click', () => {
    if (realtimeList) {
      realtimeList.querySelectorAll('.bubble-turn').forEach(el => el.remove());
      if (realtimeEmpty) realtimeEmpty.style.display = 'block';
    }
    if (translationList) {
      translationList.querySelectorAll('.bubble-turn').forEach(el => el.remove());
      if (translationEmpty) translationEmpty.style.display = 'block';
    }
    turnsMap.clear();
  });

  // Botão de alternar Assistente (Comando Remoto)
  toggleBtn?.addEventListener('click', () => {
    if (!streamChannel) return;
    const action = activeTab === 'tab-translation' ? 'toggle_translation' : 'toggle_realtime';
    streamChannel.publish('client-command', { action, timestamp: Date.now() });
    
    // Feedback visual imediato
    isAssistantActive = !isAssistantActive;
    updateAssistantToggleUI(isAssistantActive);
  });

  function updateAssistantToggleUI(active) {
    if (toggleIcon) toggleIcon.textContent = active ? '⏸️' : '▶️';
    if (toggleLabel) toggleLabel.textContent = active ? 'Pausar' : 'Iniciar';
    if (toggleBtn) {
      if (active) {
        toggleBtn.classList.remove('action-primary');
        toggleBtn.classList.add('action-secondary');
      } else {
        toggleBtn.classList.remove('action-secondary');
        toggleBtn.classList.add('action-primary');
      }
    }
  }

  function setConnectionStatus(state, label) {
    if (!statusPill || !statusLabel) return;
    statusPill.className = 'status-pill status-' + state;
    statusLabel.textContent = label;
  }

  // Busca a chave do Ably dinamicamente
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

  // Conecta ao Ably e inscreve nos canais
  async function initAbly() {
    setConnectionStatus('connecting', 'Conectando...');

    const apiKey = await fetchAblyKey();
    if (!apiKey) {
      setConnectionStatus('offline', 'Chave não encontrada');
      return;
    }

    try {
      if (typeof window.Ably === 'undefined') {
        console.error('[AskChat-Server] SDK do Ably não carregado no navegador.');
        setConnectionStatus('offline', 'Erro no SDK');
        return;
      }

      const clientId = `client_remote_${Math.random().toString(36).substring(2, 8)}`;
      ablyClient = new window.Ably.Realtime({
        key: apiKey,
        clientId: clientId,
        autoConnect: true,
        recovered: true
      });

      ablyClient.connection.on('connected', () => {
        console.log('[AskChat-Server] Conectado ao Ably Realtime!');
        setConnectionStatus('online', '🟢 Helper Node Online');
      });

      ablyClient.connection.on('disconnected', () => {
        setConnectionStatus('connecting', 'Reconectando...');
      });

      ablyClient.connection.on('failed', () => {
        setConnectionStatus('offline', '🔴 Desconectado');
      });

      streamChannel = ablyClient.channels.get(CHANNEL_NAME);
      await streamChannel.attach();

      // Monitora presença do host (Helper Node)
      streamChannel.presence.subscribe((msg) => {
        streamChannel.presence.get((err, members) => {
          if (!err && members) {
            const hasHost = members.some(m => m.data?.role === 'host' || m.clientId?.startsWith('host_'));
            if (hasHost) {
              setConnectionStatus('online', '🟢 Helper Node Online');
            }
          }
        });
      });

      await streamChannel.presence.enter({
        role: 'viewer',
        userAgent: navigator.userAgent
      });

      // 1. Escuta eventos do Assistente em Tempo Real
      streamChannel.subscribe('realtime-update', (msg) => {
        handleRealtimeUpdate(msg.data);
      });

      // 2. Escuta eventos do Assistente de Tradução
      streamChannel.subscribe('translation-result', (msg) => {
        handleTranslationResult(msg.data);
      });

      // 3. Escuta nível de áudio (VU Meter)
      streamChannel.subscribe('translation-level', (msg) => {
        if (msg.data && typeof msg.data.rms === 'number') {
          updateVuMeter(msg.data.rms);
        }
      });

      // 4. Escuta status geral do Host
      streamChannel.subscribe('host-status', (msg) => {
        handleHostStatus(msg.data);
      });

      // Solicita status atual ao host
      streamChannel.publish('client-command', { action: 'get_status' });

    } catch (err) {
      console.error('[AskChat-Server] Falha ao inicializar Ably:', err);
      setConnectionStatus('offline', 'Falha na conexão');
    }
  }

  function updateVuMeter(rms) {
    if (!vuBar) return;
    const clamped = Math.min(100, Math.max(0, rms * 1.4));
    vuBar.style.width = `${clamped}%`;
    setTimeout(() => {
      if (vuBar) vuBar.style.width = '0%';
    }, 250);
  }

  function handleHostStatus(status) {
    if (!status) return;
    if (status.realtimeActive || status.translationActive) {
      isAssistantActive = true;
      updateAssistantToggleUI(true);
    } else {
      isAssistantActive = false;
      updateAssistantToggleUI(false);
    }
  }

  // Processamento do Assistente em Tempo Real (Realtime Assistant)
  function handleRealtimeUpdate(data) {
    if (!data) return;
    if (realtimeEmpty) realtimeEmpty.style.display = 'none';

    const { type, id, text, response, audioSource } = data;
    const turnId = id || `turn_${Date.now()}`;

    let turnEl = turnsMap.get(turnId);
    if (!turnEl) {
      turnEl = document.createElement('div');
      turnEl.className = 'bubble-turn';
      turnEl.id = `turn-${turnId}`;
      realtimeList.appendChild(turnEl);
      turnsMap.set(turnId, turnEl);
    }

    if (type === 'segment_start') {
      const isInterviewer = audioSource === 'sys';
      turnEl.innerHTML = `
        <div class="${isInterviewer ? 'bubble-question' : 'bubble-candidate'}">
          <div class="bubble-header">
            <span class="bubble-author">${isInterviewer ? '👤 Interlocutor / Pergunta' : '🎙️ Você'}</span>
            <span class="bubble-time">${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </div>
          <div class="bubble-text"><em>Ouvindo...</em></div>
        </div>
      `;
    } else if (type === 'segment_whisper_correction' && text) {
      const isInterviewer = audioSource === 'sys';
      const questionEl = turnEl.querySelector('.bubble-question, .bubble-candidate');
      if (questionEl) {
        const textEl = questionEl.querySelector('.bubble-text');
        if (textEl) textEl.textContent = text;
      } else {
        turnEl.innerHTML = `
          <div class="${isInterviewer ? 'bubble-question' : 'bubble-candidate'}">
            <div class="bubble-header">
              <span class="bubble-author">${isInterviewer ? '👤 Interlocutor' : '🎙️ Você'}</span>
              <span class="bubble-time">${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>
            <div class="bubble-text">${escapeHtml(text)}</div>
          </div>
        `;
      }
    } else if (type === 'segment_response' && response) {
      let respEl = turnEl.querySelector('.bubble-response');
      if (!respEl) {
        respEl = document.createElement('div');
        respEl.className = 'bubble-response';
        respEl.innerHTML = `
          <div class="bubble-header">
            <span class="bubble-author">🤖 Sugestão Helper Node</span>
            <span class="bubble-time">${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </div>
          <div class="response-content"></div>
        `;
        turnEl.appendChild(respEl);
      }
      const contentEl = respEl.querySelector('.response-content');
      if (contentEl) {
        contentEl.innerHTML = formatMarkdownToHtml(response);
      }
    }

    scrollToBottom(realtimeList);
  }

  // Processamento do Assistente de Tradução
  function handleTranslationResult(data) {
    if (!data) return;
    if (translationEmpty) translationEmpty.style.display = 'none';

    const { id, transcript, response, mode } = data;
    const turnId = id || `trans_${Date.now()}`;

    let turnEl = turnsMap.get(turnId);
    if (!turnEl) {
      turnEl = document.createElement('div');
      turnEl.className = 'bubble-turn';
      turnEl.id = `turn-${turnId}`;
      translationList.appendChild(turnEl);
      turnsMap.set(turnId, turnEl);
    }

    const isCandidate = mode === 'candidate';

    turnEl.innerHTML = `
      <div class="${isCandidate ? 'bubble-candidate' : 'bubble-question'}">
        <div class="bubble-header">
          <span class="bubble-author">${isCandidate ? '🎙️ Você (Candidato)' : '🌐 Áudio em Inglês'}</span>
          <span class="bubble-time">${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
        <div class="bubble-text">${escapeHtml(transcript || '')}</div>
      </div>
      ${response ? `
        <div class="bubble-response">
          <div class="bubble-header">
            <span class="bubble-author">💡 Tradução & Sugestão</span>
          </div>
          <div class="response-content">${formatMarkdownToHtml(response)}</div>
        </div>
      ` : ''}
    `;

    scrollToBottom(translationList);
  }

  function formatMarkdownToHtml(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    // Negrito
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Itálico
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Código inline
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Listas / Bullet points
    html = html.replace(/^\s*[-*•]\s+(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    // Quebras de linha
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

  function scrollToBottom(container) {
    if (container && container.parentElement) {
      container.parentElement.scrollTop = container.parentElement.scrollHeight;
    }
  }

  // Inicializar quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAbly);
  } else {
    initAbly();
  }
})();
