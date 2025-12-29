import { createInterface } from "readline";
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec } from "child_process";

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
	rl.question("$ ", handleUserInput);
	// TODO: preferred prompt: rl.question(`${process.cwd().split(path.sep)[process.cwd().split(path.sep).length - 1]} → `, handleUserInput);
}
function handleUserInput(answer: string) {
	const [commandOrExe, ...args] = handleFormatting(answer);

	if (isShellCommand(commandOrExe)) {
		handleShellCommands(commandOrExe, args);
		return;
	}
	if (isExecutable(commandOrExe, process.env.PATH || "")) {
		handleExecutable(commandOrExe, args);
		return;
	} else if (commandOrExe && args.length > 0) {
		console.log(`${commandOrExe}: ${args[0]} not found`);
		promptUser();
		return;
	}

	if (commandOrExe) {
		console.log(`${answer}: command not found`);
	}
	promptUser();
}

function handleExecutable(commandOrExe: string, args: string[]) {
	try {
		exec(`${commandOrExe} ${args.join(" ")}`, (err, stdout, stderr) => {
			if (err) {
				console.error(`Error: ${err.message}`);
			}
			if (stderr) {
				console.error(stderr);
			}
			if (stdout) {
				process.stdout.write(stdout);
			}
			promptUser();
		});
	} catch (err) {
		console.error(err);
		promptUser();
	}
}
function handleShellCommands(command: ShellCommand, args: string[]) {
	if (isEscapeCommand(command)) {
		rl.close();
		return;
	}

	switch (command) {
		case "cd":
			handleChangeDir(args[0]);
			break;
		case "echo":
			handleEcho(args);
			break;
		case "pwd":
			handlePrintWorkingDir();
			break;
		case "type":
			const checkBuiltIn = args[0];
			handleType(checkBuiltIn || "");
			break;
	}
	promptUser();
}
function handleFormatting(answer: string) {
	const formattedAnswer = answer.normalize("NFC");
	const delimiters = [" ", "\t"];
	const tokens: string[] = [];

	let inQuotes = false;
	let preCh;
	let currentToken = "";

	for (const char of formattedAnswer) {
		if (!preCh) preCh = char;

		if (inQuotes) {
			if (char === "\'") {
				if (tokens[0] === "cat") currentToken += char;
				inQuotes = false;
				continue;
			}
			if (char === "\'") {
				currentToken += char;
				inQuotes = false;
				continue;
			}

			currentToken += char;
			continue;
		} else if ((preCh === "\"" || preCh === "\'") && (char === "\"" || char === "\'")) {
			console.log("double")
		}

		if (delimiters.includes(char)) {
			if (currentToken.length > 0) {
				tokens.push(currentToken)
				currentToken = "";
			};
			continue;
		}

		switch (char) {
			case "\'":
				if (!inQuotes) {
					inQuotes = true;
					if (tokens[0] === "cat") currentToken += char;
					continue;
				};
				inQuotes = false;
				continue;
			case "\"":
				if (!inQuotes) {
					inQuotes = true;
					currentToken += char;
					continue;
				};
				inQuotes = false;
				continue;
			case "\~":
				if (!inQuotes) {
					currentToken += os.homedir();
				}
				continue;
			default:
				currentToken += char;
				continue;
		}
	}
	if (currentToken.length > 0) {
		tokens.push(currentToken)
		currentToken = "";
	};

	return tokens;
}

function handleChangeDir(dir: string) {
	let finalPath = dir;

	// if (dir.includes("~")) {
	// 	const homeDir = dir.replace(/^~/, os.homedir() || "");

	// 	finalPath = homeDir;
	// }

	if (!path.isAbsolute(finalPath)) {
		finalPath = path.resolve(finalPath);
	}

	try {
		fs.accessSync(finalPath);
		process.chdir(fs.realpathSync(finalPath));
	} catch (_err) {
		console.error(`cd: ${dir}: No such file or directory`);
	}
}
function handlePrintWorkingDir() {
	console.log(process.cwd());
}
function handleEcho(args: string[]) {
	console.log(...args);
}
function handleType(checkCommand: string) {
	if (checkCommand === "") {
		console.log("type: please include an argument");
	} else if (isShellCommand(checkCommand)) {
		console.log(`${checkCommand} is a shell builtin`);
	} else {
		const pathVariable = process.env.PATH;
		if (pathVariable && pathVariable !== "") {
			isExecutable(checkCommand, pathVariable, true);
		} else {
			console.log(`${checkCommand}: please set PATH`);
		}
	}
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
function isExecutable(command: string, pathToCheck: string, log = false) {
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
				if (log) console.log(`${command} is ${fullPath}`);
				commandIsExecutable = true;
				break;
			} catch (err) {
				// Not found here.
			}
		}
	}

	if (log) if (!commandIsExecutable) console.log(`${command}: not found`);
	return commandIsExecutable;
}
