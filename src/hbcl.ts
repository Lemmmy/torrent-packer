import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "./env.ts";
import { buildExecSpec } from "./utils.ts";

export interface HbclResult {
  score: number | null;
  logUnrecognized: boolean;
  logEdited: boolean;
  output: string;
}

const execFileAsync = promisify(execFile);

export async function runHbcl(filePath: string): Promise<HbclResult> {
  const { command, args } = buildExecSpec(env.HBCL_CMD, filePath);
  const { stdout, stderr } = await execFileAsync(command, args, {
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      // Force UTF-8 so hbcl can read/print paths with non-ASCII characters
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
  });

  const combined = [stdout, stderr].filter(Boolean).join("\n");
  const sanitized = combined
    .split(/\r?\n/)
    .filter((line) => !/^\s*Log:\s*/.test(line))
    .join("\n")
    .trim();

  const logUnrecognized = /Log is unrecognized/.test(sanitized);
  const logEdited = /Log checksum does not match/.test(sanitized);

  const match = sanitized.match(/^\s*Score:\s*(-?\d+)/im);
  if (!match && !logUnrecognized) {
    console.error("Failed to parse score from hbcl output. Sanitized log follows:");
    console.error(sanitized);
    console.error("Args:", command, args);
    throw new Error("Failed to parse score from hbcl output");
  }

  const score = match ? Number(match[1]) : null;
  return {
    score,
    logUnrecognized,
    logEdited,
    output: sanitized,
  };
}
