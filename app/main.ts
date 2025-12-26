import { createInterface } from "readline";
import * as fs from 'fs';
import * as path from 'path';

const rl = createInterface({
	input: process.stdin,
	output: process.stdout,
});

const escapeOptions = ["exit", "quit", "q", "escape", "esc"];
const shellCommands = [...escapeOptions, "echo", "type"];

const readline = () => rl.question("$ ", (answer) => {
	const [command, ...args] = answer.split(" ");

	if (escapeOptions.includes(answer)) {
		rl.close();
		return;
	}
	if (command === "echo") {
		console.log(...args);
		readline();
		return;
	}
	if (command === "type") {
		const checkCommand = args[0];
		if (shellCommands.includes(checkCommand)) {
			console.log(`${checkCommand} is a shell builtin`);
			readline();
			return;
		} else {
			let found = false;
			let paths = process.env.PATH?.split(path.delimiter);

			if (paths) {
				for (const dir of paths) {
					const fullPath = path.join(dir, checkCommand);

					try {
						fs.accessSync(fullPath, fs.constants.X_OK);
						console.log(`${checkCommand} is ${fullPath}`);
						found = true;
						break;
					} catch (err) {
						// Not found
					}
				}
			}

			if (!found) console.log(`${checkCommand}: not found`);
		}
		readline();
		return;
	}

	console.log(`${answer}: command not found`);
	readline();
});

readline();
