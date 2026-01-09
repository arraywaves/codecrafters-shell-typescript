import { createInterface } from "readline";
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec, execFile, spawn } from "child_process";
import { Trie } from "./trie";
import { findLCP, getFirstCommonElementInArray, parseFlag, splitPipeCommands } from "./utils";
import { PassThrough } from "stream";

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

			// Prefix (Show Matches)
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
	builtin: ["echo", "type", "pwd", "cd", "history"],
} as const;
type ShellCommand = typeof shellCommands.escape[number] | typeof shellCommands.builtin[number];

const redirectionOptions = ["2>", "2>>", "1>", "1>>", ">", ">>"] as const;
type Redirection = typeof redirectionOptions[number];
let redirectionFlag: Redirection | undefined = undefined;

const trie = new Trie();
let lastCompletion = { line: '', timestamp: 0 };

const history = new Map<number, string>();
const historyFilePath = path.resolve(process.env.HISTFILE || "./log/history.txt");
let historySizeOnLoad = 0;
let previousAppendSize = 0;

function init() {
	process.title = `sh: ${process.cwd()}`;

	handleHistory([`-r`, historyFilePath]);
	historySizeOnLoad = history.size;

	// Trie insert commands
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

function promptUser() {
	rl.question("$ ", processInput);
}
function processInput(line: string) {
	history.set(history.size + 1, line);

	const tokens = handleFormatting(line);

	if (isPipeline(tokens)) {
		handlePipelines(tokens);
		return;
	}
	processLine(tokens);
}
function processLine(tokens: string[], pipe = false) {
	const [root, ...args] = tokens;

	const redirect = getFirstCommonElementInArray(args, redirectionOptions);
	let outputArgs: string[] = [];
	if (redirect && isRedirect(redirect)) {
		const redirectIndex = args.indexOf(redirect);

		outputArgs = args.splice(redirectIndex, 2);
		redirectionFlag = redirect;
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

	if (root && !pipe) {
		processOutput({
			content: `${tokens.join(" ")}: command not found`,
			isError: true,
			shouldWrite: outputArgs.length > 1,
			writePath: outputArgs[1]
		})
		promptUser();
	}
}
function processOutput({
	content,
	isError = false,
	shouldWrite = false,
	writePath = "output.txt",
	redirection = redirectionFlag,
}: {
	content: string;
	isError?: boolean;
	shouldWrite?: boolean | undefined;
	writePath?: string | undefined;
	redirection?: string;
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

// Top Level
function createBuiltinProcess(command: string, args: string[]) {
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	const stdin = new PassThrough();
	const eventHandlers: { [key: string]: Function[] } = {};

	const on = (event: string, handler: Function) => {
		if (!eventHandlers[event]) eventHandlers[event] = [];
		eventHandlers[event].push(handler);
	};

	const emit = (event: string, ...args: any[]) => {
		(eventHandlers[event] || []).forEach(h => h(...args));
	};

	setImmediate(() => {
		try {
			let exitCode = 0;

			switch (command) {
				case "echo":
					stdout.write(`${args.join(" ")}\n`);
					break;

				case "type": {
					const checkCommand = args[0];
					if (!checkCommand) {
						stderr.write("type: please include an argument\n");
						exitCode = 1;
					} else if (isShellCommand(checkCommand)) {
						stdout.write(`${checkCommand} is a shell builtin\n`);
					} else {
						const pathVariable = process.env.PATH || "";
						const dirs = pathVariable.split(path.delimiter);
						let found = false;

						for (const dir of dirs) {
							const fullPath = path.join(dir, checkCommand);
							try {
								fs.accessSync(fullPath, fs.constants.X_OK);
								stdout.write(`${checkCommand}\n`);
								found = true;
								break;
							} catch {
								// continue searching
							}
						}

						if (!found) {
							stderr.write(`type: ${checkCommand} not found\n`);
							exitCode = 1;
						}
					}
					break;
				}

				case "pwd": {
					stdout.write(`${process.cwd()}\n`);
					break;
				}

				case "cd": {
					const dir = args[0] || os.homedir();
					try {
						fs.accessSync(path.resolve(dir));
						process.chdir(fs.realpathSync(path.resolve(dir)));
					} catch {
						stderr.write(`cd: ${path.resolve(dir)}: No such file or directory\n`);
						exitCode = 1;
					}
					break;
				}

				case "history": {
					const historyData = Array.from(history.values());
					const hasFlags = args.filter((arg) => arg.startsWith("-"));

					if (hasFlags.length > 0) {
						for (const f of hasFlags) {
							switch (f) {
								case "-r": {
									const getReadFlag = parseFlag(args, "-r", 1);
									const readFilePath = getReadFlag?.flagArgs[0] && path.resolve(getReadFlag?.flagArgs[0]);

									if (readFilePath) {
										try {
											const data = fs.readFileSync(readFilePath, "utf8");
											for (const line of data.split("\n")) {
												if (line.trim().length > 0) {
													history.set(history.size + 1, line.trim());
												}
											}
										} catch (err) {
											stderr.write(`${(err as Error).message}\n`);
											exitCode = 1;
										}
									} else {
										stderr.write("history: No file path provided with -r flag\n");
										exitCode = 1;
									}
									break;
								}
								case "-w": {
									const getWriteFlag = parseFlag(args, "-w", 1);
									const writeFilePath = getWriteFlag?.flagArgs[0] && path.resolve(getWriteFlag?.flagArgs[0]);

									if (writeFilePath) {
										stdout.write(historyData.join("\n") + "\n");
									} else {
										stderr.write("history: No file path provided with -w flag\n");
										exitCode = 1;
									}
									break;
								}
								case "-a": {
									const getAppendFlag = parseFlag(args, "-a", 1);
									const appendFilePath = getAppendFlag?.flagArgs[0] && path.resolve(getAppendFlag?.flagArgs[0]);

									if (appendFilePath) {
										const appendedHistoryData = historyData.splice(
											previousAppendSize,
											historyData.length - previousAppendSize
										);
										stdout.write(appendedHistoryData.join("\n") + "\n");
										previousAppendSize = previousAppendSize + appendedHistoryData.length;
									} else {
										stderr.write("history: No file path provided with -a flag\n");
										exitCode = 1;
									}
									break;
								}
							}
						}
					} else {
						const lastN = args[0] ? Number.parseInt(args[0]) : history.size;

						for (const [k, v] of history.entries()) {
							if (k > history.size - lastN) {
								stdout.write(`    ${k}  ${v}\n`);
							}
						}
					}
					break;
				}

				default:
					stderr.write(`${command}: command not found\n`);
					exitCode = 1;
			}

			stdout.end();
			stderr.end();
			emit('close', exitCode);
		} catch (err) {
			stderr.write(`${(err as Error).message}\n`);
			stderr.end();
			stdout.end();
			emit('close', 1);
		}
	});

	return { stdout, stderr, stdin, on };
}
function handlePipelines(tokens: string[]) {
	const lines = splitPipeCommands(tokens);

	const processes = lines.map((line) => {
		if (isShellCommand(line.process[0])) {
			return createBuiltinProcess(line.process[0], line.process.slice(1));
		}
		return spawn(line.process[0], line.process.slice(1));
	});

	for (let i = 0; i < processes.length - 1; i++) {
		if (lines[i].fd === 2) {
			processes[i].stderr.pipe(processes[i + 1].stdin);
		} else {
			processes[i].stdout.pipe(processes[i + 1].stdin);
		}
	}
	processes[processes.length - 1].stdout.pipe(process.stdout);
	processes[processes.length - 1].stderr.pipe(process.stderr);

	Promise.all(processes.map(p => new Promise<void>((resolve, reject) => {
		if (p.on) {
			p.on('close', (code: any) => {
				code === 0 ? resolve() : reject(new Error(`Process exited with code ${code}`));
			});
			p.on('error', reject);
		} else {
			resolve();
		}
	})))
		.then(() => {
			promptUser();
		})
		.catch(err => {
			processOutput({
				content: err.message,
				isError: true
			});
			promptUser();
		});
}
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
		try {
			const historyData = Array.from(history.values()).splice(historySizeOnLoad).join("\n");
			const writeStream = fs.createWriteStream(historyFilePath, { flags: 'a' });
			// fs.writeFileSync(historyFilePath, historyData + "\n");

			writeStream.write(historyData + "\n", () => {
				writeStream.end();
			});
			writeStream.on('finish', () => {
				rl.close();
				process.exit(0);
			});
			writeStream.on('error', () => {
				rl.close();
				process.exit(1);
			});
		} catch (err) {
			rl.close();
			process.exit(1);
		}
		return;
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
		case "history":
			handleHistory(args, outputArgs);
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
	}

	return tokens;
}

// Built-in Commands
function handleHistory(args: string[], outputArgs: string[] = []) {
	const hasFlags = args.filter((arg) => arg.startsWith("-"));
	if (hasFlags) {
		const historyData = Array.from(history.values());

		for (const f of hasFlags) {
			switch (f) {
				case "-r":
					const getReadFlag = parseFlag(args, "-r", 1);
					const readFilePath = getReadFlag?.flagArgs[0] && path.resolve(getReadFlag?.flagArgs[0]);

					if (readFilePath) {
						try {
							const data = fs.readFileSync(readFilePath, "utf8");
							for (const line of data.split("\n")) {
								if (line.trim().length < 1) continue;
								history.set(history.size + 1, line.trim());
							}
						} catch (err) {
							processOutput({
								content: (err as Error).message,
								isError: true,
								shouldWrite: outputArgs.length > 1,
								writePath: outputArgs[1]
							})
						}
					} else {
						processOutput({
							content: "history: No file path provided with -r flag",
							isError: true,
							shouldWrite: outputArgs.length > 1,
							writePath: outputArgs[1]
						})
					}
					return;
				case "-w":
					const getWriteFlag = parseFlag(args, "-w", 1);
					const writeFilePath = getWriteFlag?.flagArgs[0] && path.resolve(getWriteFlag?.flagArgs[0]);

					try {
						processOutput({
							content: historyData.join("\n"),
							shouldWrite: true,
							writePath: writeFilePath
						})
					} catch (err) {
						processOutput({
							content: (err as Error).message,
							isError: true,
							shouldWrite: outputArgs.length > 1,
							writePath: outputArgs[1]
						})
					}
					return;
				case "-a":
					const getAppendFlag = parseFlag(args, "-a", 1);
					const appendFilePath = getAppendFlag?.flagArgs[0] && path.resolve(getAppendFlag?.flagArgs[0]);

					const appendedHistoryData = historyData.splice(
						previousAppendSize,
						historyData.length - previousAppendSize
					);

					try {
						processOutput({
							content: appendedHistoryData.join("\n"),
							shouldWrite: true,
							writePath: appendFilePath,
							redirection: ">>"
						})
						previousAppendSize = appendedHistoryData.length + previousAppendSize;
					} catch (err) {
						processOutput({
							content: (err as Error).message,
							isError: true,
							shouldWrite: outputArgs.length > 1,
							writePath: outputArgs[1]
						})
					}
					return;
			}
		}
	}

	for (const [k, v] of history.entries()) {
		const kv = `${k}\ \ ${v}\n`;
		if (args[0] && k <= (history.size - Number.parseInt(args[0]))) continue;

		process.stdout.write("\ \ \ \ ".concat(kv), (err) => {
			if (err) console.error((err as Error).message);
			process.exitCode = 0;
		});
	}
}
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
function isPipeline(args: string[]) {
	return args.includes("\|") || args.includes("\|\&");
}
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
