const LOCALSTORAGE_KEY = 'mcp_chat_sessions_v1';
const THEME_KEY = 'mcp_chat_theme';
const MODEL_KEY = 'mcp_chat_selected_model';
let backendUrl = '';
let sessions = [];
let activeSessionIndex = 0;

function uuidv4() {
  // Gera um UUID básico
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function getSelectedEndpoint() {
  const select = document.getElementById('modelSelect');
  return select ? select.value : '/llama3-rag';
}

async function fetchBackendUrl() {
  try {
    const response = await fetch('https://abra-api.top/notifications/retrieve?key=ngrockurl');
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      const lastNotification = data[data.length - 1];
      if (lastNotification && lastNotification.content) {
        backendUrl = lastNotification.content;
        return backendUrl;
      }
    }
    throw new Error('Nenhuma URL de backend encontrada.');
  } catch (e) {
    alert('Erro ao buscar backend: ' + e.message);
    backendUrl = '';
  }
}

function loadSessions() {
  const data = localStorage.getItem(LOCALSTORAGE_KEY);
  if (data) {
    sessions = JSON.parse(data);
  } else {
    sessions = [];
  }
}

function saveSessions() {
  localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(sessions));
}

function createNewSession() {
  const timestamp = new Date().toISOString();
  const newSession = {
    id: uuidv4(),
    title: 'Novo chat',
    messages: [],
    createdAt: timestamp
  };
  sessions.unshift(newSession);
  activeSessionIndex = 0;
  saveSessions();
  renderSessions();
  renderMessages();
}

function renderSessions() {
  const chatHistory = document.getElementById('chatHistory');
  chatHistory.innerHTML = '';
  sessions.forEach((sess, i) => {
    const li = document.createElement('li');
    li.textContent = sess.title || 'Chat sem título';
    if (i === activeSessionIndex) li.classList.add('active');
    li.onclick = () => {
      activeSessionIndex = i;
      renderSessions();
      renderMessages();
    };
    chatHistory.appendChild(li);
  });
}

function renderMessages() {
  const messagesEl = document.getElementById('messages');
  messagesEl.innerHTML = '';
  if (!sessions[activeSessionIndex]) return;
  sessions[activeSessionIndex].messages.forEach(msg => {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message ' + msg.role;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = processMarkdown(msg.content);
    msgDiv.appendChild(bubble);
    messagesEl.appendChild(msgDiv);
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function processMarkdown(text) {
  let html = text;
  
  // Processa blocos de código (```)
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    const escapedCode = code.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const copyBtn = `<button class="code-copy-btn" onclick="copyToClipboard(this)">Copiar</button>`;
    return `<div class="code-block">${copyBtn}<pre><code>${escapedCode}</code></pre></div>`;
  });
  
  // Processa código inline (`)
  html = html.replace(/`([^`]+?)`/g, (match, code) => {
    const escapedCode = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<code class="inline-code">${escapedCode}</code>`;
  });
  
  // Processa negrito (**)
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Processa quebras de linha
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

function copyToClipboard(btn) {
  const codeBlock = btn.nextElementSibling;
  const code = codeBlock.textContent;
  navigator.clipboard.writeText(code).then(() => {
    const originalText = btn.textContent;
    btn.textContent = 'Copiado!';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2000);
  });
}

function updateSessionTitleIfNeeded(prompt) {
  const sess = sessions[activeSessionIndex];
  if (sess.title === 'Novo chat' && prompt) {
    sess.title = prompt.slice(0, 32).replace(/(\r|\n|\t)/g, '');
    saveSessions();
    renderSessions();
  }
}

