let ws = null;
let term = null;
let fitAddon = null;
let currentSettings = null;

const connectForm = document.getElementById('connect-form');
const terminalContainer = document.getElementById('terminal-container');
const terminalEl = document.getElementById('terminal');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const saveSessionBtn = document.getElementById('save-session-btn');
const errorMsg = document.getElementById('error-msg');
const connectionInfo = document.getElementById('connection-info');
const sessionsEl = document.getElementById('sessions');
const settingsBtn = document.getElementById('settings-btn');
const connectSettingsBtn = document.getElementById('connect-settings-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsSaveBtn = document.getElementById('settings-save-btn');
const settingsCancelBtn = document.getElementById('settings-cancel-btn');

connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);
saveSessionBtn.addEventListener('click', saveSession);
settingsBtn.addEventListener('click', openSettings);
connectSettingsBtn.addEventListener('click', openSettings);
settingsCloseBtn.addEventListener('click', closeSettings);
settingsCancelBtn.addEventListener('click', closeSettings);
settingsSaveBtn.addEventListener('click', saveSettings);

settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettings();
});

document.querySelectorAll('#connect-form input').forEach(input => {
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') connect();
    });
});

loadSessions();
loadSettings();

async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        currentSettings = await res.json();
    } catch (e) {
        currentSettings = {
            ssh: { connectionTimeout: 10, keepAliveInterval: 30, keepAliveMaxFails: 3 },
            terminal: { fontSize: 14, cursorStyle: 'block', cursorBlink: true, scrollbackLines: 1000 }
        };
    }
}

function connect() {
    const host = document.getElementById('host').value.trim();
    const port = parseInt(document.getElementById('port').value) || 22;
    const user = document.getElementById('user').value.trim();
    const password = document.getElementById('password').value;

    if (!host || !user) {
        showError('Host and User are required');
        return;
    }

    hideError();
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    let connectTimeout = setTimeout(() => {
        if (ws && ws.readyState !== WebSocket.CLOSED) {
            ws.close();
        }
        showError('Connection timed out');
        resetConnectBtn();
        ws = null;
    }, 15000);

    ws.onopen = () => {
        ws.send(JSON.stringify({
            type: 'connect',
            data: JSON.stringify({ host, port, user, password })
        }));
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
            case 'connected':
                clearTimeout(connectTimeout);
                showTerminal(host, user);
                break;
            case 'output':
                if (term) term.write(msg.data);
                break;
            case 'error':
                clearTimeout(connectTimeout);
                showError(msg.data);
                resetConnectBtn();
                break;
        }
    };

    ws.onclose = () => {
        clearTimeout(connectTimeout);
        if (term) {
            term.write('\r\n\x1b[31m[Connection closed]\x1b[0m\r\n');
        }
    };

    ws.onerror = () => {
        clearTimeout(connectTimeout);
        showError('WebSocket connection failed');
        resetConnectBtn();
    };
}

function showTerminal(host, user) {
    connectForm.classList.add('hidden');
    terminalContainer.classList.remove('hidden');
    document.getElementById('app').classList.add('terminal-mode');
    connectionInfo.textContent = `${user}@${host}`;

    const termSettings = currentSettings ? currentSettings.terminal : {};

    term = new Terminal({
        cursorBlink: termSettings.cursorBlink !== undefined ? termSettings.cursorBlink : true,
        cursorStyle: termSettings.cursorStyle || 'block',
        fontSize: termSettings.fontSize || 14,
        scrollback: termSettings.scrollbackLines !== undefined ? termSettings.scrollbackLines : 1000,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: {
            background: '#0f0f23',
            foreground: '#ffffff',
            cursor: '#00d9ff',
            cursorAccent: '#0f0f23',
            selection: 'rgba(0, 217, 255, 0.3)'
        }
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalEl);
    fitAddon.fit();

    term.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input', data }));
        }
    });

    term.onResize(({ cols, rows }) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'resize',
                data: JSON.stringify({ cols, rows })
            }));
        }
    });

    window.addEventListener('resize', () => {
        if (fitAddon) fitAddon.fit();
    });

    setTimeout(() => {
        fitAddon.fit();
        ws.send(JSON.stringify({
            type: 'resize',
            data: JSON.stringify({ cols: term.cols, rows: term.rows })
        }));
    }, 100);

    term.focus();
}

