// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ChatPanel } from './ChatPanel';

interface OpenAIResponse {
    choices?: { message?: { content: string } }[];
    error?: { message: string };
}

type Mode = "Tutor" | "Assistant" | "Debugger";
let currentMode: Mode = "Tutor"; // default

let lastSentContent: string ="";
let extensionContext: vscode.ExtensionContext;

interface KnowledgeMap {
    files: {
        [fileName: string]: {
            language: string;
            imports: string[];
            functions: string[];
            variables: string[];
            dependencies: string[];
            concepts: string[];
        };
    };
    global: {
        functions: string[];
        libraries: string[];
        concepts: string[];
    };
}

let knowledgeMap: KnowledgeMap = { files: {}, global: { functions: [], libraries: [], concepts: [] } };

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	extensionContext = context;

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
	statusBarItem.text = "$(comment-discussion) Modern Clippy";
    statusBarItem.tooltip = "Click to chat with Modern Clippy";
    statusBarItem.command = "modern-clippy.openChat"; 
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
	// Set up the interval to periodically scan the file
	let scanInterval = setInterval(() => analyzeFile(), 5000); // 60 seconds
	context.subscriptions.push({ dispose: () => clearInterval(scanInterval) });

	let analyzeFileCommand = vscode.commands.registerCommand('modern-clippy.analyzeFile', async () => {
		await analyzeFile();
	});
	context.subscriptions.push(analyzeFileCommand);

    let setApiKeyCommand = vscode.commands.registerCommand('modern-clippy.setApiKey', async () => {
        const key = await vscode.window.showInputBox({
            placeHolder: "Enter your OpenAI API key",
            password: true // Hide the input
        });
        
        if (key) {
            await extensionContext.secrets.store('openai-api-key', key);
            vscode.window.showInformationMessage("API key saved successfully!");
        }
    });
    
    context.subscriptions.push(setApiKeyCommand);
	
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
        await callOpenAI(prompt, true)
	});
	context.subscriptions.push(openAICommand);

    let askOpenAIFromPanelCommand = vscode.commands.registerCommand('modern-clippy.askOpenAIFromPanel', async (text: string) => {
        const response = await callOpenAI(text);
        return response;
    });
    context.subscriptions.push(askOpenAIFromPanelCommand);

    let openChatCommand = vscode.commands.registerCommand('modern-clippy.openChat', () => {
		ChatPanel.createOrShow(extensionContext.extensionUri, extensionContext);
	});
	context.subscriptions.push(openChatCommand);
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

async function analyzeFile() {
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

	const diff = getSimpleDiff(lastSentContent, fileContent);
	if (!diff.trim()) return;

	const shouldDisplayInPanel = true; 
    const response = await callOpenAI(diff, shouldDisplayInPanel);
    lastSentContent = fileContent;
    if (!shouldDisplayInPanel && response) {
        vscode.window.showInformationMessage("Clippy Suggestion:", response);
    }
}

function getSimpleDiff(oldContent:string, newContent:string): string {
	const oldLines = oldContent.split('\n');
	const newLines = newContent.split('\n');
	const addedLines = newLines.filter(line => !oldLines.includes(line));
	return addedLines.join('\n');
}

function getSystemPromt(): string{
	switch (currentMode) {
		case "Tutor":
            return "You're a patient programming tutor. Teach the user missing concepts.";
        case "Assistant":
            return "You're a helpful coding assistant. Suggest improvements and productivity tips.";
        case "Debugger":
            return "You're a precise code reviewer. Identify bugs and suggest corrections.";
        default:
            return "You're a programming helper.";
	}
}


