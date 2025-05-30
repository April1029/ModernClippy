// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ChatPanel } from './ChatPanel';
import * as fs from 'fs';
// @ts-ignore
import pdfParse from 'pdf-parse';

// OpenAI Response structure
interface OpenAIResponse {
    choices?: { message?: { content: string } }[];
    error?: { message: string };
}

type Mode = "Tutor" | "Assistant" | "Debugger" | "Chat";
let currentMode: Mode = "Tutor"; // default

let lastSentContent: string ="";
let extensionContext: vscode.ExtensionContext;
let chatHistory: { 
    role: 'system' | 'user' | 'assistant', 
    content: string, 
    mode?: Mode 
}[] = [];
let assignmentPromptAlreadySent = false;


// Data structure for storing analyzed knowledge across files
interface KnowledgeMap {
    files: {
        [fileName: string]: {
            language: string;
            imports: string[];
            functions: string[];
            variables: string[];
            dependencies: string[];
            concepts: { [concept: string]: number }; // frequency map
            lastModified: number;
            unusedImports?: string[];
        };
    };
    global: {
        functions: string[];
        libraries: string[];
        concepts: { [concept: string]: number };
        assignmentPrompt ?: string; 
    };
}

// Initialize an empty knowledge map
let knowledgeMap: KnowledgeMap = {
    files: {},
    global: {
        functions: [],
        libraries: [],
        concepts: {},
    },
};

