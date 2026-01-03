import { createInterface } from "readline";
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec, execFile } from "child_process";
import { Trie } from "./trie";

const rl = createInterface({
	input: process.stdin,
	output: process.stdout,
	// prompt: `${process.cwd().split(path.sep)[process.cwd().split(path.sep).length - 1]} → `
	completer: (line: string) => {
		const [matches, input] = handleTabCompletion(line);

		if (matches.length === 0) {
			// No matches
			playBell();
			return [[], input];
		}
		if (matches.length === 1) {
			// End word
			return [matches, input];
		}

		if (matches.length > 1) {
			// Prefix (LCP)
			const lcp = findLCP(matches);
			const now = Date.now();
			const isSecondTab = lastCompletion.line === line && (now - lastCompletion.timestamp) < 1000;

			if (lcp.length > input.length) {
				lastCompletion = { line: lcp, timestamp: now };
				return [[lcp], input];
			}

			if (!isSecondTab) {
				lastCompletion = { line, timestamp: now };
				playBell();
				return [[], input];
			}

			// Show Matches
			const columns = process.stdout.columns || 80;
			const maxLength = Math.max(...matches.map(m => m.length)) + 2;
			const perRow = Math.floor(columns / maxLength);

			process.stdout.write('\n');
			for (let i = 0; i < matches.length; i += perRow) {
				const row = matches.slice(i, i + perRow);
				process.stdout.write(row.map(m => m.padEnd(maxLength)).join('') + '\n');
			}

			lastCompletion = { line, timestamp: now };
			rl.prompt(true);

			return [[], input];
		}
	},
	terminal: true
});

const shellCommands = {
	escape: ["exit", "quit", "q", "escape", "esc"],
	builtin: ["echo", "type", "pwd", "cd"],
} as const;
type ShellCommand = typeof shellCommands.escape[number] | typeof shellCommands.builtin[number];
const trie = new Trie();
let lastCompletion = { line: '', timestamp: 0 };

const redirectionOptions = ["2>", "2>>", "1>", "1>>", ">", ">>"] as const;
type Redirection = typeof redirectionOptions[number];
let redirection: Redirection | undefined = undefined;

function promptUser() {
	rl.question("$ ", processInput);
}
function processInput(line: string) {
	const [root, ...args] = handleFormatting(line);
	const redirect = getFirstCommonElementInArray(args, redirectionOptions);
	let outputArgs: string[] = [];

	if (redirect && isRedirect(redirect)) {
		const redirectIndex = args.indexOf(redirect);

		outputArgs = args.splice(redirectIndex, 2);
		redirection = redirect;
	}
	if (isShellCommand(root)) {
		handleShellCommands(root, args, outputArgs);
		return;
	}
	if (isExecutable(root, process.env.PATH || "")) {
		handleExecutable(root, args, outputArgs);
		return;
	} else if (root && args.length > 0) {
		processOutput({
			content: `${root}: ${args[0]} not found`,
			isError: true,
			shouldWrite: outputArgs.length > 1,
			writePath: outputArgs[1]
		})
		promptUser();
		return;
	}

	if (root) {
		processOutput({
			content: `${line}: command not found`,
			isError: true,
			shouldWrite: outputArgs.length > 1,
			writePath: outputArgs[1]
		})
	}
	promptUser();
}
function processOutput({
	content,
	isError = false,
	shouldWrite = false,
	writePath = "output.txt",
}: {
	content: string;
	isError?: boolean;
	shouldWrite?: boolean | undefined;
	writePath?: string | undefined;
}) {
	if (!content) return;

	const formattedContent = content?.trim().normalize();
	const final = formattedContent.length > 0 && !formattedContent?.endsWith('\n')
		? `${formattedContent}\n`
		: formattedContent;

	if (shouldWrite && writePath) {
		let contentCheck: string;
		switch (redirection) {
			case ">":
			case ">>":
			case "1>":
			case "1>>":
				contentCheck = isError ? "" : final;
				if (isError) processOutput({ content: content, isError: true });
				break;
			case "2>":
			case "2>>":
				contentCheck = isError ? final : "";
				if (!isError) processOutput({ content: content });
				break;
			default:
				contentCheck = final;
				if (isError) processOutput({ content: content, isError: true });
				break;
		}

		const processedWritePath = path.resolve(
			path.dirname(writePath),
			path.basename(writePath)
		);
		try {
			fs.mkdirSync(path.dirname(processedWritePath), { recursive: true });
		} catch (err) {
			processOutput({
				content: (err as Error).message,
				isError: true
			})
			return;
		}
		const writeMode = redirection?.includes(">>") ? 'a' : 'w';
		try {
			const writeStream = fs.createWriteStream(processedWritePath, {
				flags: writeMode
			});
			writeStream.write(contentCheck, (err) => {
				if (err) {
					processOutput({
						content: (err as Error).message,
						isError: true
					});
				}
				writeStream.end();
			});
			writeStream.on('error', (err) => {
				processOutput({
					content: (err as Error).message,
					isError: true
				});
			});
		} catch (err) {
			processOutput({
				content: (err as Error).message,
				isError: true
			})
			return;
		}
		return;
	}
	if (isError) {
		process.stderr.write(final, (err) => {
			if (err) console.error((err as Error).message);
			process.exitCode = 1;
		});
	} else {
		process.stdout.write(final, (err) => {
			if (err) console.error((err as Error).message);
			process.exitCode = 0;
		});
	}
}

