class TrieNode {
	children = new Map<string, TrieNode>();
	// sibling = new Map<string, TrieNode>();
	isEnd = false;
}
export class Trie {
	root = new TrieNode();

	insert(word: string) {
		let node = this.root;
		for (const ch of word) {
			if (!node.children.has(ch)) node.children.set(ch, new TrieNode());
			node = node.children.get(ch)!;
		}
		node.isEnd = true;
	}
	// delete(word: string) {
	// 	const node = this.search(word);
	// }
	search(word: string): TrieNode | undefined {
		let node = this.root;
		for (const ch of word) {
			if (!node.children.has(ch)) return undefined;
			node = node.children.get(ch)!;
		}
		return node;
	}
	autocomplete(prefix: string): string[] {
		const node = this.search(prefix);
		if (!node) return [];
		return this._collect(node, prefix, []);
	}
	_collect(node: TrieNode | undefined, word: string, results: string[]): string[] {
		if (node?.isEnd) results.push(word);

		for (const [ch, nextNode] of node?.children || []) {
			this._collect(nextNode, word + ch, results);
		}
		return results;
	}
}
