import boxen from "boxen";
import chalk from "chalk";

// Track if any verification warnings have been shown
let hasShownVerificationWarning = false;

/**
 * Check if any verification warnings have been shown
 */
export function hasVerificationWarnings(): boolean {
  return hasShownVerificationWarning;
}

/**
 * Reset verification warning flag
 */
export function resetVerificationWarnings(): void {
  hasShownVerificationWarning = false;
}

/**
 * Print a banner box with custom styling
 */
export function printBanner(
  title: string,
  messages: string[],
  borderColor: "red" | "yellow" | "green" | "cyan" | "blue" = "red",
): void {
  const content = messages.length > 0 ? [chalk.bold(title), "", ...messages].join("\n") : chalk.bold(title);

  console.log("\n" + boxen(content, { padding: 1, margin: 0, borderStyle: "double", borderColor }) + "\n");
}

/**
 * Print a large red warning box with a message
 */
export function printVerificationWarning(title: string, messages: string[]): void {
  hasShownVerificationWarning = true;
  printBanner(title, messages, "red");
}

/**
 * Print a success banner
 */
export function printSuccess(title: string, messages: string[] = []): void {
  printBanner(title, messages, "green");
}

/**
 * Print an info banner
 */
export function printInfo(title: string, messages: string[] = []): void {
  printBanner(title, messages, "cyan");
}
