#!/usr/bin/env bun
// SMBench Runner — orchestrates benchmark runs across models and scenarios.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { parse as parseYaml } from "yaml";
import { createAdminClient } from "./lib/admin-client.js";
import { runCommander, type BenchmarkEvent } from "./lib/process.js";
import { scoreRun, aggregateScores, type RunScore, type AggregateScore } from "./lib/scorer.js";
import { generateJsonReport, generateMarkdownReport, type ModelResult, type BenchmarkReport } from "./lib/report.js";

// ─── Config ──────────────────────────────────────────────────

interface ModelConfig {
  id: string;
  label: string;
  category: string;
}

interface BenchmarkConfig {
  server: {
    url: string;
    admin_token: string;
    tick_rate: number;
  };
  models: ModelConfig[];
  scenarios: string[];
  runs_per_scenario: number;
  commander_path: string;
  scenarios_dir: string;
}

// ─── CLI ─────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
SMBench Runner — SpaceMolt AI Benchmark

Usage:
  bun run src/runner.ts --config <path> [options]

Options:
  --config <path>     Path to benchmark config YAML (required)
  --output <dir>      Output directory for results (default: results/)
  --model <id>        Run only this model (skip others in config)
  --scenario <name>   Run only this scenario
  --runs <N>          Override runs_per_scenario from config
  --help              Show this help

Examples:
  bun run src/runner.ts --config config.yaml
  bun run src/runner.ts --config config.yaml --model anthropic/claude-sonnet-4-6 --scenario s1-bootstrap-grind
