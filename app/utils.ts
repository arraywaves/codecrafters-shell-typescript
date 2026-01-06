export function findLCP(strings: string[]): string {
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
export function getFirstCommonElementInArray<T>(searchArray: unknown[], elementArray: readonly T[]): T | undefined {
	return searchArray.find(
		(element): element is T => elementArray.includes(element as T)
	) as T | undefined;
}
export function parseFlag(args: string[], flag: string, expectedArgumentCount: number): { flag: string, flagArgs: string[] } | undefined {
	if (args.includes(flag)) {
		const flagIndex = args.indexOf(flag);
		const flagArgs = args.splice(flagIndex + 1, expectedArgumentCount);

		return { flag, flagArgs };
	}
	return;
}
export function splitPipeCommands(tokens: string[]) {
	if (tokens.length === 0) return [{ process: [] }];

	const pipeIndices = tokens.reduce((acc, arg, index) => {
		if (arg === '\|' || arg === '\|\&') acc.push(index);

		return acc;
	}, [] as number[]);
	if (pipeIndices.length === 0) return [{ process: tokens }];

	const processes: {
		process: string[],
		fd?: 1 | 2 | undefined
	}[] = [];
	let start = 0;

	pipeIndices.forEach((pipeIndex) => {
		processes.push({
			process: tokens.slice(start, pipeIndex),
			fd: getFD(tokens, pipeIndex)
		});
		start = pipeIndex + 1;
	});
	processes.push({
		process: tokens.slice(start)
	});

	return processes;
}
function getFD(tokens: string[], pipeIndex: number) {
	switch (tokens[pipeIndex]) {
		case "\|":
			return 1;
		case "\|\&":
			return 2;
		default:
			return undefined;
	}
}
