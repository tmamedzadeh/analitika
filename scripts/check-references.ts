/** Read-only repository link/import checks. Never reads the archived seed payload. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import ts from "typescript";

const root = process.cwd();
const files = [
  ...new Set(
    execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      encoding: "utf8",
    })
      .trim()
      .split(/\r?\n/u),
  ),
].filter((file) => existsSync(resolve(root, file)));
const failures: string[] = [];
let links = 0;
let imports = 0;

for (const file of files) {
  if (extname(file) === ".md") {
    const markdown = readFileSync(file, "utf8").replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gmu, "");
    const targets = [...markdown.matchAll(/!?\[[^\]\n]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/gu)].map(
      (match) => match[1]!,
    );
    targets.push(
      ...[...markdown.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gmu)].map((match) => match[1]!),
    );
    for (const target of targets) {
      if (/^(?:[a-z][\w+.-]*:|#|\/)/iu.test(target)) continue;
      links += 1;
      const path = decodeURIComponent(target.replace(/[?#].*$/u, ""));
      if (!existsSync(resolve(dirname(file), path)))
        failures.push(`${file}: missing Markdown target ${target}`);
    }
  }
  if (/\.(?:tsx?|[cm]?js)$/u.test(file)) {
    for (const { fileName } of ts.preProcessFile(readFileSync(file, "utf8"), true, true)
      .importedFiles) {
      if (!fileName.startsWith(".") && !fileName.startsWith("@/")) continue;
      imports += 1;
      const path = fileName.replace(/\?.*$/u, "");
      const target = path.startsWith("@/")
        ? resolve(root, "src", path.slice(2))
        : resolve(dirname(file), path);
      const candidates = [
        target,
        ...[".ts", ".tsx", ".js", "/index.ts", "/index.tsx"].map((extension) => target + extension),
      ];
      if (path.endsWith(".js")) candidates.push(target.slice(0, -3) + ".ts");
      if (!candidates.some(existsSync)) failures.push(`${file}: missing import ${fileName}`);
    }
  }
}

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
for (const [name, command] of Object.entries(pkg.scripts)) {
  for (const [file] of command.matchAll(/\bscripts\/[\w./-]+\.(?:ts|mjs|js)\b/gu)) {
    if (!existsSync(resolve(root, file)))
      failures.push(`package.json (${name}): missing script ${file}`);
  }
}
console.log(
  JSON.stringify(
    { checkedFiles: files.length, relativeMarkdownLinks: links, localImports: imports, failures },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
