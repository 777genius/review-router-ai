import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const receipt = JSON.parse(
  readFileSync(new URL("./registry-artifacts.json", import.meta.url), "utf8"),
) as {
  artifacts: {
    name: string;
    version: string;
    integrity: string;
    exports: object;
  }[];
};
mkdirSync(join(root, "tmp"), { recursive: true });
const scratch = mkdtempSync(join(root, "tmp", "provider-packed-"));
const archives: string[] = [];
for (const artifact of receipt.artifacts.filter(({ name }) =>
  name.startsWith("@get-modular/"),
)) {
  const packed = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        `${artifact.name}@${artifact.version}`,
        "--pack-destination",
        scratch,
        "--json",
      ],
      { cwd: root, encoding: "utf8" },
    ),
  ) as { filename: string }[];
  const archive = resolve(scratch, packed[0].filename);
  const integrity = `sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}`;
  if (integrity !== artifact.integrity)
    throw new Error(`Registry integrity mismatch for ${artifact.name}.`);
  archives.push(archive);
}
const consumer = join(scratch, "consumer");
mkdirSync(consumer);
writeFileSync(
  join(consumer, "package.json"),
  JSON.stringify({ private: true, type: "module" }),
);
copyFileSync(
  new URL("./consumer.ts", import.meta.url),
  join(consumer, "consumer.ts"),
);
writeFileSync(
  join(consumer, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      target: "ES2023",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      skipLibCheck: false,
      types: ["node"],
      outDir: "dist",
    },
    include: ["consumer.ts"],
  }),
);
execFileSync(
  "npm",
  [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    ...archives,
    "typescript@6.0.3",
    "@types/node@22.19.17",
  ],
  { cwd: consumer, stdio: "inherit" },
);
execFileSync(
  process.execPath,
  [
    join(consumer, "node_modules/typescript/bin/tsc"),
    "-p",
    join(consumer, "tsconfig.json"),
  ],
  { cwd: consumer, stdio: "inherit" },
);
execFileSync(process.execPath, [join(consumer, "dist/consumer.js")], {
  cwd: consumer,
  stdio: "inherit",
});
console.log(
  `Exact packed consumer qualification passed; retained artifacts: ${scratch}`,
);
