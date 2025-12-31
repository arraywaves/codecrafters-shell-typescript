import { createInterface } from "readline";
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from "child_process";

const rl = createInterface({
	input: process.stdin,
	output: process.stdout,
});
const shellCommands = {
	escape: ["exit", "quit", "q", "escape", "esc"],
	builtin: ["echo", "type", "pwd", "cd"]
} as const;
type ShellCommand = typeof shellCommands.escape[number] | typeof shellCommands.builtin[number];
type Redirection = ">>" | "2>" | "1>" | ">" | null
let redirection: Redirection = null;

promptUser();

function promptUser() {
	rl.question("$ ", processUserInput);
	// TODO: preferred prompt: rl.question(`${process.cwd().split(path.sep)[process.cwd().split(path.sep).length - 1]} → `, processUserInput);
}
function processUserInput(answer: string) {
	const [root, ...args] = handleFormatting(answer);
	let outputArgs: string[] = [];

	if (isToWrite(args)) {
		const appendStdout = args.indexOf(">>") === -1 ? 0 : args.indexOf(">>");
		const stderr = args.indexOf("2>") === -1 ? 0 : args.indexOf("2>");
		const stdout = args.indexOf("1>") === -1 ? 0 : args.indexOf("1>");
		const redirectIndex = appendStdout || stderr || stdout || args.indexOf(">");

		switch (args[redirectIndex]) {
			case ">>":
				redirection = ">>";
				break;
			case "2>":
				redirection = "2>";
				break;
			case "1>":
			case ">":
				redirection = "1>";
				break;
			default:
				redirection = null;
				break;
		}
		outputArgs = args.splice(redirectIndex, 2);
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
			content: `${answer}: command not found`,
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
	const final = !formattedContent?.endsWith('\n')
		? `${formattedContent}\n`
		: formattedContent;

	if (shouldWrite && writePath) {
		let contentCheck: string;
		switch (redirection) {
			case ">":
			case "1>":
				contentCheck = isError ? "" : final;
				if (isError) processOutput({ content: content, isError: true });
				break;
			case "2>":
				contentCheck = isError ? final : "";
				if (!isError) processOutput({ content: content });
				break;
			case ">>":
				contentCheck = final;
				if (isError) processOutput({ content: content, isError: true });
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
		const writeMode = redirection === ">>" ? 'a' : 'w';
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
		return;
	}

	switch (command) {
		case "cd":
			handleChangeDir(args[0], outputArgs, redirection);
			break;
		case "echo":
			handleEcho(args, outputArgs, redirection);
			break;
		case "pwd":
			handlePrintWorkingDir(outputArgs, redirection);
			break;
		case "type":
			const checkBuiltIn = args[0];
			handleType(checkBuiltIn || "", outputArgs, redirection);
			break;
	}
	promptUser();
}
function handleFormatting(answer: string) {
	const formattedAnswer = answer.normalize("NFC");
	const tokens: string[] = [];
	const delimiters = ["\ ", "\t"];

	let inSingleQuotes = false;
	let inDoubleQuotes = false;
	let escape = false;
	let currentToken = "";

	function updateToken(char: string) {
		currentToken += char;
	}

	for (const char of formattedAnswer) {
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
			isExecutable(checkCommand, pathVariable, true, outputArgs, redirection);
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
function isToWrite(args: string[]): boolean {
	return args.includes(">") || args.includes("1>") || args.includes("2>") || args.includes(">>");
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
				// Not found here.
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
