import path from "node:path";
import { fileURLToPath } from "node:url";

/** <project root>/data, wherever the script is run from */
export const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));
export const RESULTS_DIR = path.join(DATA_DIR, "results");

/**
 * Turns a test-case file argument into a path. A bare name such as
 * "guardrail-cases" (or "guardrail-cases.json") lives in data/. Anything with a
 * directory in it is used as given.
 */
export const resolveCasesPath = (name: string): string => {
  const file = path.extname(name) ? name : `${name}.json`;
  return path.basename(file) === file ? path.join(DATA_DIR, file) : path.resolve(file);
};
