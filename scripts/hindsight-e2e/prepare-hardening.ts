import { prepareStrictPreview } from "../../deploy/hindsight/prepare-strict-preview.ts";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const nativeRevision = "a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5";
export const nativeLockSha256 =
  "bbd9c8232906ea947c8fdc4096f75d2e778b921af5bdeac09f553495f81f9666";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hashes: Record<string, string> = {
  "__init__.py":
    "7ca4cf7b62f270489db430764644995fb16ee93b32a1ce25f90fceb85b9bf1ed",
  "config.py":
    "4a3b8ce16b5aeefe9f51bb792d18b5e4c782ab572177a4badbf54d051db0077a",
  "api/http.py":
    "3d9ffb8719ba3a9abdefaaa4531abb6c20d3526c472a06dda113e77d14238548",
  "main.py": "f7fc1c4fdb3ff280f55962cc7577f2905380f6bdedcbd0c0e7dd24da9ac11735",
  "banner.py":
    "37ba5d6e2b50ac63c3089fe6ef3503d3efa2811f8f37ff4e42904275422b84be",
  "worker/main.py":
    "36be7516d87144c976d6707d316043196eccc1dbf0ec007b233a200dbab01319",
  "worker/poller.py":
    "0fc5980b0200c21ec4999b1b800776ef0cac531c8eb4dd76c2e87a1ad79a14dd",
  "worker/exceptions.py":
    "15f54dfbb6774199c94863993104d2cbecc2f98c7fe075948193b7bec61f078d",
  "engine/memory_engine.py":
    "44d4f173e5eaf5644390055c2ed55aa254ecea635d2dec870cf949b38de33a5b",
  "engine/memories/pg/links.py":
    "0d28be8ba2177b79450d25b29ba2751c9ee000c31ddbd482e1b65530f8854f65",
};
const digest = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex");

function replace(
  text: string,
  before: string,
  after: string,
  expected = 1,
): string {
  const count = text.split(before).length - 1;
  if (count !== expected)
    throw new Error(`Pinned hardening anchor mismatch (${count}/${expected})`);
  return text.split(before).join(after);
}

export function harden(path: string, before: string): string {
  switch (path) {
    case "__init__.py":
      return replace(
        before,
        "from typing import TYPE_CHECKING",
        "from .native_privacy import install as _install_native_privacy\n\n_install_native_privacy()\n\nfrom typing import TYPE_CHECKING",
      );
    case "config.py": {
      const start = before.indexOf(
        "    def format(self, record: logging.LogRecord) -> str:",
      );
      const end = before.indexOf("\n\ndef _parse_str_list", start);
      if (start < 0 || end < 0)
        throw new Error("Pinned JSON formatter not found");
      return (
        before.slice(0, start) +
        '    def format(self, record: logging.LogRecord) -> str:\n        return json.dumps({\n            "severity": self.SEVERITY_MAP.get(record.levelno, "DEFAULT"),\n            "event": record.getMessage(),\n            "timestamp": datetime.now(timezone.utc).isoformat(),\n            "logger": record.name,\n        })\n' +
        before.slice(end)
      );
    }
    case "api/http.py":
      return replace(
        before,
        "    return app\n",
        "    from hindsight_api.native_privacy import install_http\n\n    install_http(app)\n    return app\n",
      );
    case "main.py":
      return replace(
        before,
        'print(f"\\nError stopping pg0: {e}")',
        'print(f"\\nError stopping pg0: {type(e).__name__}")',
      );
    case "banner.py":
      return replace(
        before,
        "print(f\"  {dim('Database:')} {color(mask_network_location(database_url), 0.4)}\")",
        'print("  Database: configured")',
      );
    case "worker/main.py":
      return replace(
        replace(
          before,
          'print(f"Database connected: {config.database_url}")',
          'print("Database connected")',
        ),
        'print(f"\\nError stopping pg0: {e}")',
        'print(f"\\nError stopping pg0: {type(e).__name__}")',
      );
    case "worker/exceptions.py":
      return replace(
        before,
        '    message = str(e)\n    return f"{type(e).__name__}: {message}" if message else type(e).__name__',
        "    return type(e).__name__",
      );
    case "worker/poller.py":
      return replace(
        before,
        "error_message = error_message[:5000] if len(error_message) > 5000 else error_message",
        'error_message = "native_task_failed"',
        2,
      );
    case "engine/memory_engine.py":
      return replace(
        replace(
          before,
          '            full_error = f"{error_message}\\n\\nTraceback:\\n{error_traceback}"\n            truncated_error = full_error[:5000] if len(full_error) > 5000 else full_error',
          '            truncated_error = "native_task_failed"',
        ),
        'return {"status": "unhealthy", "database": "error", "error": repr(e)}',
        'return {"status": "unhealthy", "database": "error", "error": type(e).__name__}',
      );
    case "engine/memories/pg/links.py":
      return replace(
        before,
        "traceback.print_exc()",
        'logging.getLogger(__name__).error("native_link_failed", exc_info=True)',
        3,
      );
    default:
      throw new Error("Unexpected upstream file");
  }
}

