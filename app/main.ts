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

promptUser();

function promptUser() {
	rl.question("$ ", processUserInput);
	// TODO: preferred prompt: rl.question(`${process.cwd().split(path.sep)[process.cwd().split(path.sep).length - 1]} → `, processUserInput);
}
function processUserInput(answer: string) {
	const [root, ...args] = handleFormatting(answer);
	let outputArgs: string[] = [];

	if (isToWrite(args)) {
		const unixStderr = args.indexOf("2>") === -1 ? 0 : args.indexOf("2>");
		const unixStdout = args.indexOf("1>") === -1 ? 0 : args.indexOf("1>");
		outputArgs = args.splice(unixStderr || unixStdout || args.indexOf(">"), 2);
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
	const formattedContent = content.trim().normalize();
	const finalContent = !shouldWrite && !formattedContent.endsWith('\n')
		? `${formattedContent}\n`
		: formattedContent;

	if (shouldWrite && writePath) {
		let processedWritePath = `${path.dirname(writePath)}${path.sep}${path.basename(writePath)}`;
		if (!path.isAbsolute(processedWritePath)) {
			processedWritePath = path.resolve(processedWritePath);
		}
		try {
			fs.accessSync(path.dirname(processedWritePath));
		} catch {
			try {
				fs.mkdirSync(path.dirname(processedWritePath), { recursive: true })
			} catch (err) {
				processOutput({
					content: formattedContent,
					isError: true
				})
			}
		}
		try {
			fs.writeFileSync(processedWritePath, formattedContent);
			if (isError) {
				processOutput({
					content: formattedContent,
					isError: true
				})
			}
		} catch (err) {
			processOutput({
				content: formattedContent,
				isError: true
			})
		}
		return;
	}
	if (isError) {
		process.stderr.write(finalContent, (err) => {
			if (err) console.error((err as Error).message);
		});
	} else {
		process.stdout.write(finalContent, (err) => {
			if (err) console.error((err as Error).message);
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
			isError: true
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
	let finalPath = dir;

	if (!path.isAbsolute(finalPath)) {
		finalPath = path.resolve(finalPath);
	}

	try {
		fs.accessSync(finalPath);
		process.chdir(fs.realpathSync(finalPath));
	} catch (err) {
		processOutput({
			content: (err as Error).message,
			isError: true,
			shouldWrite: outputArgs.length > 1,
			writePath: outputArgs[1]
		})
	}
}
function handlePrintWorkingDir(outputArgs: string[] = []) {
	processOutput({
		content: process.cwd(),
		shouldWrite: outputArgs.length > 1,
		writePath: outputArgs[1]
	})
}
function handleEcho(args: string[], outputArgs: string[] = []) {
	processOutput({
		content: `${args.join(" ")}`,
		shouldWrite: outputArgs.length > 1,
		writePath: outputArgs[1]
	})
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
function isToWrite(args: string[]): boolean {
	return args.includes(">") || args.includes("1>") || args.includes("2>");
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
				if (log) processOutput({ content: `${command} is ${fullPath}`, shouldWrite: outputArgs.length > 1, writePath: outputArgs[1] });
				commandIsExecutable = true;
				break;
			} catch (err) {
				// Not found here.
			}
		}
	}

	if (log) if (!commandIsExecutable) processOutput({ content: `${command}: not found`, isError: true });
	return commandIsExecutable;
}
