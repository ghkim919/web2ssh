let ws = null;
let term = null;
let fitAddon = null;

const connectForm = document.getElementById('connect-form');
const terminalContainer = document.getElementById('terminal-container');
const terminalEl = document.getElementById('terminal');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const errorMsg = document.getElementById('error-msg');
const connectionInfo = document.getElementById('connection-info');

connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);

document.querySelectorAll('#connect-form input').forEach(input => {
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') connect();
    });
});

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
                showTerminal(host, user);
                break;
            case 'output':
                if (term) term.write(msg.data);
                break;
            case 'error':
                showError(msg.data);
                resetConnectBtn();
                break;
        }
    };

    ws.onclose = () => {
        if (term) {
            term.write('\r\n\x1b[31m[Connection closed]\x1b[0m\r\n');
        }
    };

    ws.onerror = () => {
        showError('WebSocket connection failed');
        resetConnectBtn();
    };
}

function showTerminal(host, user) {
    connectForm.classList.add('hidden');
    terminalContainer.classList.remove('hidden');
    connectionInfo.textContent = `${user}@${host}`;

    term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
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
    resetConnectBtn();
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