function init() {
	process.title = `sh: ${process.cwd()}`;

	// Trie insert exe's and built-ins
	for (const cmd of [...shellCommands.escape, ...shellCommands.builtin]) {
		trie.insert(cmd);
	}
	for (const dir of path.resolve(process.env.PATH || "./").split(path.delimiter)) {
		try {
			const dirFiles = fs.readdirSync(dir);
			dirFiles.map((exe) => {
				fs.accessSync(path.resolve(dir, exe), fs.constants.X_OK);
				trie.insert(exe);
			});
		} catch (_err) {
			// NOTE: No access
		}
	};

	promptUser();
}
init();

// Top Level
function handleTabCompletion(line: string): [string[], string] {
	if (line.length === 0) return [[], line];

	const input = line.trim();
	const matches = trie.autocomplete(input);
	if (matches.length === 0) {
		return [[], input];
	}
	const exactMatch = trie.search(input)?.isEnd;
	if (exactMatch) { // word
		if (matches.length === 1) {
			return [[input + " "], input];
		}
		return [matches.sort(), input];
	}
	if (matches.length === 1) { // prefix
		return [[matches[0] + " "], input];
	}

	return [matches.sort(), input];
}
function playBell() {
	switch (process.platform) {
		case "win32":
			exec("powershell.exe [console]::beep(500,600)");
			break;
		case "darwin":
			exec("afplay /System/Library/Sounds/Glass.aiff");
			break;
		default:
			process.stderr.write('\x07');
	}
}
function handleExecutable(command: string, args: string[], outputArgs: string[] = []) {
	try {
		execFile(command, args, (err, stdout, stderr) => {
			if (err && !stderr) {
				processOutput({
					content: (err as Error).message,
					isError: true,
					shouldWrite: outputArgs.length > 1,
					writePath: outputArgs[1]
				})
			}
			if (stderr) {
				processOutput({
					content: stderr,
					isError: true,
					shouldWrite: outputArgs.length > 1,
					writePath: outputArgs[1]
				})
			}
			if (stdout) {
				processOutput({
					content: stdout,
					shouldWrite: outputArgs.length > 1,
					writePath: outputArgs[1]
				})
			}
			promptUser();
		});
	} catch (err) {
		processOutput({
			content: (err as Error).message,
			isError: true,
			shouldWrite: outputArgs.length > 1,
			writePath: outputArgs[1]
		})
		promptUser();
	}
}
function handleShellCommands(command: ShellCommand, args: string[], outputArgs: string[] = []) {
	if (isEscapeCommand(command)) {
		rl.close();
		process.exit(0);
	}

	switch (command) {
		case "cd":
			handleChangeDir(args[0], outputArgs);
			break;
		case "echo":
			handleEcho(args, outputArgs);
			break;
		case "pwd":
			handlePrintWorkingDir(outputArgs);
			break;
		case "type":
			const checkBuiltIn = args[0];
			handleType(checkBuiltIn || "", outputArgs);
			break;
	}
	promptUser();
}
function handleFormatting(line: string) {
	const formattedLine = line.normalize("NFC");
	const tokens: string[] = [];
	const delimiters = ["\ ", "\t"];

	let inSingleQuotes = false;
	let inDoubleQuotes = false;
	let escape = false;
	let currentToken = "";

	function updateToken(char: string) {
		currentToken += char;
	}

	for (const char of formattedLine) {
		if (escape) {
			if (inDoubleQuotes) {
				if (["\"", "\\", "$", "`"].includes(char)) {
					updateToken(char);
				} else {
					updateToken("\\" + char);
				}
			} else {
				updateToken(char);
			}
			escape = false;
			continue;
		}
		if (delimiters.includes(char) && !inSingleQuotes && !inDoubleQuotes) {
			if (currentToken.length > 0) {
				tokens.push(currentToken)
				currentToken = "";
			};
			continue;
		}
		switch (char) {
			case "\\":
				if (!escape && !inSingleQuotes) {
					escape = true;
					continue;
				}
				updateToken(char);
				continue;
			case "\'":
				if (inDoubleQuotes) {
					updateToken(char);
					continue;
				}
				if (!inSingleQuotes) {
					inSingleQuotes = true;
				} else {
					inSingleQuotes = false;
				}
				continue;
			case "\"":
				if (inSingleQuotes) {
					updateToken(char);
					continue;
				}
				if (!inDoubleQuotes) {
					inDoubleQuotes = true;
					continue;
				} else {
					inDoubleQuotes = false;
				}
				continue;
			case "~":
				if (!inSingleQuotes && !inDoubleQuotes) {
					updateToken(os.homedir());
				} else {
					updateToken(char);
				}
				continue;
			default:
				updateToken(char);
				continue;
		}
	}
	if (currentToken.length > 0) {
		tokens.push(currentToken)
	};

	return tokens;
}

