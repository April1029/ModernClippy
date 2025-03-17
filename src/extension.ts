// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

interface OpenAIResponse {
    choices?: { message?: { content: string } }[];
    error?: { message: string };
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	//console.log('Congratulations, your extension "modern-clippy" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	// const disposable = vscode.commands.registerCommand('modern-clippy.helloWorld', () => {
	// The code you place here will be executed every time your command is executed
	// Display a message box to the user
	/* vscode.window.showInformationMessage('Hello World from Modern Clippy!');
});

context.subscriptions.push(disposable); */
	// Create Status Bar Button
	let statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.text = "$(smiley) Modern Clippy";
	statusBarItem.tooltip = "Click to Enable Modern Clippy";
	statusBarItem.command = "modern-clippy.enable";
	statusBarItem.show();

	context.subscriptions.push(statusBarItem);

	const enabled = context.globalState.get<boolean>('modernClippyEnabled', false);

	if (!enabled) {
		vscode.window.showInformationMessage("Hello from Modern Clippy! Is it the right time to start the adventure with me?", "Yes", "No")
			.then((selection) => {
				if (selection === "Yes") {
					context.globalState.update('modernClippyEnabled', true);
					startModernClippy(context);
					vscode.window.showInformationMessage("Great! I'm here to help you! ");
				}
				if (selection === "No") {
					vscode.window.showInformationMessage("Okay! I'm always here if you need me! You can enable me anytime by clicking on the Modern Clippy icon in the status bar.");
				}
			});
	} else {
		startModernClippy(context);

	}

	// Register the command to enable Modern Clippy manually
	let enableModernClippy = vscode.commands.registerCommand('modern-clippy.enable', () => {
		vscode.window.showInformationMessage("Enable Modern Clippy now?", "Yes", "No")
			.then((selection) => {
				if (selection === "Yes") {
					context.globalState.update('modernClippyEnabled', true);
					startModernClippy(context);
					vscode.window.showInformationMessage("Great! I'm here to help you! ");
				}
			});
	});

	context.subscriptions.push(enableModernClippy);

	// Register the command to scan the document periodically
	let lastSentContent: string = ""; // Store the last file content to avoid unnecessary API calls

	// Set up the interval to periodically scan the file
	let scanInterval = setInterval(() => analyzeFile(lastSentContent), 30000); // 30 seconds
	context.subscriptions.push({ dispose: () => clearInterval(scanInterval) });

	let analyzeFileCommand = vscode.commands.registerCommand('modern-clippy.analyzeFile', () => {
		analyzeFile();
	});
	context.subscriptions.push(analyzeFileCommand);
	

	// Register the command for interactions with OenAI
	let openAICommand = vscode.commands.registerCommand('modern-clippy.askOpenAI', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage("Open a file to interact with OpenAI");
			return;
		}

		const prompt = await vscode.window.showInputBox({ placeHolder: "Ask a question to OpenAI" });
		if (!prompt) {
			return;
		}

		vscode.window.showInformationMessage("Asking OpenAI...");
		const response = await callOpenAI(prompt);
		vscode.window.showInformationMessage(response);
	});
	context.subscriptions.push(openAICommand);
}

function startModernClippy(context: vscode.ExtensionContext) {
	vscode.window.showInformationMessage("Modern Clippy is now enabled!");

	let disposable = vscode.commands.registerCommand('modern-clippy.start', () => {
		vscode.window.showInformationMessage("Modern Clippy is here to help you!");
	});
	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }

async function analyzeFile(lastSentContent: string) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showErrorMessage("Open a file to analyze");
		return;
	}

	const fileContent = editor.document.getText();
	if (fileContent === lastSentContent) {
		vscode.window.showInformationMessage("No changes in the file");
		return;
	}

	// If there is a change, send only the modified content to OpenAI
	const modifiedContent = fileContent.substring(lastSentContent.length);
	const response = await callOpenAI(modifiedContent);
	// Update the last sent file content to the current
	lastSentContent = fileContent;
	vscode.window.showInformationMessage("Show Suggestion:", response);}

async function callOpenAI(modifiedContent: string): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY || "your-api-key-here"; // Use environment variable or hardcode for testing
    
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gpt-4", // or "gpt-3.5-turbo"
            messages: [
                { role: "system", content: "You are a programming tutor. Identify missing concepts and suggest study materials." },
                { role: "user", content: `Analyze this code and suggest improvements or missing knowledge:\n\n${modifiedContent}` }
            ],
            temperature: 0.7
        })
    });

    if (!response.ok) {
		const errorData = await response.json() as { error?: { message: string } };
		throw new Error(errorData.error?.message || "OpenAI request failed"); 
	}

	const data= ( await response.json()) as OpenAIResponse;
	console.error("Open AI Error: ", Error);
	return data.choices?.[0]?.message?.content || "No response from OpenAI";
}  