async function buildKnowledgeMap() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const fileName = editor.document.fileName;
    const fileContent = editor.document.getText();
    const fileLanguage = editor.document.languageId; // TypeScript, Python, etc.

    const imports = extractImports(fileContent, fileLanguage); // Custom function to extract imports
    const functions = extractFunctions(fileContent); // Custom function to extract function names
    const variables = extractVariables(fileContent); // Custom function to extract variable names
    const concepts = extractConcepts(fileContent, fileLanguage); // Custom function to extract concepts like loops, etc.

    // Update the knowledge map for this specific file
    knowledgeMap.files[fileName] = {
        language: fileLanguage,
        imports,
        functions,
        variables,
        dependencies: imports, // Can link dependencies here
        concepts
    };

    // Update the global knowledge base
    knowledgeMap.global.functions.push(...functions);
    knowledgeMap.global.libraries.push(...imports);
    knowledgeMap.global.concepts.push(...concepts);

    // Make sure to remove duplicates
    knowledgeMap.global.functions = Array.from(new Set(knowledgeMap.global.functions));
    knowledgeMap.global.libraries = Array.from(new Set(knowledgeMap.global.libraries));
    knowledgeMap.global.concepts = Array.from(new Set(knowledgeMap.global.concepts));

    // Optionally log or store knowledge map
    console.log("Knowledge Map Updated: ", knowledgeMap);
}




// Function to extract imports based on language
function extractImports(fileContent: string, language: string): string[] {
    switch (language) {
        case 'typescript':
        case 'javascript':
            // Extract import statements
            const importRegex = /import\s+(?:(?:\*\s+as\s+\w+)|(?:\{[^}]+\})|(?:\w+))\s+from\s+['"]([^'"]+)['"]/g;
            const imports: string[] = [];
            let match;
            while ((match = importRegex.exec(fileContent)) !== null) {
                imports.push(match[1]);
            }
            return imports;
        case 'python':
            // Extract import statements for Python
            const pythonImportRegex = /^(?:import\s+(\w+)|from\s+(\w+)\s+import\s+[\w*]+)/gm;
            const pythonImports: string[] = [];
            let pythonMatch;
            while ((pythonMatch = pythonImportRegex.exec(fileContent)) !== null) {
                if (pythonMatch[1]) {
                    pythonImports.push(pythonMatch[1]);
                } else if (pythonMatch[2]) {
                    pythonImports.push(pythonMatch[2]);
                }
            }
            return pythonImports;
        default:
            return [];
    }
}

