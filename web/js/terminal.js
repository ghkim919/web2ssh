const MAX_TABS = 10;
let tabIdCounter = 0;
let tabs = {};
let activeTabId = null;
let pendingTabId = null;
let currentSettings = null;

const connectForm = document.getElementById('connect-form');
const terminalContainer = document.getElementById('terminal-container');
const terminalsWrapper = document.getElementById('terminals-wrapper');
const connectBtn = document.getElementById('connect-btn');
const connectCancelBtn = document.getElementById('connect-cancel-btn');
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
const tabList = document.getElementById('tab-list');
const newTabBtn = document.getElementById('new-tab-btn');

connectBtn.addEventListener('click', connect);
connectCancelBtn.addEventListener('click', cancelNewTab);
disconnectBtn.addEventListener('click', () => {
    if (activeTabId !== null) disconnectTab(activeTabId);
});
saveSessionBtn.addEventListener('click', saveSession);
settingsBtn.addEventListener('click', openSettings);
connectSettingsBtn.addEventListener('click', openSettings);
settingsCloseBtn.addEventListener('click', closeSettings);
settingsCancelBtn.addEventListener('click', closeSettings);
settingsSaveBtn.addEventListener('click', saveSettings);
newTabBtn.addEventListener('click', requestNewTab);

settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettings();
});

document.querySelectorAll('#connect-form input').forEach(input => {
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') connect();
    });
});

document.getElementById('auth-type').addEventListener('change', (e) => {
    const isKey = e.target.value === 'key';
    document.getElementById('auth-password-fields').classList.toggle('hidden', isKey);
    document.getElementById('auth-key-fields').classList.toggle('hidden', !isKey);
});

window.addEventListener('resize', () => {
    if (activeTabId !== null && tabs[activeTabId] && tabs[activeTabId].fitAddon) {
        tabs[activeTabId].fitAddon.fit();
    }
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

function createTab() {
    if (Object.keys(tabs).length >= MAX_TABS) return null;

    const id = ++tabIdCounter;
    const terminalEl = document.createElement('div');
    terminalEl.className = 'terminal-pane';
    terminalEl.id = `terminal-pane-${id}`;
    terminalsWrapper.appendChild(terminalEl);

    tabs[id] = {
        id,
        ws: null,
        term: null,
        fitAddon: null,
        terminalEl,
        label: 'New Tab',
        state: 'form',
        connectTimeout: null,
        connInfo: null,
    };

    renderTabBar();
    return id;
}

function renderTabBar() {
    tabList.innerHTML = '';
    const ids = Object.keys(tabs).map(Number);

    ids.forEach(id => {
        const tab = tabs[id];
        const item = document.createElement('div');
        item.className = 'tab-item' + (id === activeTabId ? ' active' : '');
        item.dataset.tabId = id;

        const label = document.createElement('span');
        label.className = 'tab-label';
        label.textContent = tab.label;
        item.appendChild(label);

        const close = document.createElement('button');
        close.className = 'tab-close';
        close.textContent = '\u00d7';
        close.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(id);
        });
        item.appendChild(close);

        item.addEventListener('click', () => switchTab(id));
        tabList.appendChild(item);
    });

    if (Object.keys(tabs).length >= MAX_TABS) {
        newTabBtn.style.display = 'none';
    } else {
        newTabBtn.style.display = '';
    }
}

function switchTab(tabId) {
    if (!tabs[tabId] || tabId === activeTabId) return;

    if (activeTabId !== null && tabs[activeTabId]) {
        tabs[activeTabId].terminalEl.classList.remove('active');
    }

    activeTabId = tabId;
    const tab = tabs[tabId];
    tab.terminalEl.classList.add('active');

    if (tab.state === 'connected') {
        connectionInfo.textContent = tab.label;
        disconnectBtn.disabled = false;
    } else if (tab.state === 'disconnected') {
        connectionInfo.textContent = tab.label + ' [disconnected]';
        disconnectBtn.disabled = true;
    } else {
        connectionInfo.textContent = '';
        disconnectBtn.disabled = true;
    }

    renderTabBar();

    if (tab.fitAddon && tab.term) {
        requestAnimationFrame(() => {
            tab.fitAddon.fit();
            if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
                tab.ws.send(JSON.stringify({
                    type: 'resize',
                    data: JSON.stringify({ cols: tab.term.cols, rows: tab.term.rows })
                }));
            }
            tab.term.focus();
        });
    }
}

