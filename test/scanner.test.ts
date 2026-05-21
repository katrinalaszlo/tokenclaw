import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "node:url";
import {
  isAuxiliaryFile,
  findJsonlFiles,
  parseJsonlFile,
} from "../src/scanners/local.js";

const fixturesDir = fileURLToPath(new URL("./fixtures/", import.meta.url));

// ── isAuxiliaryFile — checkpoint regression ──

describe("isAuxiliaryFile", () => {
  it("checkpoint file → true", () => {
    assert.equal(isAuxiliaryFile("session.checkpoint.123.jsonl"), true);
  });

  it("trajectory file → true", () => {
    assert.equal(isAuxiliaryFile("session.trajectory.jsonl"), true);
  });

  it("regular session file → false", () => {
    assert.equal(isAuxiliaryFile("session.jsonl"), false);
  });

  it("numbered checkpoint → true", () => {
    assert.equal(isAuxiliaryFile("abc.checkpoint.456789.jsonl"), true);
  });

  it("file with checkpoint in name but different pattern → true", () => {
    // isAuxiliaryFile uses .includes(), so any file containing ".checkpoint." matches
    assert.equal(isAuxiliaryFile("foo.checkpoint.bar.jsonl"), true);
  });

  it("file without .jsonl extension but has checkpoint → true", () => {
    assert.equal(isAuxiliaryFile("session.checkpoint.1.txt"), true);
  });
});

// ── findJsonlFiles — filters auxiliary files ──

describe("findJsonlFiles", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tokenclaw-test-"));
    writeFileSync(join(tmpDir, "session.jsonl"), "{}");
    writeFileSync(join(tmpDir, "session.checkpoint.123.jsonl"), "{}");
    writeFileSync(join(tmpDir, "session.trajectory.jsonl"), "{}");
    writeFileSync(join(tmpDir, "other.jsonl"), "{}");
    writeFileSync(join(tmpDir, "readme.txt"), "not jsonl");
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns only non-auxiliary .jsonl files (recursive)", async () => {
    const files = await findJsonlFiles(tmpDir, true);
    const names = files.map((f) => f.split("/").pop());
    assert.ok(names.includes("session.jsonl"));
    assert.ok(names.includes("other.jsonl"));
    assert.ok(!names.includes("session.checkpoint.123.jsonl"));
    assert.ok(!names.includes("session.trajectory.jsonl"));
    assert.ok(!names.includes("readme.txt"));
    assert.equal(names.length, 2);
  });

  it("returns empty for nonexistent directory", async () => {
    const files = await findJsonlFiles("/tmp/nonexistent-dir-abc123", true);
    assert.equal(files.length, 0);
  });

  it("handles subdirectories in recursive mode", async () => {
    const subDir = join(tmpDir, "subproject");
    mkdirSync(subDir);
    writeFileSync(join(subDir, "deep.jsonl"), "{}");
    writeFileSync(join(subDir, "deep.checkpoint.1.jsonl"), "{}");

    const files = await findJsonlFiles(tmpDir, true);
    const names = files.map((f) => f.split("/").pop());
    assert.ok(names.includes("deep.jsonl"));
    assert.ok(!names.includes("deep.checkpoint.1.jsonl"));
  });

  it("non-recursive mode reads one level of subdirs (Claude Code style)", async () => {
    // findJsonlFiles non-recursive: looks inside immediate child directories
    const projDir = join(tmpDir, "my-project");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "session.jsonl"), "{}");
    writeFileSync(join(projDir, "session.checkpoint.5.jsonl"), "{}");

    const files = await findJsonlFiles(tmpDir, false);
    const names = files.map((f) => f.split("/").pop());
    assert.ok(names.includes("session.jsonl"));
    assert.ok(!names.includes("session.checkpoint.5.jsonl"));
  });
});

// ── parseJsonlFile — corrupt JSONL handling ──

