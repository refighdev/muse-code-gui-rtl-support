import type { FileContent, FileEntry, FileKind, FileListing } from "@musegui/ui";

/** One file in the demo's pretend projects: text lives here, media points at a real asset under /public. */
interface DemoFile {
  content?: string;
  url?: string;
  kind?: FileKind;
  mediaType?: string;
  size?: number;
}

const README_DEMO: Record<string, DemoFile> = {
  "README.md":
    { content: "# readme-demo\n\nA tiny Python greeter: `greet(name)` returns `Hello, {name}!`.\n\n## Usage\n\n```python\nfrom greeter import greet\n\nprint(greet(\"Ada\"))\n```\n\nRun the tests with `pytest`. The code lives in [greeter.py](greeter.py), and there is a screenshot in [docs/](docs/notes.md).\n\n![Muse Code GUI on this project](docs/screenshot.png)\n" },
  "greeter.py": { content: 'def greet(name: str) -> str:\n    return f"Hello, {name}!"\n\n\nif __name__ == "__main__":\n    print(greet("world"))\n' },
  "test_greeter.py": { content: 'from greeter import greet\n\n\ndef test_greet():\n    assert greet("Ada") == "Hello, Ada!"\n' },
  ".gitignore": { content: "__pycache__/\n.pytest_cache/\n.venv/\n" },
  "docs/notes.md": {
    content:
      "# Notes\n\n- Keep `greet` pure so it stays easy to test.\n- [ ] Add a `--name` flag to the CLI.\n- [x] One-line description in the README.\n\n| Command | What it does |\n| --- | --- |\n| `pytest` | Runs the tests |\n| `python greeter.py` | Prints a greeting |\n",
  },
  "docs/screenshot.png": { url: "/apple-touch-icon.png", kind: "image", mediaType: "image/png", size: 412_000 },
  "docs/walkthrough.mp4": { url: "/demo/a1.mp4", kind: "video", mediaType: "video/mp4", size: 2_400_000 },
};

const API_SERVER: Record<string, DemoFile> = {
  "package.json": { content: '{\n  "name": "api-server",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "dev": "tsx watch src/index.ts",\n    "test": "vitest"\n  }\n}\n' },
  "README.md": { content: "# api-server\n\nThe projects API. Start it with `npm run dev`; routes live in [src/routes](src/routes/projects.ts).\n" },
  "src/index.ts": {
    content:
      'import express from "express";\nimport { listProjects } from "./routes/projects.js";\n\nconst app = express();\napp.get("/projects", listProjects);\n\napp.listen(3000, () => {\n  console.log("Listening on http://localhost:3000");\n});\n',
  },
  "src/routes/projects.ts": {
    content:
      'export async function listProjects(req, res) {\n  const page = Math.max(1, Number(req.query.page) || 1);\n  const rows = await db.project.findMany({ skip: (page - 1) * 50, take: 50 });\n  res.json({ page, rows });\n}\n',
  },
};

const MUSEGUI: Record<string, DemoFile> = {
  "README.md": { content: "# Muse Code GUI\n\nA desktop and web app for Muse Code: every thread, approval and diff in one window.\n\nSee [the changelog](docs/CHANGELOG.md).\n" },
  "docs/CHANGELOG.md": { content: "# Changelog\n\n## 0.12.0\n\n- A file viewer beside the thread, with Markdown preview and editing.\n" },
  "packages/ui/src/model/files.ts": { content: "/** Where a link in a reply points, relative to the project. */\nexport interface FileTarget {\n  path: string;\n  line: { start: number; end: number } | null;\n}\n" },
};

const TREES: Record<string, Record<string, DemoFile>> = {
  "/Users/you/code/readme-demo": README_DEMO,
  "/Users/you/code/api-server": API_SERVER,
  "/Users/you/code/musegui": MUSEGUI,
};

/** Edits made in the demo last for the page's life, so a saved README reads back as saved. */
export class DemoFiles {
  private trees = new Map<string, Map<string, DemoFile & { mtimeMs: number }>>();

  constructor(private readonly now: number) {}

  private tree(cwd: string) {
    let tree = this.trees.get(cwd);
    if (!tree) {
      tree = new Map(Object.entries(TREES[cwd] ?? { "README.md": { content: "# Project\n" } }).map(([path, file]) => [path, { ...file, mtimeMs: this.now - 3_600_000 }]));
      this.trees.set(cwd, tree);
    }
    return tree;
  }

  private file(cwd: string, path: string) {
    const file = this.tree(cwd).get(path);
    if (!file) throw Object.assign(new Error(`${path} does not exist.`), { status: 404 });
    return file;
  }

  list(cwd: string, dir: string): FileListing {
    const prefix = dir ? `${dir}/` : "";
    const entries = new Map<string, FileEntry>();
    for (const [path, file] of this.tree(cwd)) {
      if (!path.startsWith(prefix)) continue;
      const [head, ...rest] = path.slice(prefix.length).split("/");
      const child = `${prefix}${head}`;
      if (rest.length > 0) entries.set(child, { name: head!, path: child, kind: "dir", size: 0, mtimeMs: file.mtimeMs });
      else entries.set(child, { name: head!, path: child, kind: "file", size: sizeOf(file), mtimeMs: file.mtimeMs });
    }
    const sorted = [...entries.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
    return { path: dir, entries: sorted, truncated: false };
  }

  read(cwd: string, path: string): FileContent {
    const file = this.file(cwd, path);
    const name = path.split("/").pop()!;
    const kind: FileKind = file.kind ?? (/\.(md|markdown|mdx)$/i.test(name) ? "markdown" : "text");
    return {
      path,
      name,
      size: sizeOf(file),
      mtimeMs: file.mtimeMs,
      kind,
      mediaType: file.mediaType ?? "text/plain",
      ...(file.content !== undefined ? { content: file.content } : {}),
      truncated: false,
    };
  }

  write(cwd: string, path: string, content: string) {
    const file = this.file(cwd, path);
    file.content = content;
    delete file.size;
    file.mtimeMs = Date.now();
    return { path, mtimeMs: file.mtimeMs, size: sizeOf(file) };
  }

  search(cwd: string, query: string): FileEntry[] {
    const needle = query.toLowerCase();
    return [...this.tree(cwd)]
      .filter(([path]) => path.toLowerCase().includes(needle))
      .map(([path, file]) => ({ name: path.split("/").pop()!, path, kind: "file" as const, size: sizeOf(file), mtimeMs: file.mtimeMs }));
  }

  url(cwd: string, path: string) {
    return this.tree(cwd).get(path)?.url ?? "";
  }
}

function sizeOf(file: DemoFile) {
  return file.size ?? new TextEncoder().encode(file.content ?? "").length;
}
