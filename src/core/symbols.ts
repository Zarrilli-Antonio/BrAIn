import fs from "node:fs";
import ts from "typescript";
import { safeResolve } from "./paths.js";

export interface Symbol {
  line: number;
  endLine?: number;
  kind: string;
  name?: string;
  signature: string;
}

// ponytail: regex heuristics for non-JS/TS languages; upgrade per-language if precision matters there too
const PATTERNS: Record<string, RegExp[]> = {
  ".py": [/^\s*(async\s+)?def\s+\w+/, /^\s*class\s+\w+/],
  ".go": [/^\s*func\s+(\(\w+\s+\*?\w+\)\s+)?\w+/, /^\s*type\s+\w+\s+struct/],
  ".rs": [/^\s*(pub\s+)?fn\s+\w+/, /^\s*(pub\s+)?struct\s+\w+/, /^\s*(pub\s+)?enum\s+\w+/],
  ".java": [/^\s*(public|private|protected)\s+.*\s+\w+\s*\(/, /^\s*(public\s+)?class\s+\w+/],
  ".cs": [/^\s*(public|private|protected|internal)\s+.*\s+\w+\s*\(/, /^\s*(public\s+)?class\s+\w+/],
};

const TS_SCRIPT_KIND: Record<string, ts.ScriptKind> = {
  ".js": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
  ".ts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
};

export function getSymbols(root: string, rel: string): Symbol[] {
  const abs = safeResolve(root, rel);
  const ext = "." + (abs.split(".").pop() ?? "");
  const content = fs.readFileSync(abs, "utf-8");

  if (TS_SCRIPT_KIND[ext]) {
    try {
      return getTsSymbols(abs, content, TS_SCRIPT_KIND[ext]);
    } catch {
      // Fall through to the regex heuristics below if the AST parse ever throws on unusual input.
    }
  }

  const patterns = PATTERNS[ext];
  if (!patterns || patterns.length === 0) return [];
  return getRegexSymbols(content, patterns);
}

function getRegexSymbols(content: string, patterns: RegExp[]): Symbol[] {
  const lines = content.split("\n");
  const out: Symbol[] = [];
  lines.forEach((line, i) => {
    for (const re of patterns) {
      if (re.test(line)) {
        out.push({ line: i + 1, kind: "def", signature: line.trim().slice(0, 200) });
        break;
      }
    }
  });
  return out;
}

/** Real AST walk via the TypeScript compiler API — accurate for JS and TS alike (TS is a superset),
 *  including constructs the old regex heuristics couldn't see: interfaces, type aliases, enums,
 *  class methods, and arrow/function-expression consts. */
function getTsSymbols(abs: string, content: string, scriptKind: ts.ScriptKind): Symbol[] {
  const sourceFile = ts.createSourceFile(abs, content, ts.ScriptTarget.Latest, true, scriptKind);
  const lines = content.split("\n");
  const out: Symbol[] = [];

  const lineOf = (pos: number) => sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  const push = (kind: string, name: string, node: ts.Node) => {
    const startLine = lineOf(node.getStart(sourceFile));
    out.push({
      line: startLine,
      endLine: lineOf(node.getEnd()),
      kind,
      name,
      signature: (lines[startLine - 1] ?? "").trim().slice(0, 200),
    });
  };

  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      push("function", node.name.text, node);
    } else if (ts.isClassDeclaration(node) && node.name) {
      push("class", node.name.text, node);
    } else if (ts.isInterfaceDeclaration(node)) {
      push("interface", node.name.text, node);
    } else if (ts.isTypeAliasDeclaration(node)) {
      push("type", node.name.text, node);
    } else if (ts.isEnumDeclaration(node)) {
      push("enum", node.name.text, node);
    } else if (ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) {
      const name = node.name && (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name)) ? node.name.text : "constructor";
      push("method", name, node);
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          push("function", decl.name.text, node);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return out.sort((a, b) => a.line - b.line);
}
