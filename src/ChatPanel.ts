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
                        const response = await vscode.commands.executeCommand('modern-clippy.askOpenAIFromPanel', message.text);
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
                <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
                <title>Modern Clippy Chat</title>
                <style>
                    body { font-family: sans-serif; padding: 1em; }
                    textarea { width: 100%; height: 5em; }
                    #response { margin-top: 1em; white-space: pre-wrap; border-top: 1px solid #ccc; padding-top: 1em; }
                </style>
            </head>
            <body>
                <h2>Chat with Modern Clippy</h2>
                <textarea id="input"></textarea><br/>
                <button onclick="sendMessage()">Send</button>
                <div id="response"></div>
                <script>
                    const vscode = acquireVsCodeApi();
                    function sendMessage() {
                        const input = document.getElementById('input').value;
                        vscode.postMessage({ command: 'askOpenAI', text: input });
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.command === 'showResponse') {
                            document.getElementById('response').innerHTML = marked.parse(message.text);
                        }
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
