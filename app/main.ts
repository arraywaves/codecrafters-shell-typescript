import { createInterface } from "readline";

const rl = createInterface({
	input: process.stdin,
	output: process.stdout,
});

const escapeOptions = ["exit", "quit", "q", "escape", "esc"];

const readline = () => rl.question("$ ", (answer) => {
	if (escapeOptions.includes(answer)) {
		rl.close();
		return;
	}

	console.log(`${answer}: command not found`);

	readline();
});

readline();
