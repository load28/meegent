import { createRequire } from "node:module";
import { extname } from "node:path";
import Parser from "web-tree-sitter";

const require = createRequire(import.meta.url);

/** Map a file extension to a tree-sitter-wasms grammar name. */
function grammarFor(path: string): string | undefined {
  switch (extname(path).toLowerCase()) {
    case ".ts": case ".mts": case ".cts": return "typescript";
    case ".tsx": return "tsx";
    case ".js": case ".mjs": case ".cjs": case ".jsx": return "javascript";
    case ".py": return "python";
    case ".go": return "go";
    case ".rs": return "rust";
    case ".java": return "java";
    case ".c": case ".h": return "c";
    case ".cc": case ".cpp": case ".cxx": case ".hpp": case ".hh": return "cpp";
    default: return undefined;
  }
}

let initPromise: Promise<void> | undefined;
let parser: Parser | undefined;
// grammar name → Language (null = tried and failed/unsupported, so we stop retrying)
const languages = new Map<string, Parser.Language | null>();

/**
 * Ensure the tree-sitter grammar for `path`'s language is loaded. Async (wasm load); call and await
 * before a sync `resolveBlockTS`. Degrades gracefully: any failure marks the language unsupported
 * and returns false (callers fall back to the brace/indent resolver).
 */
export async function ensureLanguage(path: string): Promise<boolean> {
  const name = grammarFor(path);
  if (!name) return false;
  if (languages.has(name)) return languages.get(name) != null;
  try {
    if (!initPromise) initPromise = Parser.init();
    await initPromise;
    if (!parser) parser = new Parser();
    const wasm = require.resolve(`tree-sitter-wasms/out/tree-sitter-${name}.wasm`);
    const lang = await Parser.Language.load(wasm);
    languages.set(name, lang);
    return true;
  } catch {
    languages.set(name, null);
    return false;
  }
}

function loadedLanguage(path: string): Parser.Language | undefined {
  const name = grammarFor(path);
  if (!name) return undefined;
  return languages.get(name) ?? undefined;
}

/** The largest named node beginning exactly at `row` (0-indexed), i.e. the outermost block there. */
function largestNamedNodeStartingAtRow(root: Parser.SyntaxNode, row: number): Parser.SyntaxNode | undefined {
  let best: Parser.SyntaxNode | undefined;
  const stack: Parser.SyntaxNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    // Skip the root container (module/program), which also starts at row 0 and spans the whole file.
    if (n !== root && n.isNamed && n.startPosition.row === row) {
      if (!best || n.endIndex - n.startIndex > best.endIndex - best.startIndex) best = n;
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i);
      if (c && c.startPosition.row <= row && c.endPosition.row >= row) stack.push(c);
    }
  }
  return best;
}

/**
 * Resolve a block via tree-sitter to a 1-indexed inclusive line range, or undefined if the language
 * isn't loaded / no block begins at `startLine`. `ensureLanguage(path)` must have been awaited.
 */
export function resolveBlockTS(path: string, content: string, startLine: number): { start: number; end: number } | undefined {
  const lang = loadedLanguage(path);
  if (!lang || !parser) return undefined;
  parser.setLanguage(lang);
  const tree = parser.parse(content);
  try {
    const node = largestNamedNodeStartingAtRow(tree.rootNode, startLine - 1);
    if (!node) return undefined;
    return { start: startLine, end: node.endPosition.row + 1 };
  } finally {
    tree.delete();
  }
}