async function summarizeContext(session) {
  // Pega todas as mensagens após o último resumo (ou desde o início)
  const messagesToSummarize = session.messages.slice(session.lastSummarizedIndex || 0);
  if (messagesToSummarize.length === 0) return;

  const summaryPrompt = `INSTRUÇÃO: Resuma a conversa abaixo para manter a memória do chat. 
IMPORTANTE: Preserve nomes de ferramentas (ex: Ollama), modelos específicos, tecnologias e o objetivo atual do usuário.
Limite o resumo a 5-8 linhas de forma densa e informativa.\n\n` +
    messagesToSummarize.map(m => `${m.role === 'user' ? 'Usuário' : 'IA'}: ${m.content}`).join('\n');

  try {
    const response = await fetch(backendUrl + '/llama3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: summaryPrompt, language: 'PORTUGUESE' })
    });
    
    let summary = '';
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      summary = data.response;
    } else {
      summary = await response.text();
    }

    if (summary) {
      // Atualiza o contexto acumulado
      const oldSummary = session.contextSummary || '';
      session.contextSummary = `Contexto anterior: ${oldSummary}\nNovo resumo: ${summary}`;
      session.lastSummarizedIndex = session.messages.length;
      saveSessions();
    }
  } catch (err) {
    console.error('Erro ao resumir contexto:', err);
  }
}

