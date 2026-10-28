import { appendFileSync } from "node:fs";
import { freemem, loadavg } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setInterval } from "node:timers";

// Test-owned Next process diagnostics only. No paths, SQL, tokens, or request data.
const logPath = process.env.REVIEW_ROUTER_E2E_NEXT_PERF_LOG;
if (logPath) {
  const delays = monitorEventLoopDelay({ resolution: 20 });
  delays.enable();
  let previousCpu = process.cpuUsage();
  let previousTime = performance.now();
  const sampler = setInterval(() => {
    const now = performance.now();
    const cpu = process.cpuUsage();
    const elapsedMs = Math.max(1, now - previousTime);
    const cpuMs =
      (cpu.user - previousCpu.user + cpu.system - previousCpu.system) / 1000;
    const sample = {
      at: new Date().toISOString(),
      pid: process.pid,
      cpuPct: Math.round((cpuMs / elapsedMs) * 1000) / 10,
      rssMiB: Math.round(process.memoryUsage().rss / 1048576),
      freeMiB: Math.round(freemem() / 1048576),
      load1: Math.round(loadavg()[0] * 100) / 100,
      loopP99Ms: Math.round(delays.percentile(99) / 100000) / 10,
      loopMaxMs: Math.round(delays.max / 100000) / 10,
    };
    try {
      appendFileSync(logPath, JSON.stringify(sample) + "\n", {
        encoding: "utf8",
        flag: "a",
        mode: 0o600,
      });
    } catch {
      // Diagnostics must never influence the application or E2E outcome.
    }
    delays.reset();
    previousCpu = cpu;
    previousTime = now;
  }, 2000);
  sampler.unref();
}