export async function activate(context: vscode.ExtensionContext) {
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
			.then(async (selection) => {
				if (selection === "Yes") {
					context.globalState.update('modernClippyEnabled', true);
					await startModernClippy(context);
					vscode.window.showInformationMessage("Great! I'm here to help you! ");
				}
				if (selection === "No") {
					vscode.window.showInformationMessage("Okay! I'm always here if you need me! You can enable me anytime by clicking on the Modern Clippy icon in the status bar.");
				}
			});
	} else {
		await startModernClippy(context);

	}

	// Register the command to enable Modern Clippy manually
	let enableModernClippy = vscode.commands.registerCommand('modern-clippy.enable', () => {
		vscode.window.showInformationMessage("Enable Modern Clippy now?", "Yes", "No")
			.then( async(selection) => {
				if (selection === "Yes") {
					context.globalState.update('modernClippyEnabled', true);
					await startModernClippy(context);
					vscode.window.showInformationMessage("Great! I'm here to help you! ");
				}
			});
	});

	context.subscriptions.push(enableModernClippy);

	// Register the command to scan the document periodically
	// Set up the interval to periodically scan the file
	let scanInterval = setInterval(() => analyzeFile(), 40000); // 40 seconds
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

    // Interact with OpenAI from Chat 
    let askOpenAIFromPanelCommand = vscode.commands.registerCommand('modern-clippy.askOpenAIFromPanel', async (text: string, mode?: Mode) => {
        const response = await callOpenAI(text, false, mode);
        return response;
    });
    context.subscriptions.push(askOpenAIFromPanelCommand);

    // Open Chat
    let openChatCommand = vscode.commands.registerCommand('modern-clippy.openChat', async() => {
        await buildKnowledgeMap();
		ChatPanel.createOrShow(extensionContext.extensionUri, extensionContext);

        // Summarize and display knowledge map
		const summary = summarizeKnowledgeMap();
		ChatPanel.postMessage({ command: 'showResponse', text: summary });
	});
	context.subscriptions.push(openChatCommand);

    // Rigister clear chathistory command
    let clearChatHistoryCommand = vscode.commands.registerCommand('modern-clippy.clearChatHistory', () => {
        chatHistory = [];
        vscode.window.showInformationMessage("Chat history cleared!");
    });
    context.subscriptions.push(clearChatHistoryCommand);
    

    context.subscriptions.push(vscode.commands.registerCommand('modern-clippy.showKnowledgeMap', () => {
        ChatPanel.createOrShow(extensionContext.extensionUri, extensionContext);
        const summary = summarizeKnowledgeMap();
        ChatPanel.postMessage({ command: 'showResponse', text: summary });
      }))
    
    let refreshKnowledgeMapCommand = vscode.commands.registerCommand('modern-clippy.refreshKnowledgeMap', async () => {
        await buildKnowledgeMap();
        vscode.window.showInformationMessage("Knowledge Map updated.");
    });
    context.subscriptions.push(refreshKnowledgeMapCommand);

    let showChatHistoryCommand = vscode.commands.registerCommand('modern-clippy.showChatHistory', () => {

        const formatted = chatHistory.map(
            (entry, index) => {
                const modeSuffix = entry.mode ? ` (mode: ${entry.mode})` : "";
                return `${index + 1}. **${entry.role}${modeSuffix}**: ${entry.content}...`;
            }
        ).join('\n\n');
        
        const preview = formatted || "Chat history is currently empty.";
    
        vscode.window.setStatusBarMessage("Chat history preview copied to clipboard.");
        vscode.env.clipboard.writeText(preview);
    });
    
    context.subscriptions.push(showChatHistoryCommand);

    const scanAllCommand = vscode.commands.registerCommand('modern-clippy.scanAllFiles', async () => {
        await analyzeAllFilesInWorkspace();
    });
    context.subscriptions.push(scanAllCommand);

    let previewPDFTextCommand = vscode.commands.registerCommand('modern-clippy.previewPDFText', async () => {
        const fileUri = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { "PDF files": ["pdf"] },
            openLabel: "Select a PDF file to preview its content"
        });
    
        if (!fileUri || fileUri.length === 0) {
            vscode.window.showInformationMessage("No PDF file selected.");
            return;
        }
    
        try {
            const filePath = fileUri[0].fsPath;
            const extractedText = await extractTextFromPDF(filePath);
    
            // Display a portion of the PDF content in an information message or output channel
            const preview = extractedText|| "[No content extracted]";  // .slice(0, 1000) 
            const output = vscode.window.createOutputChannel("Modern Clippy - PDF Preview");
            output.clear();
            output.appendLine(`📝 Extracted text from ${filePath}:\n\n${preview}`);
            output.show();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to extract PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });
    context.subscriptions.push(previewPDFTextCommand);

    let setAssignmentContextCommand = vscode.commands.registerCommand('modern-clippy.setAssignmentContext', async () => {
        const fileUri = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: {
                "Context files": ["pdf", "md", "txt"],
                "All files": ["*"]
            },
            openLabel: "Select assignment file"
        });
    
        if (!fileUri || fileUri.length === 0) {
            vscode.window.showInformationMessage("No file selected.");
            return;
        }
    
        try {
            const filePath = fileUri[0].fsPath;
            let content = "";
    
            const ext = filePath.split('.').pop()?.toLowerCase();
            if (ext === 'pdf') {
                content = await extractTextFromPDF(filePath);
            } else {
                content = fs.readFileSync(filePath, 'utf-8');
            }
    
            if (content.trim().length === 0) {
                vscode.window.showWarningMessage("Selected file is empty.");
                return;
            }
    
            knowledgeMap.global.assignmentPrompt = content;
            vscode.window.showInformationMessage("Assignment context stored in knowledge map.");
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to load assignment content: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    });
    context.subscriptions.push(setAssignmentContextCommand);

    const showAssignmentContextCommand = vscode.commands.registerCommand('modern-clippy.showAssignmentContext', async () => {
        const contextText = knowledgeMap.global.assignmentPrompt;
    
        if (!contextText || contextText.trim() === "") {
            vscode.window.showWarningMessage("No assignment context is currently set.");
            return;
        }
    
        const output = vscode.window.createOutputChannel("Modern Clippy - Assignment Context");
        output.clear();
        output.appendLine("📘 Assignment Context Preview\n");
        output.appendLine(contextText.length > 2000
            ? contextText.slice(0, 2000) + "\n\n[...truncated]"
            : contextText
        );
        output.show(true);
    });
    context.subscriptions.push(showAssignmentContextCommand);
    
    
}

async function startModernClippy(context: vscode.ExtensionContext) {
	vscode.window.setStatusBarMessage("Modern Clippy is now enabled!");

	let disposable = vscode.commands.registerCommand('modern-clippy.start', () => {
		vscode.window.setStatusBarMessage("Modern Clippy is here to help you!");
	});
	context.subscriptions.push(disposable);

    // Auto-scan all files in the workspace
    await analyzeAllFilesInWorkspace();
}

// This method is called when the extension is deactivated
export function deactivate() { 
    chatHistory = [];
}

async function getAllFilesInWorkspace(): Promise<vscode.Uri[]> {
    const includePattern = '**/*.{ts,js,py,txt,json,md,pdf}';
    const excludePattern = '**/node_modules/**';

    const files = await vscode.workspace.findFiles(includePattern, excludePattern);
    return files;
}


async function extractTextFromPDF(filePath: string): Promise<string> {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    return pdfData.text;
}

