// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ChatPanel } from './ChatPanel';

interface OpenAIResponse {
    choices?: { message?: { content: string } }[];
    error?: { message: string };
}

type Mode = "Tutor" | "Assistant" | "Debugger" | "Chat";
let currentMode: Mode = "Tutor"; // default

let lastSentContent: string ="";
let extensionContext: vscode.ExtensionContext;
let chatHistory: { role: 'system' | 'user' | 'assistant', content: string }[] = [];


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
	let scanInterval = setInterval(() => analyzeFile(), 20000); // 20 seconds
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
			vscode.window.showErrorMessage("Open a file to interact with ModernClippy");
			return;
		}

		const prompt = await vscode.window.showInputBox({ placeHolder: "Ask a question to ModernClippy" });
		if (!prompt) {
			return;
		}
        await callOpenAI(prompt, true)
	});
	context.subscriptions.push(openAICommand);

    let askOpenAIFromPanelCommand = vscode.commands.registerCommand('modern-clippy.askOpenAIFromPanel', async (text: string, mode?: Mode) => {
        const response = await callOpenAI(text, false, mode);
        return response;
    });
    context.subscriptions.push(askOpenAIFromPanelCommand);

    let openChatCommand = vscode.commands.registerCommand('modern-clippy.openChat', () => {
		ChatPanel.createOrShow(extensionContext.extensionUri, extensionContext);

        // Summarize and display knowledge map
		const summary = summarizeKnowledgeMap();
		ChatPanel.postMessage({ command: 'showResponse', text: summary });
	});
	context.subscriptions.push(openChatCommand);

    context.subscriptions.push(vscode.commands.registerCommand('modern-clippy.showKnowledgeMap', () => {
        ChatPanel.createOrShow(extensionContext.extensionUri, extensionContext);
        const summary = summarizeKnowledgeMap();
        ChatPanel.postMessage({ command: 'showResponse', text: summary });
      }));
      
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