function closeTab(tabId) {
    const tab = tabs[tabId];
    if (!tab) return;

    if (tab.connectTimeout) clearTimeout(tab.connectTimeout);
    if (tab.ws) {
        tab.ws.onclose = null;
        tab.ws.close();
    }
    if (tab.term) tab.term.dispose();
    if (tab.terminalEl && tab.terminalEl.parentNode) {
        tab.terminalEl.parentNode.removeChild(tab.terminalEl);
    }

    delete tabs[tabId];

    if (pendingTabId === tabId) {
        pendingTabId = null;
        hideConnectFormOverlay();
    }

    const ids = Object.keys(tabs).map(Number);
    if (ids.length === 0) {
        activeTabId = null;
        showInitialScreen();
    } else {
        if (activeTabId === tabId) {
            const idx = ids.length - 1;
            activeTabId = null;
            switchTab(ids[idx]);
        } else {
            renderTabBar();
        }
    }
}

function showInitialScreen() {
    terminalContainer.classList.add('hidden');
    connectForm.classList.remove('hidden');
    connectForm.classList.remove('overlay-mode');
    connectCancelBtn.classList.add('hidden');
    document.getElementById('app').classList.remove('terminal-mode');
    resetConnectBtn();
}

function requestNewTab() {
    const tabId = createTab();
    if (tabId === null) return;

    pendingTabId = tabId;
    switchTab(tabId);
    showConnectFormOverlay();
}

function showConnectFormOverlay() {
    connectForm.classList.remove('hidden');
    connectForm.classList.add('overlay-mode');
    connectCancelBtn.classList.remove('hidden');
    resetConnectBtn();
    hideError();
    document.getElementById('password').value = '';
    document.getElementById('passphrase').value = '';
    document.getElementById('auth-type').value = 'password';
    document.getElementById('auth-password-fields').classList.remove('hidden');
    document.getElementById('auth-key-fields').classList.add('hidden');
    document.getElementById('key-path').value = '';
    terminalsWrapper.appendChild(connectForm);
}

function hideConnectFormOverlay() {
    connectForm.classList.add('hidden');
    connectForm.classList.remove('overlay-mode');
    connectCancelBtn.classList.add('hidden');
    document.getElementById('app').appendChild(connectForm);
}

function cancelNewTab() {
    if (pendingTabId !== null) {
        const tabId = pendingTabId;
        pendingTabId = null;
        closeTab(tabId);
    }
}