`);
}

interface CLIArgs {
  configPath: string;
  outputDir: string;
  filterModel?: string;
  filterScenario?: string;
  overrideRuns?: number;
}

function parseArgs(): CLIArgs | null {
  const args = process.argv.slice(2);
  let configPath = "";
  let outputDir = "results";
  let filterModel: string | undefined;
  let filterScenario: string | undefined;
  let overrideRuns: number | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--config":
        configPath = args[++i] || "";
        break;
      case "--output":
        outputDir = args[++i] || outputDir;
        break;
      case "--model":
        filterModel = args[++i];
        break;
      case "--scenario":
        filterScenario = args[++i];
        break;
      case "--runs":
        overrideRuns = parseInt(args[++i] || "0", 10);
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
    }
  }

  if (!configPath) {
    console.error("Error: --config is required");
    printUsage();
    return null;
  }

  return { configPath, outputDir, filterModel, filterScenario, overrideRuns };
}

// ─── Transcript saving ──────────────────────────────────────

const SENSITIVE_PATTERNS = [
  /registration_code["']?\s*[:=]\s*["'][^"']+["']/gi,
  /password["']?\s*[:=]\s*["'][^"']+["']/gi,
  /token["']?\s*[:=]\s*["'][^"']+["']/gi,
  /api[_-]?key["']?\s*[:=]\s*["'][^"']+["']/gi,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
];

function scrubSensitive(text: string): string {
  let scrubbed = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, (match) => {
      const eqIdx = match.search(/[:=]/);
      if (eqIdx >= 0) {
        return match.slice(0, eqIdx + 1) + ' "[REDACTED]"';
      }
      return "[REDACTED]";
    });
  }
  return scrubbed;
}

function saveTranscript(
  outputDir: string,
  modelId: string,
  scenarioId: string,
  run: number,
  events: import("./lib/process.js").BenchmarkEvent[],
): void {
  const modelSlug = modelId.replace(/\//g, "-");
  const dir = join(outputDir, "transcripts", modelSlug);
  mkdirSync(dir, { recursive: true });
  const lines = events.map((e) => scrubSensitive(JSON.stringify(e)));
  writeFileSync(join(dir, `${scenarioId}-r${run}.jsonl`), lines.join("\n") + "\n");
}

// ─── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cli = parseArgs();
  if (!cli) process.exit(1);

  // Load config
  const configText = readFileSync(cli.configPath, "utf-8");
  const config = parseYaml(configText) as BenchmarkConfig;

  const serverUrl = config.server.url.replace(/\/$/, "");
  const commanderUrl = `${serverUrl}/api/v1`; // Commander expects /api/v1 base
  const adminToken = config.server.admin_token;
  const runsPerScenario = cli.overrideRuns || config.runs_per_scenario || 2;
  const commanderPath = config.commander_path;
  const scenariosDir = config.scenarios_dir || "scenarios";

  if (!commanderPath) {
    console.error("Error: commander_path is required in config (path to commander's src/commander.ts)");
    process.exit(1);
  }

  const admin = createAdminClient(serverUrl, adminToken);

  // Filter models and scenarios
  let models = config.models;
  if (cli.filterModel) {
    models = models.filter((m) => m.id === cli.filterModel);
    if (models.length === 0) {
      console.error(`Model not found: ${cli.filterModel}`);
      process.exit(1);
    }
  }

  let scenarios = config.scenarios;
  if (cli.filterScenario) {
    scenarios = scenarios.filter((s) => s === cli.filterScenario);
    if (scenarios.length === 0) {
      console.error(`Scenario not found: ${cli.filterScenario}`);
      process.exit(1);
    }
  }

  console.log(`SMBench Runner starting`);
  console.log(`  Server: ${serverUrl}`);
  console.log(`  Commander: ${commanderPath}`);
  console.log(`  Models: ${models.length}`);
  console.log(`  Scenarios: ${scenarios.length}`);
  console.log(`  Runs per scenario: ${runsPerScenario}`);
  console.log(`  Total runs: ${models.length * scenarios.length * runsPerScenario}`);
  console.log("");

  // Ensure output directory exists
  mkdirSync(cli.outputDir, { recursive: true });

  const allModelResults: ModelResult[] = [];

  for (const model of models) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`MODEL: ${model.label} (${model.id})`);
    console.log(`${"=".repeat(60)}`);

    const scenarioResults: Record<string, AggregateScore> = {};

    for (const scenarioId of scenarios) {
      const scenarioPath = resolve(scenariosDir, `${scenarioId}.md`);
      if (!existsSync(scenarioPath)) {
        console.error(`  Scenario file not found: ${scenarioPath}`);
        continue;
      }

      console.log(`\n  Scenario: ${scenarioId}`);
      const runs: RunScore[] = [];

      for (let run = 1; run <= runsPerScenario; run++) {
        console.log(`    Run ${run}/${runsPerScenario}...`);

        // Reset server state
        try {
          await admin.reset();
          console.log(`    Server reset OK`);
        } catch (err) {
          console.error(`    Server reset failed: ${err}`);
          continue;
        }

        // Determine max ticks from scenario (default 200)
        const scenarioContent = readFileSync(scenarioPath, "utf-8");
        const tickMatch = scenarioContent.match(/(\d+)\s+ticks/);
        const maxTicks = tickMatch ? parseInt(tickMatch[1], 10) : 200;

        // Run commander
        const sessionName = `bench-${model.id.replace(/\//g, "-")}-${scenarioId}-r${run}`;
        const timeoutMs = maxTicks * (config.server.tick_rate || 2) * 1000 * 2; // 2x safety margin

        const result = await runCommander({
          commanderPath,
          model: model.id,
          scenarioPath,
          maxTicks,
          serverUrl: commanderUrl,
          session: sessionName,
          openrouterApiKey: process.env.OPENROUTER_API_KEY,
          timeoutMs,
        });

        console.log(`    Commander exited (code=${result.exitCode}, events=${result.events.length})`);

        // Get player stats from server
        let playerStats: Record<string, unknown> = {};
        try {
          playerStats = await admin.getPlayerStats(sessionName);
        } catch {
          console.log(`    Could not fetch player stats (player may not have registered)`);
        }

        // Save JSONL transcript (scrubbed)
        saveTranscript(cli.outputDir, model.id, scenarioId, run, result.events);

        // Score the run
        const runScore = scoreRun(scenarioId, result.events, playerStats);
        runs.push(runScore);
        console.log(`    Score: ${runScore.score} (pass: ${runScore.pass})`);
        if (Object.keys(runScore.metrics).length > 0) {
          const metricStr = Object.entries(runScore.metrics)
            .map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(1) : v}`)
            .join(", ");
          console.log(`    Metrics: ${metricStr}`);
        }
      }

      scenarioResults[scenarioId] = aggregateScores(runs);
      console.log(`  ${scenarioId} aggregate: avg=${scenarioResults[scenarioId].averageScore}, pass_rate=${scenarioResults[scenarioId].passRate}`);
    }

    // Compute composite score (simple average of scenario averages)
    const scenarioScores = Object.values(scenarioResults).map((s) => s.averageScore);
    const compositeScore = scenarioScores.length > 0
      ? scenarioScores.reduce((a, b) => a + b, 0) / scenarioScores.length
      : 0;

    const modelResult: ModelResult = {
      model,
      scenarios: scenarioResults,
      compositeScore: Math.round(compositeScore * 10) / 10,
    };
    allModelResults.push(modelResult);
    console.log(`\n  Composite: ${modelResult.compositeScore}`);
  }

  // Generate reports
  const report: BenchmarkReport = {
    benchmarkVersion: "1.0.0",
    timestamp: new Date().toISOString(),
    serverVersion: "unknown",
    models: allModelResults,
  };

  const jsonPath = join(cli.outputDir, "results.json");
  const mdPath = join(cli.outputDir, "results.md");

  generateJsonReport(report, jsonPath);
  generateMarkdownReport(report, mdPath);

  console.log(`\n${"=".repeat(60)}`);
  console.log("BENCHMARK COMPLETE");
  console.log(`${"=".repeat(60)}`);
  console.log(`Results written to:`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  Markdown: ${mdPath}`);

  // Print leaderboard
  console.log("\nLeaderboard:");
  const sorted = [...allModelResults].sort((a, b) => b.compositeScore - a.compositeScore);
  sorted.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.model.label} — ${m.compositeScore.toFixed(1)}`);
  });
}

main().catch((err) => {
  console.error(`Fatal: ${err.message || err}`);
  process.exit(1);
});