async function analyzeAllFilesInWorkspace() {
    const files = await getAllFilesInWorkspace();
    const assignmentCandidates: { label: string; uri: vscode.Uri }[] = [];


    for (const file of files) {

        const filePath = file.fsPath;
        const ext = filePath.split('.').pop()?.toLowerCase();
        const baseName = filePath.split('/').pop() || "";

        let content = '';

        if (['pdf', 'md', 'txt'].includes(ext ||"")) {
            console.log("📘 Detected possible assignment file:", filePath);
            assignmentCandidates.push({ label: baseName, uri: file });
        }

        try {
            const content = ext === 'pdf'
                ? await extractTextFromPDF(filePath)
                : fs.readFileSync(filePath, 'utf-8');

            if (content.trim()) {
                await buildKnowledgeMapFromText(filePath, content);
            }
        } catch (err) {
            vscode.window.showWarningMessage(`Failed to parse ${filePath}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    }

    // Defer QuickPick prompt just slightly to ensure UI is ready
    if (!knowledgeMap.global.assignmentPrompt && assignmentCandidates.length > 0) {
        setTimeout(async () => {
            const picked = await vscode.window.showQuickPick(
                assignmentCandidates.map(c => ({
                    label: c.label,
                    description: 'Use as assignment context',
                    detail: c.uri.fsPath
                })),
                { placeHolder: "📘 Select the file that contains the assignment prompt" }
            );

            if (picked) {
                const ext = picked.label.split('.').pop()?.toLowerCase();
                const content = ext === 'pdf'
                    ? await extractTextFromPDF(picked.detail)
                    : fs.readFileSync(picked.detail, 'utf-8');

                if (content.trim()) {
                    knowledgeMap.global.assignmentPrompt = content;
                    vscode.window.showInformationMessage(`📘 Assignment context loaded from: ${picked.label}`);
                }
            }
        }, 300); // Slight delay to let VS Code UI catch up
    }

    vscode.window.setStatusBarMessage("Finished scanning all workspace files!");
}

async function buildKnowledgeMapFromText(fileName: string, content: string) {
    const language = fileName.endsWith('.pdf') ? 'pdf' :
        fileName.endsWith('.ts') ? 'typescript' :
        fileName.endsWith('.js') ? 'javascript' :
        fileName.endsWith('.py') ? 'python' :
        'plaintext';

    const imports = extractImports(content, language);
    const unusedImports = findUnusedImports(imports, content);
    const functions = extractFunctions(content, language);
    const variables = extractVariables(content, language);
    const concepts = extractConcepts(content, language);
    const now = Date.now();

    knowledgeMap.files[fileName] = {
        language,
        imports,
        functions,
        variables,
        dependencies: imports,
        concepts,
        lastModified: now,
        unusedImports,
    };

    // Update global summary
    knowledgeMap.global.functions.push(...functions);
    knowledgeMap.global.libraries.push(...imports);

    for (const [concept, count] of Object.entries(concepts)) {
        knowledgeMap.global.concepts[concept] =
            (knowledgeMap.global.concepts[concept] || 0) + count;
    }
}

async function buildKnowledgeMap() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const fileName = editor.document.fileName;
    const fileContent = editor.document.getText();
    
    await buildKnowledgeMapFromText(fileName, fileContent);
}


async function analyzeFile() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		// vscode.window.showErrorMessage("Open a file to analyze");
		return;
	}

	const fileContent = editor.document.getText();
	if (fileContent === lastSentContent) {
		vscode.window.setStatusBarMessage("No changes in the file");
		return;
	}

	const diff = getSimpleDiff(lastSentContent, fileContent);
	if (!diff.trim()) return;
    await buildKnowledgeMap();

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
    if (modeOverride && modeOverride !== currentMode) {
        currentMode = modeOverride;
    } else {
        let detected: Mode = "Tutor";
        if ((/\b(debug|error|exception|fix|broken)\b/).test(userPrompt.toLowerCase())) {
            detected = "Debugger";
            console.log(userPrompt);
            console.log("Mode is now Debugger");
        } else if ((/\boptimize|improve|refactor\b/).test(userPrompt.toLowerCase())) {
            detected = "Assistant";
            console.log("Mode is now Assistant");
        }
        if (detected !== currentMode) {
            currentMode = detected;
            vscode.window.setStatusBarMessage(`Clippy switched to ${currentMode} mode automatically.`);
        }
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

            return `You are a patient, minimalist programming tutor.
            Your job is to guide the user's thinking, not solve problems for them.
            Follow these rules:
            - Ask one short, focused question at a time.
            - Do not explain too much. Let the user do the thinking. Always prefer guiding over explaining.
            - Give short, clear feedback if the user's response is correct, close, or off-track.
            - Point out what is missing or needs work, but do not fix it all.
            - One step at a time. Be brief, supportive, and strategic.
            - If the user says "I don't know", don't repeat the question. Instead:
               Offer a tiny hint,
               Or ask a simpler sub-question,
               Or give a 1 to 2 line example to clarify.
            - You are not allowed to return code that more than 5 lines.
            - Respond in markdown format. Keep it short and focused.
            `;

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
                - If necessary, use partial code snippets or pseudocode to illustrate ideas, 
                - You are not allowed to return code that more than 5 lines.
                - Encourage curiosity, and be encouraging!`;
            
        /* default:
            return `You are a versatile programming helper.
                Your approach should be:
                    - Friendly and approachable, focusing on the user's immediate needs.
                    - Balanced between offering assistance and educational content.
                    - Flexible in providing either quick answers or in-depth explanations based on context.
                    - Clear in your explanations, using analogies and examples where helpful.
                    - Precise with your code examples, using proper markdown formatting.
                    - Mindful of best practices while remaining practical.
                    - Responsive to the user's expertise level, adjusting your language accordingly.`; */
	}
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

function extractFunctions(fileContent: string, language: string): string[] {
    const functions: string[] = [];
    
    if (language === 'python') {
        const pythonFunctionRegex = /^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(.*?\)\s*:/gm;
        let match;
        while ((match = pythonFunctionRegex.exec(fileContent)) !== null) {
            functions.push(match[1]);
        }
    } else {
        const tsFunctionRegex = /(?:function\s+(\w+)|(\w+)\s*=\s*\(.*?\)\s*=>\s*{)/g;
        let match;
        while ((match = tsFunctionRegex.exec(fileContent)) !== null) {
            const funcName = match[1] || match[2];
            if (funcName) functions.push(funcName);
        }
    }

    return functions;
}


function extractVariables(fileContent: string, language: string): string[] {
    const variables: string[] = [];

    if (language === 'python') {
        const pythonVariableRegex = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*[^=]/gm;
        let match;
        while ((match = pythonVariableRegex.exec(fileContent)) !== null) {
            variables.push(match[1]);
        }
    } else {
        const tsVariableRegex = /(?:let|const|var)\s+(\w+)/g;
        let match;
        while ((match = tsVariableRegex.exec(fileContent)) !== null) {
            variables.push(match[1]);
        }
    }

    return variables;
}


// Function to extract programming concepts
function extractConcepts(fileContent: string, language: string): { [concept: string]: number } {
    const conceptCounts: { [concept: string]: number } = {};
    const patterns = [
        { regex: /\bif\b/g, concept: 'Conditional Statements' },
        { regex: /\bfor\b/g, concept: 'Loops' },
        { regex: /\bwhile\b/g, concept: 'Loops' },
        { regex: /\bswitch\b/g, concept: 'Switch Statements' },
        { regex: /\btry\b/g, concept: 'Error Handling' },
        { regex: /\bclass\b/g, concept: 'Object-Oriented Programming' },
        { regex: /=>/g, concept: 'Arrow Functions' },
        { regex: /\breduce\b|\bmap\b|\bfilter\b/g, concept: 'Higher-Order Functions' }
    ];

    patterns.forEach(({ regex, concept }) => {
        const matches = fileContent.match(regex);
        if (matches) {
            conceptCounts[concept] = (conceptCounts[concept] || 0) + matches.length;
        }
    });

    if (language === 'typescript' || language === 'javascript') {
        if (/interface\b/.test(fileContent)) {
            conceptCounts['TypeScript Interfaces'] = (conceptCounts['TypeScript Interfaces'] || 0) + 1;
        }
        if (/async\b/.test(fileContent)) {
            conceptCounts['Asynchronous Programming'] = (conceptCounts['Asynchronous Programming'] || 0) + 1;
        }
    } else if (language === 'python') {
        if (/def\b/.test(fileContent)) {
            conceptCounts['Function Definitions'] = (conceptCounts['Function Definitions'] || 0) + 1;
        }
        if (/class\b/.test(fileContent)) {
            conceptCounts['Class Definitions'] = (conceptCounts['Class Definitions'] || 0) + 1;
        }
    }

    return conceptCounts;
}

function findUnusedImports(imports: string[], fileContent: string): string[] {
    return imports.filter(imp => {
        const usagePattern = new RegExp(`\\b${imp}\\b`, 'g');
        const matches = fileContent.match(usagePattern);
        return !matches || matches.length <= 1; // One match is likely the import itself
    });
}

function summarizeKnowledgeMap(): string {
	const fileSummaries = Object.entries(knowledgeMap.files).map(([file, data]) => {
        const conceptList = Object.entries(data.concepts)
            .map(([concept, count]) => `${concept} (${count})`)
            .join(', ') || 'None';
		return `**${file}**
        - Language: ${data.language}
        - Imports: ${data.imports.join(', ') || 'None'}
        - Functions: ${data.functions.join(', ') || 'None'}
        - Variables: ${data.variables.join(', ') || 'None'}
        - Concepts: ${conceptList}`;
	}).join("");

    const globalConceptList = Object.entries(knowledgeMap.global.concepts)
        .map(([concept, count]) => `${concept} (${count})`)
        .join(', ') || 'None';
    

	const globalSummary = `**Global Summary**
- Libraries: ${knowledgeMap.global.libraries.join(', ') || 'None'}
- Functions: ${knowledgeMap.global.functions.join(', ') || 'None'}
- Concepts: ${globalConceptList}`;

	return `### Knowledge Map

${fileSummaries}

${globalSummary}`;
}


function getFilteredMessagesForMode(mode: Mode): { role: 'system' | 'user' | 'assistant', content: string }[] {
    const firstMessage = chatHistory.length > 0 ? [chatHistory[0]]:[];

    // we want different filters per mode
    switch (mode) {
        case "Chat":
            return chatHistory;
        case "Debugger":
        case "Assistant":
        case "Tutor":
            const recent = chatHistory.slice(1).filter(msg =>
                msg.role === 'system' || 
                msg.role === 'assistant' ||
                (msg.role === 'user' ) 
            ).slice(-2);
            return [...firstMessage, ...recent];
        default:
            return chatHistory;
    }
}

function buildInitialSystemPrompt(
    content: string,
    modeOverride?: Mode
): { role: "system"; content: string } | null {
    if (!knowledgeMap.global.assignmentPrompt || assignmentPromptAlreadySent ){
        return null;
    }
    const basePrompt = getSystemPromt(content, modeOverride);
    const contextFileContent = knowledgeMap.global.assignmentPrompt?.trim();
    if (!contextFileContent) {
        console.log("No assignment context found in knowledgeMap.global.assignmentPrompt.");
        console.log("Using base system prompt only:", basePrompt);
        return null;
    }

    // Debug: Log what’s being included
    console.log("Building full system prompt with assignment context.");
    console.log("Assignment Context (first 100 chars):", contextFileContent.slice(0, 100));
    console.log("Base System Prompt (first 100 chars):", basePrompt.slice(0, 100));

    const combinedPrompt = `${basePrompt}\n\n` +
        `Here is your assignment context:\n\n` +
        `${contextFileContent}\n\n`;

    console.log("Combined System Prompt Preview (first 300 chars):", combinedPrompt.slice(0, 300));
    // Push once to chat history
    chatHistory.unshift({
        role: "system",
        content: combinedPrompt,
        mode: currentMode
    });

    assignmentPromptAlreadySent = true;
    return null;
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
            if (modeOverride ) {
                currentMode = modeOverride;
            }

            // Always push both user input and assistant response regardless of mode
            const userMessage = { role: "user" as const, content: modifiedContent, mode: currentMode };
            // const systemMessage = { role: "system" as const, content: systemPrompt };
            let systemMessage: { role: "system"; content: string } | null = null;

            if (!assignmentPromptAlreadySent && knowledgeMap.global.assignmentPrompt) {
                buildInitialSystemPrompt(modifiedContent, modeOverride);
            } else {
                const basePrompt = getSystemPromt(modifiedContent, modeOverride);
                systemMessage = { role: "system", content: basePrompt };
            }
            

            // Push system prompt to chat history (for debugging purpose)
            //chatHistory.push({ role: "system", content: systemPrompt, mode: currentMode });

            // Build messages to send to OpenAI
            const baseMessages = [
                ...(systemMessage ? [systemMessage] : []),
                ...getFilteredMessagesForMode(currentMode)
            ];

            const messages = [...baseMessages, userMessage];
            console.log("📨 Messages sent:", messages.map(m => ({
                role: m.role,
                preview: m.content 
            })));

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

                if (response.status === 401 ||
                    errorMessage.includes("authentication") ||
                    errorMessage.includes("API key")) {

                    vscode.window.showErrorMessage(`OpenAI API Authentication Error: ${errorMessage}`);
                    apiKey = undefined;
                    retryCount++;
                    continue;
                } else {
                    vscode.window.showErrorMessage(`OpenAI API Error: ${errorMessage}`);
                    return "API request failed";
                }
            }

            const data = await response.json() as OpenAIResponse;
            const content = data.choices?.[0]?.message?.content || "No response from OpenAI";
            

            // Always update chat history
            chatHistory.push(userMessage);
            chatHistory.push({ role: "assistant", content, mode: currentMode });
            //console.log("ChatHistory",chatHistory)

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