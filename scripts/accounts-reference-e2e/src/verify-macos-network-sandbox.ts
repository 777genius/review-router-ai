import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { promisify } from "node:util";

const execute = promisify(execFile);
const profilePath = process.env.SKILLS_PRISMA_SANDBOX_PATH;
assert.equal(process.platform, "darwin");
assert.ok(profilePath, "SKILLS_PRISMA_SANDBOX_PATH is required");
await writeFile(
  profilePath,
  "(version 1)\n(allow default)\n(deny network*)\n",
  {
    flag: "wx",
    mode: 0o600,
  },
);

const clientScript = String.raw`
const { connect } = require('node:net');
const denied = process.argv[2] === 'deny';
let settled = false;
const socket = connect({ host: '127.0.0.1', port: Number(process.argv[1]) });
const deadline = setTimeout(() => complete(false, 'timeout'), 5000);
function complete(success, message) {
  if (settled) return;
  settled = true;
  clearTimeout(deadline);
  socket.destroy();
  process.exitCode = success ? 0 : 1;
  if (success) console.log(message);
  else console.error(message);
}
socket.once('connect', () => complete(!denied, 'allowed'));
socket.once('error', (error) => {
  const blocked = error.code === 'EPERM' || error.code === 'EACCES';
  complete(denied && blocked, blocked ? 'denied' : String(error.code));
});
`;
const descendantScript = `
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, [
  '--input-type=commonjs', '--eval', ${JSON.stringify(clientScript)},
  process.argv[1], 'deny'
], { stdio: 'inherit', timeout: 7000 });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
`;

async function runExecutable(file: string, args: string[]): Promise<string> {
  const result = await execute(file, args, {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  });
  return result.stdout.trim();
}

const server = createServer((socket) => socket.end());
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address === "object");
const port = String(address.port);
try {
  assert.equal(
    await runExecutable(process.execPath, [
      "--input-type=commonjs",
      "--eval",
      clientScript,
      port,
      "allow",
    ]),
    "allowed",
  );
  for (const script of [clientScript, descendantScript]) {
    assert.equal(
      await runExecutable("/usr/bin/sandbox-exec", [
        "-f",
        profilePath,
        process.execPath,
        "--input-type=commonjs",
        "--eval",
        script,
        port,
        "deny",
      ]),
      "denied",
    );
  }
  console.log(
    "Verified macOS network denial for direct and descendant clients.",
  );
} finally {
  const closed = once(server, "close");
  server.close();
  await closed;
}