function disconnect() {
    if (ws) {
        ws.close();
        ws = null;
    }
    if (term) {
        term.dispose();
        term = null;
    }
    terminalContainer.classList.add('hidden');
    connectForm.classList.remove('hidden');
    document.getElementById('app').classList.remove('terminal-mode');
    resetConnectBtn();
}

function openSettings() {
    if (!currentSettings) return;
    document.getElementById('setting-connection-timeout').value = currentSettings.ssh.connectionTimeout;
    document.getElementById('setting-keepalive-interval').value = currentSettings.ssh.keepAliveInterval;
    document.getElementById('setting-keepalive-max-fails').value = currentSettings.ssh.keepAliveMaxFails;
    document.getElementById('setting-font-size').value = currentSettings.terminal.fontSize;
    document.getElementById('setting-cursor-style').value = currentSettings.terminal.cursorStyle;
    document.getElementById('setting-cursor-blink').checked = currentSettings.terminal.cursorBlink;
    document.getElementById('setting-scrollback-lines').value = currentSettings.terminal.scrollbackLines;
    settingsOverlay.classList.remove('hidden');
}

function closeSettings() {
    settingsOverlay.classList.add('hidden');
    if (term) term.focus();
}

async function saveSettings() {
    const settings = {
        ssh: {
            connectionTimeout: parseInt(document.getElementById('setting-connection-timeout').value) || 10,
            keepAliveInterval: parseInt(document.getElementById('setting-keepalive-interval').value) || 0,
            keepAliveMaxFails: parseInt(document.getElementById('setting-keepalive-max-fails').value) || 3,
        },
        terminal: {
            fontSize: parseInt(document.getElementById('setting-font-size').value) || 14,
            cursorStyle: document.getElementById('setting-cursor-style').value,
            cursorBlink: document.getElementById('setting-cursor-blink').checked,
            scrollbackLines: parseInt(document.getElementById('setting-scrollback-lines').value) || 0,
        }
    };

    try {
        const res = await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        if (!res.ok) {
            const err = await res.json();
            showError(err.error || 'Failed to save settings');
            return;
        }
        currentSettings = await res.json();
        closeSettings();

        if (term) {
            term.options.fontSize = currentSettings.terminal.fontSize;
            term.options.cursorStyle = currentSettings.terminal.cursorStyle;
            term.options.cursorBlink = currentSettings.terminal.cursorBlink;
            term.options.scrollback = currentSettings.terminal.scrollbackLines;
            if (fitAddon) fitAddon.fit();
        }
    } catch (e) {
        showError('Failed to save settings');
    }
}

function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.add('show');
}

function hideError() {
    errorMsg.classList.remove('show');
}

function resetConnectBtn() {
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect';
}

async function loadSessions() {
    try {
        const res = await fetch('/api/sessions');
        const sessions = await res.json();
        renderSessions(sessions);
    } catch (e) {
        // silent fail
    }
}

function renderSessions(sessions) {
    if (!sessions || sessions.length === 0) {
        sessionsEl.innerHTML = '<p class="no-sessions">No saved sessions</p>';
        return;
    }

    sessionsEl.innerHTML = sessions.map(s => `
        <div class="session-item" data-id="${s.id}">
            <div class="session-info" onclick="fillSession('${s.host}', ${s.port}, '${s.user}')">
                <span class="session-name">${escapeHtml(s.name)}</span>
                <span class="session-detail">${escapeHtml(s.user)}@${escapeHtml(s.host)}:${s.port}</span>
            </div>
            <button class="session-delete" onclick="deleteSession('${s.id}')">×</button>
        </div>
    `).join('');
}

function fillSession(host, port, user) {
    document.getElementById('host').value = host;
    document.getElementById('port').value = port;
    document.getElementById('user').value = user;
    document.getElementById('password').focus();
}

async function saveSession() {
    const host = document.getElementById('host').value.trim();
    const port = parseInt(document.getElementById('port').value) || 22;
    const user = document.getElementById('user').value.trim();

    if (!host || !user) {
        showError('Host and User are required to save');
        return;
    }

    const name = `${user}@${host}`;

    try {
        const res = await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, host, port, user })
        });
        if (!res.ok) throw new Error('Failed to save');
        await loadSessions();
    } catch (e) {
        showError('Failed to save session');
    }
}

async function deleteSession(id) {
    try {
        const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete');
        await loadSessions();
    } catch (e) {
        showError('Failed to delete session');
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