function connect() {
    const host = document.getElementById('host').value.trim();
    const port = parseInt(document.getElementById('port').value) || 22;
    const user = document.getElementById('user').value.trim();
    const authType = document.getElementById('auth-type').value;
    const password = document.getElementById('password').value;
    const keyPath = document.getElementById('key-path').value.trim();
    const passphrase = document.getElementById('passphrase').value;

    if (!host || !user) {
        showError('Host and User are required');
        return;
    }

    if (authType === 'key' && !keyPath) {
        showError('Key Path is required for SSH Key authentication');
        return;
    }

    hideError();
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';

    let tabId = pendingTabId;

    if (tabId === null) {
        tabId = createTab();
        if (tabId === null) {
            showError('Maximum tabs reached');
            resetConnectBtn();
            return;
        }
        pendingTabId = tabId;
    }

    const tab = tabs[tabId];
    tab.label = `${user}@${host}`;
    tab.state = 'connecting';
    renderTabBar();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    tab.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    tab.connectTimeout = setTimeout(() => {
        if (tab.ws && tab.ws.readyState !== WebSocket.CLOSED) {
            tab.ws.close();
        }
        showError('Connection timed out');
        resetConnectBtn();
        tab.state = 'form';
        tab.ws = null;
    }, 15000);

    tab.ws.onopen = () => {
        const connectData = { host, port, user, authType };
        if (authType === 'key') {
            connectData.keyPath = keyPath;
            connectData.passphrase = passphrase;
        } else {
            connectData.password = password;
        }
        tab.ws.send(JSON.stringify({
            type: 'connect',
            data: JSON.stringify(connectData)
        }));
    };

    tab.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
            case 'connected':
                clearTimeout(tab.connectTimeout);
                tab.state = 'connected';
                tab.connInfo = { host, port, user, authType, keyPath };
                pendingTabId = null;

                if (Object.keys(tabs).length === 1 && !document.getElementById('app').classList.contains('terminal-mode')) {
                    terminalContainer.classList.remove('hidden');
                    connectForm.classList.add('hidden');
                    connectForm.classList.remove('overlay-mode');
                    connectCancelBtn.classList.add('hidden');
                    document.getElementById('app').classList.add('terminal-mode');
                    document.getElementById('app').appendChild(connectForm);
                } else {
                    hideConnectFormOverlay();
                }

                initTerminalForTab(tab);
                switchTab(tabId);
                break;
            case 'output':
                if (tab.term) tab.term.write(msg.data);
                break;
            case 'error':
                clearTimeout(tab.connectTimeout);
                showError(msg.data);
                resetConnectBtn();
                tab.state = 'form';
                break;
        }
    };

    tab.ws.onclose = () => {
        clearTimeout(tab.connectTimeout);
        if (tab.state === 'connected') {
            tab.state = 'disconnected';
            if (tab.term) {
                tab.term.write('\r\n\x1b[31m[Connection closed]\x1b[0m\r\n');
            }
            if (activeTabId === tabId) {
                connectionInfo.textContent = tab.label + ' [disconnected]';
                disconnectBtn.disabled = true;
            }
        }
    };

    tab.ws.onerror = () => {
        clearTimeout(tab.connectTimeout);
        if (tab.state === 'connecting') {
            showError('WebSocket connection failed');
            resetConnectBtn();
            tab.state = 'form';
        }
    };
}

function initTerminalForTab(tab) {
    const termSettings = currentSettings ? currentSettings.terminal : {};

    tab.term = new Terminal({
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

    tab.fitAddon = new FitAddon.FitAddon();
    tab.term.loadAddon(tab.fitAddon);
    tab.term.open(tab.terminalEl);
    tab.fitAddon.fit();

    tab.term.onData((data) => {
        if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
            tab.ws.send(JSON.stringify({ type: 'input', data }));
        }
    });

    tab.term.onResize(({ cols, rows }) => {
        if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
            tab.ws.send(JSON.stringify({
                type: 'resize',
                data: JSON.stringify({ cols, rows })
            }));
        }
    });

    setTimeout(() => {
        tab.fitAddon.fit();
        if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
            tab.ws.send(JSON.stringify({
                type: 'resize',
                data: JSON.stringify({ cols: tab.term.cols, rows: tab.term.rows })
            }));
        }
    }, 100);

    tab.term.focus();
}