export async function prepare(source: string, context?: string) {
  const revision = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  if (revision.status !== 0 || revision.stdout.trim() !== nativeRevision)
    throw new Error("Unreviewed native source revision");
  const files: Record<string, { before: string; after: string }> = {};
  for (const [path, expected] of Object.entries(hashes)) {
    const before = await readFile(
      join(source, "hindsight-api-slim/hindsight_api", path),
      "utf8",
    );
    if (digest(before) !== expected)
      throw new Error(`Modified upstream input: ${path}`);
    files[path] = { before, after: harden(path, before) };
  }
  files["native_privacy.py"] = {
    before: "",
    after: await readFile(
      join(root, "deploy/hindsight/native-privacy.py"),
      "utf8",
    ),
  };
  await prepareStrictPreview(source, root, files);
  const actualLock = digest(await readFile(join(source, "uv.lock")));
  if (actualLock !== nativeLockSha256)
    throw new Error("Modified upstream dependency lock");
  const manifest = {
    profile: "approved-source-v1",
    nativeRevision,
    nativeLockSha256,
    files: Object.entries(files).map(([path, contents]) => ({
      path,
      beforeSha256: contents.before ? digest(contents.before) : null,
      afterSha256: digest(contents.after),
    })),
  };
  if (context) {
    for (const [path, contents] of Object.entries(files)) {
      const destination = join(context, "hindsight_api", path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, contents.after);
    }
    await writeFile(
      join(context, "hardening-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
  }
  return { files, manifest };
}

function exactDiff(
  path: string,
  contents: { before: string; after: string },
): string {
  const prefix = `hindsight-api-slim/hindsight_api/${path}`;
  const a = contents.before.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const b = contents.after.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const edits: {
    kind: " " | "+" | "-";
    text: string;
    oldLine: number;
    newLine: number;
  }[] = [];
  let i = 0;
  let j = 0;
  const emit = (kind: " " | "+" | "-") => {
    edits.push({
      kind,
      text: (kind === "+" ? b[j] : a[i])!,
      oldLine: i + 1,
      newLine: j + 1,
    });
    if (kind !== "+") i++;
    if (kind !== "-") j++;
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      emit(" ");
      continue;
    }
    let found: [number, number] | undefined;
    // Changes are bounded exact-anchor replacements. Three matching lines give
    // stable hunk boundaries without a dependency or copied source on disk.
    for (let distance = 1; distance <= 128 && !found; distance++) {
      for (let skipA = 0; skipA <= distance; skipA++) {
        const skipB = distance - skipA;
        if (
          i + skipA + 2 < a.length &&
          j + skipB + 2 < b.length &&
          [0, 1, 2].every(
            (offset) => a[i + skipA + offset] === b[j + skipB + offset],
          )
        ) {
          found = [skipA, skipB];
          break;
        }
      }
    }
    const targetA = found ? i + found[0] : a.length;
    const targetB = found ? j + found[1] : b.length;
    while (i < targetA) emit("-");
    while (j < targetB) emit("+");
  }
  let patch = `--- ${contents.before ? `a/${prefix}` : "/dev/null"}\n+++ b/${prefix}\n`;
  const changed = edits.flatMap((edit, index) =>
    edit.kind === " " ? [] : [index],
  );
  const ranges: [number, number][] = [];
  for (const index of changed) {
    const start = Math.max(0, index - 3);
    const end = Math.min(edits.length, index + 4);
    const prior = ranges.at(-1);
    if (prior && start <= prior[1]) prior[1] = Math.max(prior[1], end);
    else ranges.push([start, end]);
  }
  for (const [start, end] of ranges) {
    const hunk = edits.slice(start, end);
    const first = hunk[0]!;
    patch += `@@ -${a.length ? first.oldLine : 0},${hunk.filter((edit) => edit.kind !== "+").length} +${first.newLine},${hunk.filter((edit) => edit.kind !== "-").length} @@\n`;
    patch += hunk.map((edit) => edit.kind + edit.text).join("");
  }
  return patch;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const source = process.argv[2];
  if (!source)
    throw new Error(
      "Usage: node prepare-hardening.ts UPSTREAM_CHECKOUT [BUILD_CONTEXT] [--write-patch]",
    );
  const context = process.argv[3]?.startsWith("--")
    ? undefined
    : process.argv[3];
  const result = await prepare(resolve(source), context && resolve(context));
  if (process.argv.includes("--write-patch")) {
    let patch = "";
    for (const [path, contents] of Object.entries(result.files)) {
      patch += exactDiff(path, contents);
    }
    await writeFile(join(root, "deploy/hindsight/hardening.patch"), patch);
  }
  process.stdout.write(JSON.stringify(result.manifest, null, 2) + "\n");
}