describe("parseJsonlFile corrupt data", () => {
  it("skips invalid lines and parses valid ones", async () => {
    const fixturePath = join(fixturesDir, "corrupt-session.jsonl");
    const result = await parseJsonlFile(fixturePath);
    // msg_010 (1000 in, 500 out) + msg_012 (500 in, 100 out) — msg_011 truncated, line 3 garbage
    assert.equal(result.inputTokens, 1500);
    assert.equal(result.outputTokens, 600);
    assert.ok(result.costUSD > 0, "cost should be positive");
    // Two valid messages parsed
    assert.equal(Object.keys(result.modelUsage).length, 1); // both are claude-sonnet-4-6
    assert.equal(result.modelUsage["claude-sonnet-4-6"]!.inputTokens, 1500);
  });
});

// ── parseJsonlFile — empty file ──

describe("parseJsonlFile empty file", () => {
  let tmpFile: string;

  before(() => {
    const dir = mkdtempSync(join(tmpdir(), "tokenclaw-empty-"));
    tmpFile = join(dir, "empty.jsonl");
    writeFileSync(tmpFile, "");
  });

  it("returns zeros for empty file", async () => {
    const result = await parseJsonlFile(tmpFile);
    assert.equal(result.inputTokens, 0);
    assert.equal(result.outputTokens, 0);
    assert.equal(result.cacheReadTokens, 0);
    assert.equal(result.cacheCreationTokens, 0);
    assert.equal(result.costUSD, 0);
    assert.deepEqual(result.modelUsage, {});
    assert.deepEqual(result.dateCosts, {});
  });
});

// ── parseJsonlFile — nonexistent file ──

describe("parseJsonlFile nonexistent file", () => {
  it("returns zeros for missing file", async () => {
    const result = await parseJsonlFile("/tmp/does-not-exist-at-all.jsonl");
    assert.equal(result.costUSD, 0);
    assert.equal(result.inputTokens, 0);
  });
});

// ── parseJsonlFile — valid fixture with known values ──

describe("parseJsonlFile valid fixture", () => {
  it("parses all entries with correct totals", async () => {
    const fixturePath = join(fixturesDir, "valid-session.jsonl");
    const result = await parseJsonlFile(fixturePath);

    // msg_001: 1000 in, 500 out, 200 cacheRead, 100 cacheWrite
    // msg_002: 2000 in, 800 out, 500 cacheRead, 0 cacheWrite
    // msg_003: 500 in, 300 out, 0 cacheRead, 0 cacheWrite
    assert.equal(result.inputTokens, 3500);
    assert.equal(result.outputTokens, 1600);
    assert.equal(result.cacheReadTokens, 700);
    assert.equal(result.cacheCreationTokens, 100);

    // Two models used
    assert.ok(result.modelUsage["claude-sonnet-4-6"]);
    assert.ok(result.modelUsage["gpt-4o"]);

    // Sonnet tokens: 3000 in, 1300 out
    assert.equal(result.modelUsage["claude-sonnet-4-6"]!.inputTokens, 3000);
    assert.equal(result.modelUsage["claude-sonnet-4-6"]!.outputTokens, 1300);

    // GPT-4o tokens: 500 in, 300 out
    assert.equal(result.modelUsage["gpt-4o"]!.inputTokens, 500);
    assert.equal(result.modelUsage["gpt-4o"]!.outputTokens, 300);
  });

  it("cost is positive and reasonable", async () => {
    const fixturePath = join(fixturesDir, "valid-session.jsonl");
    const result = await parseJsonlFile(fixturePath);
    // Hand-calculated:
    // msg_001 sonnet: (1000*3 + 500*15 + 200*0.3 + 100*3.75) / 1e6 = 0.010935
    // msg_002 sonnet: (2000*3 + 800*15 + 500*0.3 + 0) / 1e6 = 0.01815
    // msg_003 gpt-4o: (500*2.5 + 300*10 + 0 + 0) / 1e6 = 0.00425
    const expected = 0.010935 + 0.01815 + 0.00425;
    assert.ok(
      Math.abs(result.costUSD - expected) < 1e-9,
      `got ${result.costUSD}, expected ${expected}`,
    );
  });
});

