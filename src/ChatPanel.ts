import * as vscode from 'vscode';

export class ChatPanel {
    public static currentPanel: ChatPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static postMessage(message: any) {
        if (ChatPanel.currentPanel) {
            ChatPanel.currentPanel._panel.webview.postMessage(message);
        }
    }
    
    public static createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        const column = vscode.ViewColumn.Beside;

        if (ChatPanel.currentPanel) {
            ChatPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'modernClippyChat',
            'Modern Clippy Chat',
            { viewColumn: column, preserveFocus: true },
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        ChatPanel.currentPanel = new ChatPanel(panel, extensionUri, context);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'askOpenAI':
                        let response;
                        response = await vscode.commands.executeCommand(
                            'modern-clippy.askOpenAIFromPanel',
                            message.text,
                            message.mode 
                        );
                        

                        this._panel.webview.postMessage({ command: 'showResponse', text: response });
                        break;
                }
            },
            undefined,
            this._disposables
        );
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return /* html */ `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Modern Clippy Chat</title>
            <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
            <style>
                :root {
                    --bg-color: #1e1e1e;
                    --text-color: #d4d4d4;
                    --user-bg: #2c7ad6;
                    --user-bg-hover: #3688e5;
                    --clippy-bg: #2d2d2d;
                    --input-bg: #252526;
                    --border: #3c3c3c;
                    --font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    --scrollbar-thumb: #666;
                    --scrollbar-track: #333;
                    --input-focus: #0e639c;
                    --send-btn-hover: #1177bb;
                    --highlight-color: #0e639c;
                    --transition-speed: 0.2s;
                    --message-shadow: rgba(0, 0, 0, 0.2);
                    --code-bg: #1a1a1a;
                    --code-border: #444;
                    --avatar-size: 28px;
                    --timestamp-color: #888;
                    --danger-color: #e74c3c;
                    --danger-color-hover: #c0392b;
                    --button-hover: #2d2d2d;
                }
    
                * {
                    box-sizing: border-box;
                    margin: 0;
                    padding: 0;
                }
    
                body {
                    background-color: var(--bg-color);
                    color: var(--text-color);
                    font-family: var(--font-family);
                    margin: 0;
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    font-size: 14px;
                    line-height: 1.5;
                }
    
                #app-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 16px;
                    background-color: var(--bg-color);
                    border-bottom: 1px solid var(--border);
                }
                
                .header-left {
                    display: flex;
                    align-items: center;
                }
    
                #app-title {
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--text-color);
                    margin-left: 8px;
                }
                
                #clear-chat {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    color: var(--text-color);
                    border: 1px solid var(--border);
                    border-radius: 4px;
                    padding: 4px 8px;
                    cursor: pointer;
                    transition: all var(--transition-speed) ease;
                }
                
                #clear-chat:hover {
                    background-color: var(--button-hover);
                    color: var(--danger-color);
                }
                
                #clear-chat svg {
                    margin-right: 0;
                }
    
                #chat {
                    flex: 1;
                    overflow-y: auto;
                    padding: 1em;
                    scroll-behavior: smooth;
                }
    
                #chat::-webkit-scrollbar {
                    width: 8px;
                }
    
                #chat::-webkit-scrollbar-track {
                    background: var(--scrollbar-track);
                }
    
                #chat::-webkit-scrollbar-thumb {
                    background-color: var(--scrollbar-thumb);
                    border-radius: 4px;
                }
    
                .message-container {
                    display: flex;
                    margin: 16px 0;
                    position: relative;
                }
    
                .message-container.user {
                    justify-content: flex-end;
                }
    
                .avatar {
                    width: var(--avatar-size);
                    height: var(--avatar-size);
                    border-radius: 50%;
                    margin-right: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background-color: var(--clippy-bg);
                    font-weight: bold;
                    flex-shrink: 0;
                }
    
                .user .avatar {
                    background-color: var(--user-bg);
                    order: 1;
                    margin-right: 0;
                    margin-left: 12px;
                }
    
                .message {
                    padding: 10px 14px;
                    border-radius: 12px;
                    max-width: 70%;
                    word-wrap: break-word;
                    line-height: 1.5;
                    position: relative;
                    box-shadow: 0 1px 2px var(--message-shadow);
                    transition: all var(--transition-speed) ease;
                }
    
                .user .message {
                    background-color: var(--user-bg);
                    border-top-right-radius: 4px;
                    color: white;
                }
    
                .clippy .message {
                    background-color: var(--clippy-bg);
                    border-top-left-radius: 4px;
                }
    
                .message p {
                    margin-bottom: 8px;
                }
    
                .message p:last-child {
                    margin-bottom: 0;
                }
    
                .message pre {
                    background-color: var(--code-bg);
                    border: 1px solid var(--code-border);
                    border-radius: 4px;
                    padding: 8px;
                    overflow-x: auto;
                    margin: 8px 0;
                }
    
                .message code {
                    font-family: 'Consolas', 'Monaco', monospace;
                    font-size: 13px;
                }
    
                .timestamp {
                    font-size: 11px;
                    color: var(--timestamp-color);
                    margin-top: 4px;
                    opacity: 0.8;
                }
    
                #input-area {
                    display: flex;
                    padding: 12px 16px;
                    background-color: var(--input-bg);
                    border-top: 1px solid var(--border);
                }
    
                #input-container {
                    position: relative;
                    flex: 1;
                    display: flex;
                }
    
                #input {
                    flex: 1;
                    background-color: var(--bg-color);
                    color: var(--text-color);
                    border: 1px solid var(--border);
                    padding: 10px 12px;
                    font-size: 14px;
                    border-radius: 8px;
                    resize: none;
                    outline: none;
                    transition: border-color var(--transition-speed) ease;
                    font-family: var(--font-family);
                }
    
                #input:focus {
                    border-color: var(--input-focus);
                }
    
                #send {
                    margin-left: 8px;
                    padding: 8px 16px;
                    background-color: var(--user-bg);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: 500;
                    transition: background-color var(--transition-speed) ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
    
                #send:hover {
                    background-color: var(--user-bg-hover);
                }
    
                #send:active {
                    transform: scale(0.98);
                }
    
                .send-icon {
                    width: 16px;
                    height: 16px;
                    fill: white;
                }
    
                /* Loading indicator */
                .clippy.loading .message::after {
                    content: "";
                    display: inline-block;
                    width: 12px;
                    height: 12px;
                    border: 2px solid var(--text-color);
                    border-radius: 50%;
                    border-top-color: transparent;
                    animation: spin 1s linear infinite;
                    margin-left: 8px;
                    vertical-align: middle;
                }
    
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                
                /* Confirmation dialog styles */
                .overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background-color: rgba(0, 0, 0, 0.5);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 1000;
                    animation: fadeIn 0.2s ease;
                }
                
                .dialog {
                    background-color: var(--bg-color);
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    padding: 16px;
                    width: 300px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                }
                
                .dialog-title {
                    font-size: 16px;
                    font-weight: 500;
                    margin-bottom: 12px;
                    color: var(--text-color);
                }
                
                .dialog-message {
                    margin-bottom: 20px;
                    color: var(--text-color);
                    font-size: 14px;
                    line-height: 1.5;
                }
                
                .dialog-buttons {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                }
                
                .dialog-btn {
                    padding: 6px 12px;
                    border-radius: 4px;
                    font-size: 13px;
                    cursor: pointer;
                    transition: background-color var(--transition-speed) ease;
                }
                
                .btn-cancel {
                    background-color: transparent;
                    border: 1px solid var(--border);
                    color: var(--text-color);
                }
                
                .btn-cancel:hover {
                    background-color: var(--button-hover);
                }
                
                .btn-confirm {
                    background-color: var(--danger-color);
                    border: none;
                    color: white;
                }
                
                .btn-confirm:hover {
                    background-color: var(--danger-color-hover);
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
            </style>
        </head>
        <body>
            <div id="app-header">
                <div class="header-left">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="#0e639c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M2 17L12 22L22 17" stroke="#0e639c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M2 12L12 17L22 12" stroke="#0e639c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span id="app-title">Modern Clippy Chat</span>
                </div>
                <button id="clear-chat" title="Clear Chat History">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M3 6H5H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
            </div>
            <div id="chat"></div>
            <div id="input-area">
                <div id="input-container">
                    <textarea id="input" rows="1" placeholder="Type a message..."></textarea>
                </div>
                <button id="send">
                    <svg class="send-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"></path>
                    </svg>
                </button>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const inputEl = document.getElementById('input');
                let isWaitingForResponse = false;
    
                // Function to auto-resize the textarea based on content
                function autoResizeTextarea() {
                    inputEl.style.height = 'auto';
                    inputEl.style.height = (inputEl.scrollHeight < 120) ? 
                        inputEl.scrollHeight + 'px' : '120px';
                }
    
                // Initial call to set correct height
                autoResizeTextarea();
    
                // Add event listeners for textarea
                inputEl.addEventListener('input', autoResizeTextarea);
    
                document.getElementById('send').addEventListener('click', sendMessage);
                inputEl.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                    }
                });
    
                function getCurrentTime() {
                    const now = new Date();
                    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }
    
                function sendMessage() {
                    if (isWaitingForResponse) return;
                    
                    const text = inputEl.value.trim();
                    if (!text) return;
    
                    appendMessage(text, 'user');
                    showLoadingIndicator();
                    
                    vscode.postMessage({ command: 'askOpenAI', text, mode: 'Chat' });
                    inputEl.value = '';
                    autoResizeTextarea();
                    
                    // Focus back on input after sending
                    inputEl.focus();
                }
    
                function showLoadingIndicator() {
                    isWaitingForResponse = true;
                    
                    const chat = document.getElementById('chat');
                    const container = document.createElement('div');
                    container.className = 'message-container clippy loading';
                    container.id = 'loading-message';
                    
                    const avatar = document.createElement('div');
                    avatar.className = 'avatar';
                    avatar.textContent = 'MC';
                    
                    const message = document.createElement('div');
                    message.className = 'message';
                    message.textContent = 'Thinking...';
                    
                    container.appendChild(avatar);
                    container.appendChild(message);
                    chat.appendChild(container);
                    chat.scrollTop = chat.scrollHeight;
                }
    
                function appendMessage(content, sender) {
                    // Remove loading indicator if exists
                    if (sender === 'clippy') {
                        const loadingEl = document.getElementById('loading-message');
                        if (loadingEl) {
                            loadingEl.remove();
                        }
                        isWaitingForResponse = false;
                    }
                    
                    const chat = document.getElementById('chat');
                    const container = document.createElement('div');
                    container.className = 'message-container ' + sender;
                    
                    const avatar = document.createElement('div');
                    avatar.className = 'avatar';
                    avatar.textContent = sender === 'user' ? 'You' : 'MC';
                    
                    const message = document.createElement('div');
                    message.className = 'message';
                    
                    // Parse markdown
                    message.innerHTML = marked.parse(content);
                    
                    // Add timestamp
                    const timestamp = document.createElement('div');
                    timestamp.className = 'timestamp';
                    timestamp.textContent = getCurrentTime();
                    message.appendChild(timestamp);
                    
                    container.appendChild(avatar);
                    container.appendChild(message);
                    chat.appendChild(container);
                    chat.scrollTop = chat.scrollHeight;
                }
    
                function clearChatHistory() {
                    showConfirmDialog(
                        "Clear Chat History",
                        "Are you sure you want to clear the chat history? This action cannot be undone.",
                        () => {
                            // Clear the chat UI
                            document.getElementById('chat').innerHTML = '';
                            
                            // Send command to extension
                            vscode.postMessage({ command: 'clearChatHistory' });
                            
                            // Add welcome message after clearing
                            setTimeout(() => {
                                appendMessage("👋 Chat history cleared. How can I help you today?", 'clippy');
                            }, 300);
                        }
                    );
                }
                
                function showConfirmDialog(title, message, onConfirm) {
                    // Create overlay
                    const overlay = document.createElement('div');
                    overlay.className = 'overlay';
                    
                    // Create dialog
                    const dialog = document.createElement('div');
                    dialog.className = 'dialog';
                    
                    // Add title
                    const dialogTitle = document.createElement('div');
                    dialogTitle.className = 'dialog-title';
                    dialogTitle.textContent = title;
                    dialog.appendChild(dialogTitle);
                    
                    // Add message
                    const dialogMessage = document.createElement('div');
                    dialogMessage.className = 'dialog-message';
                    dialogMessage.textContent = message;
                    dialog.appendChild(dialogMessage);
                    
                    // Add buttons
                    const dialogButtons = document.createElement('div');
                    dialogButtons.className = 'dialog-buttons';
                    
                    // Cancel button
                    const cancelBtn = document.createElement('button');
                    cancelBtn.className = 'dialog-btn btn-cancel';
                    cancelBtn.textContent = 'Cancel';
                    cancelBtn.onclick = () => {
                        document.body.removeChild(overlay);
                    };
                    dialogButtons.appendChild(cancelBtn);
                    
                    // Confirm button
                    const confirmBtn = document.createElement('button');
                    confirmBtn.className = 'dialog-btn btn-confirm';
                    confirmBtn.textContent = 'Clear';
                    confirmBtn.onclick = () => {
                        onConfirm();
                        document.body.removeChild(overlay);
                    };
                    dialogButtons.appendChild(confirmBtn);
                    
                    dialog.appendChild(dialogButtons);
                    overlay.appendChild(dialog);
                    document.body.appendChild(overlay);
                    
                    // Focus on cancel button by default (safer option)
                    cancelBtn.focus();
                    
                    // Allow ESC key to dismiss
                    const handleKeyDown = (e) => {
                        if (e.key === 'Escape') {
                            document.body.removeChild(overlay);
                            document.removeEventListener('keydown', handleKeyDown);
                        }
                    };
                    document.addEventListener('keydown', handleKeyDown);
                }
    
                // Handle clear chat button
                document.getElementById('clear-chat').addEventListener('click', clearChatHistory);
    
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'showResponse') {
                        appendMessage(message.text, 'clippy');
                    }
                });
                
                // Add welcome message
                window.addEventListener('DOMContentLoaded', () => {
                    setTimeout(() => {
                        appendMessage("👋 Hi there! I'm your coding assistant. How can I help you today?", 'clippy');
                    }, 300);
                });
            </script>
        </body>
        </html>
        `;
    }
    

    public dispose() {
        ChatPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }
}
