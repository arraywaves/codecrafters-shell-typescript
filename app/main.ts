import { createInterface } from "readline";

const rl = createInterface({
	input: process.stdin,
	output: process.stdout,
});

const escapeOptions = ["exit", "quit", "q", "escape", "esc"];
const echoOptions = ["echo"];
const shellCommands = [...escapeOptions, ...echoOptions];

const readline = () => rl.question("$ ", (answer) => {
	if (escapeOptions.includes(answer)) {
		rl.close();
		return;
	}
	if (answer.startsWith("echo")) {
		console.log(answer.slice(5));
		readline();
		return;
	}
	if (answer.startsWith("type")) {
		const readCommand = answer.slice(5);
		if (shellCommands.includes(readCommand)) {
			console.log(`${readCommand} is a shell builtin`);
			readline();
			return;
		}
		console.log(`${readCommand}: not found`);
		readline();
		return;
	}

	console.log(`${answer}: command not found`);
	readline();
});

readline();
