// Markdown + JSON report generator for benchmark results.

import { writeFileSync } from "fs";

export interface ModelResult {
  model: { id: string; label: string; category: string };
  scenarios: Record<string, {
    averageScore: number;
    stdDev: number;
    passRate: number;
    runs: Array<{
      score: number;
      metrics: Record<string, number>;
      pass: boolean;
    }>;
  }>;
  compositeScore: number;
}

export interface BenchmarkReport {
  benchmarkVersion: string;
  timestamp: string;
  serverVersion: string;
  models: ModelResult[];
}

export function generateJsonReport(report: BenchmarkReport, outputPath: string): void {
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
}

export function generateMarkdownReport(report: BenchmarkReport, outputPath: string): void {
  const lines: string[] = [];
  lines.push("# SpaceMolt Benchmark Results");
  lines.push("");
  lines.push(`**Date:** ${report.timestamp}`);
  lines.push(`**Server Version:** ${report.serverVersion}`);
  lines.push(`**Benchmark Version:** ${report.benchmarkVersion}`);
  lines.push("");

  // Leaderboard table
  lines.push("## Leaderboard");
  lines.push("");
  lines.push("| Rank | Model | Category | Composite Score |");
  lines.push("|------|-------|----------|----------------|");

  const sorted = [...report.models].sort((a, b) => b.compositeScore - a.compositeScore);
  sorted.forEach((m, i) => {
    lines.push(`| ${i + 1} | ${m.model.label} | ${m.model.category} | ${m.compositeScore.toFixed(1)} |`);
  });
  lines.push("");

  // Per-scenario breakdown
  lines.push("## Scenario Breakdown");
  lines.push("");

  const allScenarios = new Set<string>();
  for (const m of report.models) {
    for (const s of Object.keys(m.scenarios)) {
      allScenarios.add(s);
    }
  }

  for (const scenario of allScenarios) {
    lines.push(`### ${scenario}`);
    lines.push("");
    lines.push("| Model | Avg Score | Std Dev | Pass Rate |");
    lines.push("|-------|-----------|---------|-----------|");

    for (const m of sorted) {
      const s = m.scenarios[scenario];
      if (s) {
        lines.push(`| ${m.model.label} | ${s.averageScore.toFixed(1)} | ${s.stdDev.toFixed(1)} | ${(s.passRate * 100).toFixed(0)}% |`);
      }
    }
    lines.push("");
  }

  writeFileSync(outputPath, lines.join("\n"));
}
