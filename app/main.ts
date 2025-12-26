import { createInterface } from "readline";
import * as fs from 'fs';
import * as path from 'path';
import { exec } from "child_process";

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

	if (commandOrExe) {
		const isExecutable = checkIsExecutable(commandOrExe, process.env.PATH || "");
		if (isExecutable) {
			try {
				exec(`${commandOrExe} ${args.join(" ")}`, (error, stdout, stderr) => {
					if (error) {
						console.error(`Error: ${error.message}`);
					}
					if (stderr) {
						console.error(stderr);
					}
					if (stdout) {
						console.log(stdout);
					}
					readline();
				});
			} catch (err) {
				console.error(err);
				readline();
			}
		} else {
			console.log(`${commandOrExe}: ${args[0]} not found`);
			readline();
		}
		return;
	}

	console.log(`${answer}: command not found`);
	readline();
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
			handleType(checkBuiltIn || "");
			readline();
			return;
		default:
			break;
	}
}
function handleEcho(args: string[]) {
	console.log(...args);
}
function handleType(checkCommand: string) {
	if (checkCommand === "") {
		console.log("Please include a command to check");
	} else if (shellCommands.includes(checkCommand)) {
		console.log(`${checkCommand} is a shell builtin`);
	} else {
		const pathVariable = process.env.PATH;
		if (pathVariable && pathVariable !== "") {
			checkIsExecutable(checkCommand, pathVariable, true);
		} else {
			console.log(`${checkCommand}: please set PATH`);
		}
	}
}
function checkIsExecutable(command: string, pathToCheck: string, log = false) {
	let isExecutable = false;
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