function disconnectTab(tabId) {
    const tab = tabs[tabId];
    if (!tab) return;

    if (tab.ws) {
        tab.ws.close();
        tab.ws = null;
    }
    tab.state = 'disconnected';

    if (activeTabId === tabId) {
        connectionInfo.textContent = tab.label + ' [disconnected]';
        disconnectBtn.disabled = true;
    }
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
    if (activeTabId !== null && tabs[activeTabId] && tabs[activeTabId].term) {
        tabs[activeTabId].term.focus();
    }
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

        Object.values(tabs).forEach(tab => {
            if (tab.term) {
                tab.term.options.fontSize = currentSettings.terminal.fontSize;
                tab.term.options.cursorStyle = currentSettings.terminal.cursorStyle;
                tab.term.options.cursorBlink = currentSettings.terminal.cursorBlink;
                tab.term.options.scrollback = currentSettings.terminal.scrollbackLines;
                if (tab.fitAddon) tab.fitAddon.fit();
            }
        });
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
            <div class="session-info" onclick="fillSession('${s.host}', ${s.port}, '${s.user}', '${s.authType || 'password'}', '${s.keyPath || ''}')">
                <span class="session-name">${escapeHtml(s.name)}</span>
                <span class="session-detail">${escapeHtml(s.user)}@${escapeHtml(s.host)}:${s.port}${s.authType === 'key' ? ' [key]' : ''}</span>
            </div>
            <button class="session-delete" onclick="deleteSession('${s.id}')">×</button>
        </div>
    `).join('');
}

function fillSession(host, port, user, authType, keyPath) {
    document.getElementById('host').value = host;
    document.getElementById('port').value = port;
    document.getElementById('user').value = user;

    const authTypeEl = document.getElementById('auth-type');
    authTypeEl.value = authType || 'password';
    const isKey = authTypeEl.value === 'key';
    document.getElementById('auth-password-fields').classList.toggle('hidden', isKey);
    document.getElementById('auth-key-fields').classList.toggle('hidden', !isKey);
    document.getElementById('key-path').value = keyPath || '';
    document.getElementById('passphrase').value = '';
    document.getElementById('password').value = '';

    if (isKey) {
        document.getElementById('passphrase').focus();
    } else {
        document.getElementById('password').focus();
    }
}

async function saveSession() {
    const host = document.getElementById('host').value.trim();
    const port = parseInt(document.getElementById('port').value) || 22;
    const user = document.getElementById('user').value.trim();
    const authType = document.getElementById('auth-type').value;
    const keyPath = document.getElementById('key-path').value.trim();

    if (!host || !user) {
        showError('Host and User are required to save');
        return;
    }

    const name = `${user}@${host}`;
    const body = { name, host, port, user };
    if (authType === 'key') {
        body.authType = authType;
        body.keyPath = keyPath;
    }

    try {
        const res = await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
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

function duplicateTab(tabId) {
    const srcTab = tabs[tabId];
    if (!srcTab || !srcTab.connInfo) return;

    const newTabId = createTab();
    if (newTabId === null) {
        showError('Maximum tabs reached');
        return;
    }

    pendingTabId = newTabId;
    switchTab(newTabId);
    showConnectFormOverlay();

    fillSession(srcTab.connInfo.host, srcTab.connInfo.port, srcTab.connInfo.user, srcTab.connInfo.authType, srcTab.connInfo.keyPath);
}

const tabContextMenu = document.getElementById('tab-context-menu');
let contextMenuTabId = null;

tabList.addEventListener('contextmenu', (e) => {
    const tabItem = e.target.closest('.tab-item');
    if (!tabItem) return;
    e.preventDefault();

    contextMenuTabId = Number(tabItem.dataset.tabId);
    const tab = tabs[contextMenuTabId];

    const dupBtn = document.getElementById('ctx-duplicate');
    dupBtn.disabled = !tab || !tab.connInfo;

    tabContextMenu.classList.remove('hidden');
    let x = e.clientX;
    let y = e.clientY;
    const rect = tabContextMenu.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width;
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height;
    tabContextMenu.style.left = x + 'px';
    tabContextMenu.style.top = y + 'px';
});

function hideContextMenu() {
    tabContextMenu.classList.add('hidden');
    contextMenuTabId = null;
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContextMenu();
});

document.getElementById('ctx-duplicate').addEventListener('click', () => {
    if (contextMenuTabId !== null) duplicateTab(contextMenuTabId);
    hideContextMenu();
});

document.getElementById('ctx-close').addEventListener('click', () => {
    if (contextMenuTabId !== null) closeTab(contextMenuTabId);
    hideContextMenu();
});

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
