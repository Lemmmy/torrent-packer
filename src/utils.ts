import * as fs from "node:fs/promises";

export function tokenizeCommandTemplate(template: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < template.length; i++) {
    const ch = template[i];
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (/\s/.test(ch) && !inSingle && !inDouble) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

export function buildExecSpec(
  template: string,
  filePath: string,
): {
  command: string;
  args: string[];
} {
  const tokens = tokenizeCommandTemplate(template);
  if (tokens.length === 0) throw new Error("exec spec template is empty");
  const command = tokens[0];
  const args: string[] = [];
  let replaced = false;
  for (const t of tokens.slice(1)) {
    if (t === "%1") {
      args.push(filePath);
      replaced = true;
    } else {
      args.push(t);
    }
  }
  if (!replaced) args.push(filePath);
  return { command, args };
}

export const isDirectory = (path: string): Promise<boolean> => fs.stat(path).then((stat) => stat.isDirectory());

export const tryOrNull = <T>(fn: () => T): T | null => {
  try {
    return fn();
  } catch {
    return null;
  }
};
