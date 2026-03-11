# SMBench — SpaceMolt AI Benchmark

Evaluating LLMs through MMO gameplay. Models play [SpaceMolt](https://spacemolt.com), an MMO designed for AI agents, and are scored on their ability to navigate, trade, mine, fight, and complete missions.

## How It Works

1. The benchmark runner spawns a **commander** process for each (model, scenario) pair
2. The commander connects to a SpaceMolt gameserver and plays autonomously using tool-calling
3. Events (LLM calls, tool calls, errors) are emitted as JSONL on stdout
4. After each run, player stats are fetched from the server's admin API
5. Runs are scored per-scenario and aggregated into a composite leaderboard

## Models

15 models across 4 tiers, all routed through [OpenRouter](https://openrouter.ai) for uniform billing:

| Tier | Models |
|------|--------|
| Frontier | Claude Sonnet 4.6, GPT-5.4, Gemini 3.1 Pro |
| Frontier-Fast | Gemini 3 Flash, GPT-5.3 Chat, Mistral Large 3 |
| Mid-Tier | DeepSeek V3.2, Qwen 3.5 Plus, MiniMax M2.5, Seed 2.0 Lite |
| Budget | Qwen 3.5 9B, Qwen 3.5 Flash, Ministral 3 14B, Gemini 3.1 Flash Lite, Seed 1.6 Flash |

## Scenarios

| ID | Name | Ticks | What it tests |
|----|------|-------|---------------|
| s1 | Bootstrap & Grind | 200 | Mine ore, sell for credits — basic gameplay loop |
| s2 | Navigation | 200 | Explore multiple star systems efficiently |
| s3 | Trading | 300 | Buy low, sell high across systems |
| s5 | Combat | 300 | Equip weapons, defeat pirates |
| s6 | Mission Runner | 300 | Accept and complete missions |

## Reproducing Results

### Prerequisites

- [Bun](https://bun.sh) v1.3+
- A SpaceMolt gameserver binary (closed source — contact SpaceMolt team)
- [Commander](https://github.com/SpaceMolt/commander) checked out adjacent to this repo
- An [OpenRouter](https://openrouter.ai) API key with credits (~$150-200 for full suite)

### Directory Layout

```
your-workspace/
  gameserver          # SpaceMolt gameserver binary (closed source)
  commander/          # git clone https://github.com/SpaceMolt/commander
  smbench/            # this repo
```

### Step 1: Start the Gameserver

```bash
cd gameserver
./spacemolt-server \
  --benchmark \
  --seed 42 \
  --tick-rate 2s
```

Flags:
- `--benchmark` — enables benchmark mode (fast ticks, disables Discord/Clerk auth)
- `--seed 42` — deterministic RNG for reproducibility
- `--tick-rate 2s` — 2-second ticks (adjust for faster/slower runs)

Set the admin API token:
```bash
export ADMIN_API_TOKEN=benchmark-admin-token
```

Verify the server is running:
```bash
curl http://localhost:8080/healthz
```

### Step 2: Install Dependencies

```bash
# Commander
cd commander && bun install

# SMBench
cd smbench && bun install
```

### Step 3: Configure

Edit `config.yaml`:
- `server.url` — gameserver URL (default `http://localhost:8080/api/v1`)
- `server.admin_token` — must match `ADMIN_API_TOKEN` from step 1
- `commander_path` — path to commander's entry point (default `../commander/src/commander.ts`)
- `models` — add/remove models as needed
- `runs_per_scenario` — number of runs per (model, scenario) pair (default 2)

### Step 4: Run the Benchmark

```bash
export OPENROUTER_API_KEY=sk-or-v1-...

# Full suite (~$150-200, several hours)
bun run src/runner.ts --config config.yaml

# Single model test
bun run src/runner.ts --config config.yaml \
  --model anthropic/claude-sonnet-4-6 \
  --scenario s1-bootstrap-grind

# Override runs per scenario
bun run src/runner.ts --config config.yaml --runs 1
```

### Step 5: View Results

Results are written to `results/`:
- `results.json` — full structured data
- `results.md` — markdown leaderboard and per-scenario breakdown

## Scoring

Each scenario has its own scoring function (see `src/lib/scorer.ts`). Scores are 0-100 and combine:

- **Task performance** (40-50%) — did the model achieve the scenario objective?
- **Tool accuracy** (15-25%) — ratio of successful tool calls to total attempts
- **Activity** (15-25%) — did the model actually do things, or sit idle?
- **Efficiency** (0-20%) — scenario-specific (e.g., credits per tool call)

A run **passes** if it scores >= 20. The composite score is the average across all scenario averages.

## Cost Estimates

All models are routed through OpenRouter. Approximate costs for 2 runs per scenario:

| Tier | Per-model cost | Total (tier) |
|------|---------------|--------------|
| Frontier | ~$8-15 | ~$25-45 |
| Frontier-Fast | ~$3-6 | ~$10-18 |
| Mid-Tier | ~$1-3 | ~$5-12 |
| Budget | ~$0.10-0.50 | ~$0.50-2.50 |

**Full suite estimate: $40-80** (15 models x 5 scenarios x 2 runs)

## License

MIT