function getSystemPromt(userPrompt: string = "", modeOverride?: Mode): string{

    const contextHints = knowledgeMap.global.concepts.join(", ").toLowerCase();
    const combined = `${contextHints} ${userPrompt.toLowerCase()}`;

    if (modeOverride) {
        currentMode = modeOverride;
    } else if (/debug|error|exception|fix|broken/.test(combined)) {
        currentMode = "Debugger";
    } else if (/optimize|improve|refactor/.test(combined)) {
        currentMode = "Assistant";
    } else {
        currentMode = "Tutor";
    }

	switch (currentMode) {
		case "Tutor":
            // return "You're a patient programming tutor. Teach the user missing concepts.";

            /* return `You're a patient programming tutor. Break down your explanation using:
            - **Bold** titles
            - Bullet points for steps
            - Use markdown code blocks (with syntax highlighting) for any code examples.
            Keep it short and focused.`; */

            /* return `You are a patient and Socratic programming tutor.
            Guide the user to think critically by:
            - Asking helpful questions instead of giving direct answers.
            - Pointing out what concepts are missing.
            - Suggesting what to look into next.
            - If necessary, use partial code snippets or pseudocode to illustrate ideas, but avoid providing complete solutions.
            Respond in markdown format.`; */

            return `You are a patient programming tutor.
            Guide the user to think critically by:
            - Asking helpful questions instead of giving direct answers.
            - Pointing out what concepts are missing.
            - Suggesting what to look into next.
            - If necessary, use partial code snippets or pseudocode to illustrate ideas, but avoid providing complete solutions.
            Respond in markdown format. Keep it short and focused.
            - One step at a time.`;

       /*  case "Assistant":
            return "You're a helpful coding assistant. Suggest improvements and productivity tips."; */
        case "Assistant":
            return `You are a helpful coding assistant focused on improving productivity and code quality.
                When responding:
                    - Suggest specific improvements to make code more efficient, readable, and maintainable.
                    - Offer practical productivity tips relevant to the user's development environment or workflow.
                    - Share keyboard shortcuts, extensions, and best practices that could speed up their work.
                    - Explain the reasoning behind your suggestions to help the user learn.
                    - Provide links to relevant documentation when appropriate.
                    - Always format code examples with proper markdown syntax.
                    - Keep responses concise but thorough, with concrete examples.`;
       /*  case "Debugger":
            return "You're a precise code reviewer. Identify bugs and suggest corrections."; */
        case "Debugger":
            return `You are a precise code reviewer and debugger with attention to detail.
               When analyzing code:
                    - Methodically examine the code for logical errors, syntax issues, and edge cases.
                    - Identify potential bugs, performance bottlenecks, and security vulnerabilities.
                    - Suggest specific corrections with explanations of why the bug occurs.
                    - Highlight patterns that might lead to future bugs.
                    - Recommend testing strategies to verify fixes and prevent regressions.
                    - When appropriate, suggest debugging techniques or tools specific to the language.
                    - Format all code with proper syntax highlighting using markdown.
                    - Provide both quick fixes and deeper architectural improvements when relevant.`;
        case "Chat":
            return `You are Modern Clippy, a friendly AI coding companion.
                - Keep it casual and conversational.
                - Use emojis when helpful 😄.
                - Add fun programming facts or jokes if the user seems relaxed.
                - Don't overexplain unless asked.
                - Encourage curiosity, and be encouraging!`;
            
        default:
            return `You are a versatile programming helper.
                Your approach should be:
                    - Friendly and approachable, focusing on the user's immediate needs.
                    - Balanced between offering assistance and educational content.
                    - Flexible in providing either quick answers or in-depth explanations based on context.
                    - Clear in your explanations, using analogies and examples where helpful.
                    - Precise with your code examples, using proper markdown formatting.
                    - Mindful of best practices while remaining practical.
                    - Responsive to the user's expertise level, adjusting your language accordingly.`;
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

function summarizeKnowledgeMap(): string {
	const fileSummaries = Object.entries(knowledgeMap.files).map(([file, data]) => {
		return `**${file}**
        - Language: ${data.language}
        - Imports: ${data.imports.join(', ') || 'None'}
        - Functions: ${data.functions.join(', ') || 'None'}
        - Variables: ${data.variables.join(', ') || 'None'}
        - Concepts: ${data.concepts.join(', ') || 'None'}`;
	}).join("");

	const globalSummary = `**Global Summary**
- Libraries: ${knowledgeMap.global.libraries.join(', ') || 'None'}
- Functions: ${knowledgeMap.global.functions.join(', ') || 'None'}
- Concepts: ${knowledgeMap.global.concepts.join(', ') || 'None'}`;

	return `### Knowledge Map

${fileSummaries}

${globalSummary}`;
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


async function callOpenAI(modifiedContent: string, displayInPanel = false, modeOverride?:Mode): Promise<string> {
	
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
            const systemPrompt = getSystemPromt(modifiedContent, modeOverride);
            let userContent = modifiedContent;
            let messages;

            if (modeOverride == "Chat"){
                // Initialize chat history
                if (chatHistory.length == 0) {
                    chatHistory.push({ role:"system", content: systemPrompt});
                }

                chatHistory.push({role:"user", content:modifiedContent});
                messages = chatHistory;
            } else {
                // code related modes, no history needed since code itself is self-explainable
                messages = [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: modifiedContent }
                ];
            }
            /* if (modeOverride != "Chat"){
                userContent = `Analyze this code and suggest improvements or missing knowledge:\n\n${modifiedContent}` ;
            }
            
            if (chatHistory.length == 0) {
                chatHistory.push({ role: "system", content: systemPrompt});
            }
            chatHistory.push({role:"user", content:modifiedContent}); */

            const response = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "gpt-3.5-turbo",
                    messages,
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

            // only upte chathistory when in chat mode
            if (modeOverride === "Chat") {
                chatHistory.push({ role: "assistant", content });
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