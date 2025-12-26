import { createInterface } from "readline";
import * as fs from 'fs';
import * as path from 'path';

const rl = createInterface({
	input: process.stdin,
	output: process.stdout,
});

const escapeOptions = ["exit", "quit", "q", "escape", "esc"];
const builtInCommands = ["echo", "type"];
const shellCommands = [...escapeOptions, ...builtInCommands];

const readline = () => rl.question("$ ", (answer) => {
	const [commandOrExe, ...args] = answer.split(" ");

	if (shellCommands.includes(commandOrExe)) {
		handleShellCommands(commandOrExe, args);
		return;
	}

	const isExecutable = checkIsExecutable(args[0], process.env.PATH || "");
	if (isExecutable) {
		console.log("exe");
	}

	console.log(`${answer}: command not found`);
	readline();
	return;
});
readline();

function handleShellCommands(command: string, args: string[]) {
	if (escapeOptions.includes(command)) {
		rl.close();
		return;
	}
	switch (command) {
		case "echo":
			handleEcho(args);
			readline();
			return;
		case "type":
			const checkBuiltIn = args[0];
			handleType(checkBuiltIn);
			readline();
			return;
		default:
			break;
	}
}
function handleEcho(args: string[]) {
	console.log(...args);
}
function handleType(checkBuiltIn: string) {
	if (shellCommands.includes(checkBuiltIn)) {
		console.log(`${checkBuiltIn} is a shell builtin`);
	} else {
		checkIsExecutable(checkBuiltIn, process.env.PATH || "", true);
	}
}
function checkIsExecutable(command: string, pathToCheck: string, log = false) {
	let isExecutable = false;
	let paths = pathToCheck.split(path.delimiter);

	if (paths) {
		for (const dir of paths) {
			const fullPath = path.join(dir, command);

			try {
				fs.accessSync(fullPath, fs.constants.X_OK);
				if (log) console.log(`${command} is ${fullPath}`);
				isExecutable = true;
				break;
			} catch (err) {
				// Not found here.
			}
		}
	}

	if (log) if (!isExecutable) console.log(`${command}: not found`);
	return isExecutable;
}