// ── Date bucketing ──

describe("parseJsonlFile date bucketing", () => {
  it("groups costs by date from timestamps", async () => {
    const fixturePath = join(fixturesDir, "valid-session.jsonl");
    const result = await parseJsonlFile(fixturePath);

    // Three entries on three different dates
    const dates = Object.keys(result.dateCosts).sort();
    assert.equal(dates.length, 3);
    assert.deepEqual(dates, ["2026-05-20", "2026-05-21", "2026-05-22"]);

    // Each date has positive cost
    for (const date of dates) {
      assert.ok(result.dateCosts[date]! > 0, `${date} should have cost > 0`);
    }

    // Verify specific date costs
    // 2026-05-20: msg_001 sonnet = 0.010935
    assert.ok(Math.abs(result.dateCosts["2026-05-20"]! - 0.010935) < 1e-9);
    // 2026-05-21: msg_002 sonnet = 0.01815
    assert.ok(Math.abs(result.dateCosts["2026-05-21"]! - 0.01815) < 1e-9);
    // 2026-05-22: msg_003 gpt-4o = 0.00425
    assert.ok(Math.abs(result.dateCosts["2026-05-22"]! - 0.00425) < 1e-9);
  });
});

// ── Deduplication by message ID ──

describe("parseJsonlFile message deduplication", () => {
  let tmpFile: string;

  before(() => {
    const dir = mkdtempSync(join(tmpdir(), "tokenclaw-dedup-"));
    tmpFile = join(dir, "dedup.jsonl");
    // Two entries with the same message ID — last one wins
    const lines = [
      JSON.stringify({
        timestamp: "2026-05-20T10:00:00Z",
        message: {
          id: "msg_same",
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-20T10:01:00Z",
        message: {
          id: "msg_same",
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: 200,
            output_tokens: 80,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
    ];
    writeFileSync(tmpFile, lines.join("\n") + "\n");
  });

  it("keeps last usage entry per message ID (no double-counting)", async () => {
    const result = await parseJsonlFile(tmpFile);
    // Last entry wins: 200 input, 80 output (not 100+200=300)
    assert.equal(result.inputTokens, 200);
    assert.equal(result.outputTokens, 80);
  });
});

// ── parseJsonlFile — timestamp extraction ──

describe("parseJsonlFile timestamps", () => {
  it("returns firstTimestamp and lastTimestamp from valid fixture", async () => {
    const fixturePath = join(fixturesDir, "valid-session.jsonl");
    const result = await parseJsonlFile(fixturePath);
    assert.equal(result.firstTimestamp, "2026-05-20T10:00:00Z");
    assert.equal(result.lastTimestamp, "2026-05-22T09:15:00Z");
  });

  it("returns undefined timestamps for empty file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenclaw-ts-"));
    const emptyFile = join(dir, "empty.jsonl");
    writeFileSync(emptyFile, "");
    const result = await parseJsonlFile(emptyFile);
    assert.equal(result.firstTimestamp, undefined);
    assert.equal(result.lastTimestamp, undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns undefined timestamps for nonexistent file", async () => {
    const result = await parseJsonlFile("/tmp/no-such-file-timestamps.jsonl");
    assert.equal(result.firstTimestamp, undefined);
    assert.equal(result.lastTimestamp, undefined);
  });

  it("handles single-entry file (first === last)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenclaw-single-"));
    const singleFile = join(dir, "single.jsonl");
    writeFileSync(
      singleFile,
      JSON.stringify({
        timestamp: "2026-05-22T12:00:00Z",
        message: {
          id: "msg_only",
          model: "claude-sonnet-4-6",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }) + "\n",
    );
    const result = await parseJsonlFile(singleFile);
    assert.equal(result.firstTimestamp, "2026-05-22T12:00:00Z");
    assert.equal(result.lastTimestamp, "2026-05-22T12:00:00Z");
    rmSync(dir, { recursive: true, force: true });
  });
});