// Built-in Commands
function handleChangeDir(dir: string, outputArgs: string[] = []) {
	try {
		fs.accessSync(path.resolve(dir));
		process.chdir(fs.realpathSync(path.resolve(dir)));
	} catch (err) {
		processOutput({
			content: `cd: ${path.resolve(dir)}: No such file or directory`,
			isError: true,
			shouldWrite: outputArgs.length > 1,
			writePath: outputArgs[1]
		})
	}
}
function handlePrintWorkingDir(outputArgs: string[] = []) {
	try {
		processOutput({
			content: process.cwd(),
			shouldWrite: outputArgs.length > 1,
			writePath: outputArgs[1]
		})
	} catch (err) {
		processOutput({
			content: (err as Error).message,
			shouldWrite: outputArgs.length > 1,
			writePath: outputArgs[1]
		})
	}
}
function handleEcho(args: string[], outputArgs: string[] = []) {
	try {
		processOutput({
			content: `${args.join(" ")}`,
			shouldWrite: outputArgs.length > 1,
			writePath: outputArgs[1]
		})
	} catch (err) {
		processOutput({
			content: (err as Error).message,
			shouldWrite: outputArgs.length > 1,
			writePath: outputArgs[1]
		})
	}
}
function handleType(checkCommand: string, outputArgs: string[] = []) {
	if (checkCommand === "") {
		processOutput({
			content: "type: please include an argument",
			isError: true,
			shouldWrite: outputArgs.length > 1,
			writePath: outputArgs[1]
		})
	} else if (isShellCommand(checkCommand)) {
		processOutput({
			content: `${checkCommand} is a shell builtin`,
			shouldWrite: outputArgs.length > 1,
			writePath: outputArgs[1]
		})
	} else {
		const pathVariable = process.env.PATH;
		if (pathVariable && pathVariable !== "") {
			isExecutable(checkCommand, pathVariable, true, outputArgs);
		} else {
			processOutput({
				content: `${checkCommand}: please set PATH`,
				isError: true,
				shouldWrite: outputArgs.length > 1,
				writePath: outputArgs[1]
			})
		}
	}
}

// Helpers
function isRedirect(redirect: string): redirect is Redirection {
	return redirectionOptions.includes(redirect as any);
}
function isShellCommand(command: string): command is ShellCommand {
	return isEscapeCommand(command) || isShellBuiltInCommand(command);
}
function isEscapeCommand(command: string): command is typeof shellCommands.escape[number] {
	return shellCommands.escape.includes(command as any);
}
function isShellBuiltInCommand(command: string): command is typeof shellCommands.builtin[number] {
	return shellCommands.builtin.includes(command as any);
}
function isExecutable(command: string, pathToCheck: string, log = false, outputArgs: string[] = []) {
	let commandIsExecutable = false;
	let directories = pathToCheck.split(path.delimiter);

	if (directories) {
		for (const dir of directories) {
			if (!command) {
				break;
			}
			const fullPath = path.join(dir, command);

			try {
				fs.accessSync(fullPath, fs.constants.X_OK);
				if (log) processOutput({
					content: `${command} is ${fullPath}`,
					shouldWrite: outputArgs.length > 1,
					writePath: outputArgs[1]
				});
				commandIsExecutable = true;
				break;
			} catch (err) {
				// NOTE: Not found here.
			}
		}
	}

	if (log) if (!commandIsExecutable) processOutput({
		content: `${command}: not found`,
		isError: true,
		shouldWrite: outputArgs.length > 1,
		writePath: outputArgs[1]
	});
	return commandIsExecutable;
}

// Utils
function findLCP(strings: string[]): string {
	if (strings.length === 0) return "";

	let prefix = strings[0];
	for (let i = 1; i < strings.length; i++) {
		while (strings[i].indexOf(prefix) !== 0) {
			prefix = prefix.slice(0, -1);
			if (prefix === "") return "";
		}
	}
	return prefix;
}
function getFirstCommonElementInArray<T>(searchArray: unknown[], elementArray: readonly T[]): T | undefined {
	return searchArray.find(
		(element): element is T => elementArray.includes(element as T)
	) as T | undefined;
}
