import { writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const PLIST_NAME = "com.tokenclaw.watch";
const PLIST_DIR = join(homedir(), "Library", "LaunchAgents");
const PLIST_PATH = join(PLIST_DIR, `${PLIST_NAME}.plist`);
const LOG_PATH = join(homedir(), ".tokenclaw", "watch.log");
const INTERVAL_SECONDS = 3600;

function findBinary(): string {
  try {
    return execSync("which tokenclaw", { encoding: "utf-8" }).trim();
  } catch {
    return "/opt/homebrew/bin/tokenclaw";
  }
}

function generatePlist(binaryPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binaryPath}</string>
    <string>alert</string>
    <string>--check</string>
  </array>
  <key>StartInterval</key>
  <integer>${INTERVAL_SECONDS}</integer>
  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_PATH}</string>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>`;
}

export function isMac(): boolean {
  return process.platform === "darwin";
}

export function isMonitoringInstalled(): boolean {
  return existsSync(PLIST_PATH);
}

export function installMonitoring(): { ok: boolean; message: string } {
  if (!isMac()) {
    return {
      ok: false,
      message:
        "Auto-monitoring requires macOS. On Linux, add to cron: 0 * * * * tokenclaw alert --check",
    };
  }

  const binary = findBinary();
  const plist = generatePlist(binary);

  if (!existsSync(PLIST_DIR)) {
    mkdirSync(PLIST_DIR, { recursive: true });
  }

  const logDir = join(homedir(), ".tokenclaw");
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  if (isMonitoringInstalled()) {
    try {
      execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, {
        stdio: "ignore",
      });
    } catch {}
  }

  writeFileSync(PLIST_PATH, plist);

  try {
    execSync(`launchctl load "${PLIST_PATH}"`);
    return {
      ok: true,
      message:
        "Monitoring installed — checks every hour, even when terminal is closed.",
    };
  } catch (err) {
    return {
      ok: false,
      message: `Plist written but launchctl load failed: ${err}`,
    };
  }
}

export function uninstallMonitoring(): { ok: boolean; message: string } {
  if (!isMonitoringInstalled()) {
    return { ok: true, message: "No monitoring installed." };
  }

  try {
    execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, {
      stdio: "ignore",
    });
  } catch {}

  try {
    unlinkSync(PLIST_PATH);
    return { ok: true, message: "Monitoring removed." };
  } catch (err) {
    return { ok: false, message: `Failed to remove plist: ${err}` };
  }
}
