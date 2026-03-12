// Commander process spawner with JSONL event collection.

import { spawn } from "child_process";
import { createInterface } from "readline";

export interface CommanderOptions {
  commanderPath: string;
  model: string;
  scenarioPath: string;
  maxTicks: number;
  serverUrl: string;
  session: string;
  openrouterApiKey?: string;
  timeoutMs: number;
}

export interface BenchmarkEvent {
  event: string;
  tick: number;
  ts: string;
  [key: string]: unknown;
}

export interface CommanderResult {
  events: BenchmarkEvent[];
  exitCode: number | null;
  stderr: string;
}

export async function runCommander(opts: CommanderOptions): Promise<CommanderResult> {
  const args = [
    "run", opts.commanderPath,
    "--model", opts.model,
    "--benchmark",
    "--max-ticks", String(opts.maxTicks),
    "--scenario", opts.scenarioPath,
    "--url", opts.serverUrl,
    "--session", opts.session,
    "--openrouter",
  ];

  const env: Record<string, string> = { ...process.env as Record<string, string> };
  if (opts.openrouterApiKey) {
    env.OPENROUTER_API_KEY = opts.openrouterApiKey;
  }
  return new Promise((resolve) => {
    const events: BenchmarkEvent[] = [];
    let stderr = "";

    const child = spawn("bun", args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const rl = createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.event) {
          events.push(parsed as BenchmarkEvent);
        }
      } catch {
        // Non-JSON line from commander stdout (logging), ignore
      }
    });

    child.stderr!.on("data", (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, opts.timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ events, exitCode: code, stderr });
    });
  });
}
