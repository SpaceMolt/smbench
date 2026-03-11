// Scoring engine for benchmark runs.

import type { BenchmarkEvent } from "./process.js";

export interface RunScore {
  score: number; // 0-100
  metrics: Record<string, number>;
  pass: boolean;
}

export interface AggregateScore {
  averageScore: number;
  stdDev: number;
  passRate: number;
  runs: RunScore[];
}

export function scoreRun(
  scenarioId: string,
  events: BenchmarkEvent[],
  playerStats: Record<string, unknown>,
): RunScore {
  const toolCalls = events.filter((e) => e.event === "tool_call");
  const toolErrors = events.filter((e) => e.event === "tool_error");
  const totalTools = toolCalls.length + toolErrors.length;
  const toolAccuracy = totalTools > 0 ? toolCalls.length / totalTools : 0;

  const stats = (playerStats.stats || {}) as Record<string, unknown>;
  const creditsEarned = Number(stats.credits_earned || 0);
  const credits = Number(playerStats.credits || 0);
  const systemsExplored = Number(stats.systems_explored || 0);
  const piratesDestroyed = Number(stats.pirates_destroyed || 0);

  const lastTurnEnd = events.filter((e) => e.event === "turn_end").pop();
  const totalTokensIn = Number(lastTurnEnd?.total_tokens_in || 0);
  const totalTokensOut = Number(lastTurnEnd?.total_tokens_out || 0);

  let score = 0;
  const metrics: Record<string, number> = {
    tool_accuracy: toolAccuracy,
    tool_calls: totalTools,
    tool_errors: toolErrors.length,
    tokens_in: totalTokensIn,
    tokens_out: totalTokensOut,
  };

  switch (scenarioId) {
    case "s1-bootstrap-grind": {
      // Score based on credits earned and efficiency
      const creditScore = Math.min(creditsEarned / 5000, 1) * 40;
      const efficiencyScore = toolAccuracy * 20;
      const activityScore = Math.min(totalTools / 30, 1) * 20;
      const earnRatio = totalTools > 0 ? creditsEarned / totalTools : 0;
      const ratioScore = Math.min(earnRatio / 30, 1) * 20;
      score = creditScore + efficiencyScore + activityScore + ratioScore;
      metrics.credits_earned = creditsEarned;
      metrics.credits_per_tool = earnRatio;
      break;
    }
    case "s2-navigation": {
      const explorationScore = Math.min(systemsExplored / 10, 1) * 50;
      const efficiencyScore = toolAccuracy * 25;
      const activityScore = Math.min(totalTools / 20, 1) * 25;
      score = explorationScore + efficiencyScore + activityScore;
      metrics.systems_explored = systemsExplored;
      break;
    }
    case "s3-trading": {
      const creditScore = Math.min(credits / 15000, 1) * 40;
      const earnedScore = Math.min(creditsEarned / 20000, 1) * 30;
      const efficiencyScore = toolAccuracy * 15;
      const activityScore = Math.min(totalTools / 40, 1) * 15;
      score = creditScore + earnedScore + efficiencyScore + activityScore;
      metrics.final_credits = credits;
      metrics.credits_earned = creditsEarned;
      break;
    }
    case "s5-combat": {
      const pirateScore = Math.min(piratesDestroyed / 3, 1) * 50;
      const efficiencyScore = toolAccuracy * 25;
      const activityScore = Math.min(totalTools / 30, 1) * 25;
      score = pirateScore + efficiencyScore + activityScore;
      metrics.pirates_destroyed = piratesDestroyed;
      break;
    }
    default: {
      // Generic scoring: tool accuracy + activity
      const efficiencyScore = toolAccuracy * 50;
      const activityScore = Math.min(totalTools / 30, 1) * 50;
      score = efficiencyScore + activityScore;
    }
  }

  return {
    score: Math.round(score * 10) / 10,
    metrics,
    pass: score >= 20,
  };
}

export function aggregateScores(runs: RunScore[]): AggregateScore {
  if (runs.length === 0) {
    return { averageScore: 0, stdDev: 0, passRate: 0, runs: [] };
  }

  const scores = runs.map((r) => r.score);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + (s - avg) ** 2, 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  const passRate = runs.filter((r) => r.pass).length / runs.length;

  return {
    averageScore: Math.round(avg * 10) / 10,
    stdDev: Math.round(stdDev * 10) / 10,
    passRate: Math.round(passRate * 100) / 100,
    runs,
  };
}