// Function to extract function names
function extractFunctions(fileContent: string): string[] {
    // TypeScript/JavaScript function extraction
    const functionRegex = /(?:function\s+(\w+)|(\w+)\s*=\s*\(.*?\)\s*=>\s*{)/g;
    const functions: string[] = [];
    let match;
    while ((match = functionRegex.exec(fileContent)) !== null) {
        const funcName = match[1] || match[2];
        if (funcName) functions.push(funcName);
    }
    return functions;
}

// Function to extract variables
function extractVariables(fileContent: string): string[] {
    // Capture let, const, and var declarations
    const variableRegex = /(?:let|const|var)\s+(\w+)/g;
    const variables: string[] = [];
    let match;
    while ((match = variableRegex.exec(fileContent)) !== null) {
        variables.push(match[1]);
    }
    return variables;
}

// Function to extract programming concepts
function extractConcepts(fileContent: string, language: string): string[] {
    const concepts: string[] = [];
    
    // Common programming concepts across languages
    const conceptPatterns = [
        { regex: /\bif\b/g, concept: 'Conditional Statements' },
        { regex: /\bfor\b/g, concept: 'Loops' },
        { regex: /\bwhile\b/g, concept: 'Loops' },
        { regex: /\bswitch\b/g, concept: 'Switch Statements' },
        { regex: /\btry\b/g, concept: 'Error Handling' },
        { regex: /\bclass\b/g, concept: 'Object-Oriented Programming' },
        { regex: /=>/g, concept: 'Arrow Functions' },
        { regex: /\breduce\b|\bmap\b|\bfilter\b/g, concept: 'Higher-Order Functions' }
    ];

    conceptPatterns.forEach(pattern => {
        if (pattern.regex.test(fileContent)) {
            concepts.push(pattern.concept);
        }
    });

    // Language-specific concepts
    switch (language) {
        case 'typescript':
        case 'javascript':
            if (/interface\b/.test(fileContent)) concepts.push('TypeScript Interfaces');
            if (/async\b/.test(fileContent)) concepts.push('Asynchronous Programming');
            break;
        case 'python':
            if (/def\b/.test(fileContent)) concepts.push('Function Definitions');
            if (/class\b/.test(fileContent)) concepts.push('Class Definitions');
            break;
    }

    return concepts;
}

// Modify the mode switching functionality
function switchMode(mode: Mode) {
    currentMode = mode;
    
    // Provide mode-specific feedback
    switch (mode) {
        case "Tutor":
            vscode.window.showInformationMessage("Modern Clippy is now in Tutor mode. I'll help you learn!");
            break;
        case "Assistant":
            vscode.window.showInformationMessage("Modern Clippy is now in Assistant mode. I'll help improve your code.");
            break;
        case "Debugger":
            vscode.window.showInformationMessage("Modern Clippy is now in Debugger mode. I'll help find and fix issues.");
            break;
    }
}


async function callOpenAI(modifiedContent: string, displayInPanel = false): Promise<string> {
	
    let apiKey = await extensionContext.secrets.get('openai-api-key');
    let retryCount = 0;
    const maxRetries = 2; // Maximum number of retry attempts
    
    async function promptForApiKey(message: string): Promise<string | undefined> {
        const selection = await vscode.window.showInformationMessage(
            message, 
            "Enter Key", "Cancel"
        );
        
        if (selection === "Enter Key") {
            const key = await vscode.window.showInputBox({
                placeHolder: "Enter your OpenAI API key",
                password: true // Hide the input
            });
            
            if (key) {
                await extensionContext.secrets.store('openai-api-key', key);
                vscode.window.showInformationMessage("API key saved successfully!");
                return key;
            }
        }
        return undefined;
    }
    
    while (retryCount <= maxRetries) {
        // If no API key is found, prompt the user
        if (!apiKey) {
            const message = retryCount === 0 
                ? "OpenAI API key not found. Would you like to set it now?"
                : "API key appears to be invalid. Would you like to enter a new one?";
                
            apiKey = await promptForApiKey(message);
            
            if (!apiKey) {
                return "API key setup canceled";
            }
        }
        
        try {
            const response = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "gpt-3.5-turbo",
                    messages: [
                        { role: "system", content: getSystemPromt() }, // Use the dynamic system prompt
                        { role: "user", content: `Analyze this code and suggest improvements or missing knowledge:\n\n${modifiedContent}` }
                    ],
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                const errorData = await response.json() as { error?: { message: string } };
                const errorMessage = errorData.error?.message || "Unknown error";
                
                // Check if it's an authentication error
                if (response.status === 401 || 
                    errorMessage.includes("authentication") || 
                    errorMessage.includes("API key")) {
                    
                    vscode.window.showErrorMessage(`OpenAI API Authentication Error: ${errorMessage}`);
                    apiKey = undefined; // Reset the API key to trigger re-entry
                    retryCount++;
                    continue; // Skip to the next iteration to retry
                } else {
                    vscode.window.showErrorMessage(`OpenAI API Error: ${errorMessage}`);
                    return "API request failed";
                }
            }

            const data = await response.json() as OpenAIResponse;
            const content = data.choices?.[0]?.message?.content || "No response from OpenAI";
            if (displayInPanel) {
                ChatPanel.createOrShow(extensionContext.extensionUri, extensionContext);
                ChatPanel.postMessage({ command: 'showResponse', text: content });
                return "";
            }
            return content;

        } catch (error) {
            vscode.window.showErrorMessage(`Error calling OpenAI: ${error instanceof Error ? error.message : 'Unknown error'}`);
            
            // Decide if it's worth retrying or not
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (errorMessage.includes("authentication") || errorMessage.includes("API key")) {
                apiKey = undefined; // Reset the API key to trigger re-entry
                retryCount++;
                continue; // Skip to the next iteration to retry
            }
            
            return "Request failed";
        }
    }
    
    return "Maximum retry attempts reached. Please check your API key configuration.";
}