async function handleSendMessage(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('userInput');
  const prompt = input.value.trim();
  if (!prompt || !backendUrl) return;
  updateSessionTitleIfNeeded(prompt);
  
  const session = sessions[activeSessionIndex];
  
  // Adiciona a mensagem do usuário
  session.messages.push({ role: 'user', content: prompt });
  renderMessages();
  input.value = '';
  input.style.height = 'auto'; // Reseta altura após enviar
  
  // Instrução de Sistema para manter a IA no trilho
  const systemDirective = "DIRETRIZ: Responda de forma direta e técnica. PRIORIZE ABSOLUTAMENTE as informações e tecnologias mencionadas no contexto e histórico abaixo. Se o usuário estiver falando de 'Ollama', não sugira ferramentas de terceiros como IBM ou Microsoft, a menos que solicitado.\n\n";

  // Prepara o contexto para enviar
  let contextPrompt = prompt;
  if (session.contextSummary) {
    // Garantimos que ao menos as últimas 2 mensagens (1 troca completa) 
    // estejam presentes como "ponte", mesmo que já tenham sido resumidas.
    const minHistoryCount = 2;
    let startIndex = session.lastSummarizedIndex || 0;
    
    // Se houver menos de 2 mensagens desde o último resumo, retrocedemos para pegar a ponte
    if ((session.messages.length - 1) - startIndex < minHistoryCount) {
      startIndex = Math.max(0, (session.messages.length - 1) - minHistoryCount);
    }

    const recentMessages = session.messages.slice(startIndex, -1);
    contextPrompt = `${systemDirective}MEMÓRIA DE LONGO PRAZO (RESUMO):\n${session.contextSummary}\n\nCONTIGUIDADE (HISTÓRICO RECENTE):\n`;
    contextPrompt += recentMessages.map(m => `${m.role === 'user' ? 'Usuário' : 'IA'}: ${m.content}`).join('\n');
    contextPrompt += `\n\nPERGUNTA ATUAL DO USUÁRIO: ${prompt}`;
  } else {
    // Se não tem resumo ainda, envia o histórico completo
    const history = session.messages.slice(0, -1);
    if (history.length > 0) {
      contextPrompt = `${systemDirective}HISTÓRICO DA CONVERSA:\n`;
      contextPrompt += history.map(m => `${m.role === 'user' ? 'Usuário' : 'IA'}: ${m.content}`).join('\n');
      contextPrompt += `\n\nPERGUNTA ATUAL DO USUÁRIO: ${prompt}`;
    } else {
      contextPrompt = `${systemDirective}${prompt}`;
    }
  }

  // "Digitando..."
  session.messages.push({ role: 'bot', content: 'Digitando...' });
  renderMessages();

  const endpoint = getSelectedEndpoint();

  try {
    const response = await fetch(backendUrl + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: contextPrompt, language: 'PORTUGUESE' })
    });
    const contentType = response.headers.get('content-type');
    let botResponse = '';
    
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      botResponse = data && data.response ? data.response : 'Erro: resposta não recebida.';
    } else {
      botResponse = await response.text();
    }
    
    // Remove "Digitando..."
    session.messages.pop();
    if (botResponse) {
      session.messages.push({ role: 'bot', content: botResponse });
    } else {
      session.messages.push({ role: 'bot', content: 'Erro: resposta vazia.' });
    }
    
    saveSessions();
    renderMessages();

    // Verifica se atingiu 5 respostas (cada troca user/bot conta como 1 resposta do bot)
    // Contamos o número de mensagens do bot desde o último resumo
    const botMessagesSinceLastSummary = session.messages
      .slice(session.lastSummarizedIndex || 0)
      .filter(m => m.role === 'bot').length;

    if (botMessagesSinceLastSummary >= 5) {
      await summarizeContext(session);
    }

  } catch (err) {
    session.messages.pop();
    session.messages.push({ role: 'bot', content: 'Erro ao conectar ao backend.' });
    renderMessages();
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  loadSessions();
  if (sessions.length === 0) createNewSession();
  else {
    renderSessions();
    renderMessages();
  }
  await fetchBackendUrl();
  
  const userInput = document.getElementById('userInput');
  
  // Auto-ajuste da altura do textarea
  userInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
  });

  // Tecla Enter para enviar, Shift+Enter para nova linha
  userInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  document.getElementById('chatForm').onsubmit = handleSendMessage;
  document.getElementById('newChatBtn').onclick = () => {
    createNewSession();
    document.getElementById('userInput').focus();
  };
  
  // Inicializa o tema
  const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
  document.body.setAttribute('data-theme', savedTheme);
  updateThemeToggleIcon(savedTheme);
  
  // Adiciona evento ao botão de toggle do tema
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  // Inicializa a seleção de modelo
  const modelSelect = document.getElementById('modelSelect');
  if (modelSelect) {
    const savedModel = localStorage.getItem(MODEL_KEY) || '/llama3-rag';
    modelSelect.value = savedModel;
    modelSelect.addEventListener('change', (e) => {
      localStorage.setItem(MODEL_KEY, e.target.value);
    });
  }
  
  // Restaura o estado da sidebar
  const sidebarCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
  if (sidebarCollapsed) {
    document.getElementById('sidebar').classList.add('collapsed');
    document.getElementById('toggleSidebarBtn').textContent = '»';
    document.getElementById('sidebarExpandBtn').classList.add('show');
  }
  
  // Adiciona evento ao botão de toggle da sidebar
  document.getElementById('toggleSidebarBtn').addEventListener('click', toggleSidebar);
  
  // Adiciona evento ao botão flutuante de expandir
  document.getElementById('sidebarExpandBtn').addEventListener('click', toggleSidebar);
});

function toggleTheme() {
  const currentTheme = document.body.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.body.setAttribute('data-theme', newTheme);
  localStorage.setItem(THEME_KEY, newTheme);
  updateThemeToggleIcon(newTheme);
}

function updateThemeToggleIcon(theme) {
  const toggleBtn = document.getElementById('themeToggle');
  toggleBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('toggleSidebarBtn');
  const expandBtn = document.getElementById('sidebarExpandBtn');
  
  sidebar.classList.toggle('collapsed');
  
  // Salva o estado no localStorage
  const isCollapsed = sidebar.classList.contains('collapsed');
  localStorage.setItem('sidebar_collapsed', isCollapsed);
  
  // Muda o ícone do botão de toggle
  toggleBtn.textContent = isCollapsed ? '»' : '«';
  
  // Mostra/esconde o botão flutuante
  if (isCollapsed) {
    expandBtn.classList.add('show');
  } else {
    expandBtn.classList.remove('show');
  }
}
