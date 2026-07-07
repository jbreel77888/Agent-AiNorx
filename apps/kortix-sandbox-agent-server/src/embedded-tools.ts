// AUTO-GENERATED: Embedded copies of the OpenCode tool files + package.json.
// These are written to the sandbox workspace in simple mode so the agent
// has working web_search, scrape_webpage, image_search, memory, and show tools.

export const EMBEDDED_TOOL_FILES: Record<string, string> = {
  'tools/web_search.ts': `import { tool } from "@opencode-ai/plugin";
import { getEnv, getVaelorXRouterBase } from "./lib/get-env";
// NOTE: @tavily/core is imported lazily inside execute() — a top-level import
// makes opencode load this heavy SDK at sandbox boot (every tool module is
// evaluated eagerly), which added ~seconds to cold session start. Deferring it
// to first use keeps boot fast and only pays the cost when the tool is run.

interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  publishedDate?: string;
  rawContent?: string;
}

interface SearchImage {
  url: string;
  description?: string;
}

interface SearchResponse {
  query: string;
  answer?: string;
  results: SearchResult[];
  images?: SearchImage[];
  responseTime?: number;
}

function formatSingle(query: string, response: SearchResponse): string {
  return JSON.stringify(
    {
      query,
      success: response.results.length > 0 || !!response.answer,
      answer: response.answer ?? "",
      results: response.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
        score: r.score,
        published_date: r.publishedDate ?? "",
      })),
      images: (response.images ?? []).map((img) => ({
        url: img.url,
        description: img.description ?? "",
      })),
      response_time_ms: response.responseTime,
    },
    null,
    2,
  );
}

export default tool({
  description:
    "Search the web for up-to-date information using Tavily. " +
    "Returns titles, URLs, snippets, relevance scores, images, and a synthesized AI answer. " +
    "Supports batch queries separated by |||. " +
    "Use topic='news' for current events, topic='finance' for financial data. " +
    "After using results, ALWAYS include a Sources section with markdown hyperlinks.",
  args: {
    query: tool.schema
      .string()
      .describe(
        "Search query. For batch, separate with ||| (e.g. 'query one ||| query two')",
      ),
    num_results: tool.schema
      .number()
      .optional()
      .describe("Results per query (1-20). Default: 5"),
    topic: tool.schema
      .string()
      .optional()
      .describe("Search topic: 'general' (default), 'news', or 'finance'"),
    search_depth: tool.schema
      .string()
      .optional()
      .describe(
        "Search depth: 'basic' (faster, cheaper, default) or 'advanced' (slower, more thorough). Use 'basic' for most queries. Reserve 'advanced' for deep research where comprehensiveness matters.",
      ),
  },
  async execute(args, _context) {
    // Route through the VaelorX router (derived from KORTIX_API_URL) and auth with
    // KORTIX_TOKEN; the router injects the real upstream key. Fall back to a raw
    // TAVILY_API_KEY only when KORTIX_API_URL is unset (self-host/direct).
    const apiBaseURL = getVaelorXRouterBase("tavily") ?? undefined;
    const apiKey = apiBaseURL
      ? getEnv("KORTIX_TOKEN")
      : getEnv("TAVILY_API_KEY");
    if (!apiKey) return apiBaseURL
      ? "Error: KORTIX_TOKEN not set."
      : "Error: TAVILY_API_KEY not set.";

    const { tavily } = await import("@tavily/core");
    const client = tavily({ apiKey, ...(apiBaseURL ? { apiBaseURL } : {}) });
    const maxResults = Math.max(1, Math.min(args.num_results ?? 5, 20));
    const topic = (args.topic as "general" | "news" | "finance") ?? "general";

    const queries = args.query
      .split("|||")
      .map((q) => q.trim())
      .filter(Boolean);
    if (queries.length === 0) return "Error: empty query.";

    const searchOne = async (
      q: string,
    ): Promise<{ query: string; data?: SearchResponse; error?: string }> => {
      try {
        const response = (await client.search(q, {
          searchDepth: (args.search_depth as "basic" | "advanced") || "basic",
          topic,
          maxResults,
          includeAnswer: true,
          includeImages: true,
          includeImageDescriptions: true,
        })) as unknown as SearchResponse;
        return { query: q, data: response };
      } catch (e) {
        return { query: q, error: String(e) };
      }
    };

    const results = await Promise.all(queries.map(searchOne));

    if (queries.length === 1) {
      const r = results[0]!;
      if (r.error)
        return JSON.stringify(
          { query: r.query, success: false, error: r.error },
          null,
          2,
        );
      return formatSingle(r.query, r.data!);
    }

    return JSON.stringify(
      {
        batch_mode: true,
        total_queries: queries.length,
        results: results.map((r) => {
          if (r.error)
            return { query: r.query, success: false, error: r.error };
          const d = r.data!;
          return {
            query: r.query,
            success: d.results.length > 0 || !!d.answer,
            answer: d.answer ?? "",
            results: d.results.map((res) => ({
              title: res.title,
              url: res.url,
              snippet: res.content,
              score: res.score,
              published_date: res.publishedDate ?? "",
            })),
            images: (d.images ?? []).map((img) => ({
              url: img.url,
              description: img.description ?? "",
            })),
          };
        }),
      },
      null,
      2,
    );
  },
});
`,
  'tools/scrape_webpage.ts': `import { tool } from "@opencode-ai/plugin";
// Type-only import (erased at runtime). The actual SDK is imported lazily inside
// execute() — a top-level value import makes opencode load this heavy SDK at
// sandbox boot (tool modules are evaluated eagerly), adding ~seconds to cold
// start. Deferred to first use.
import type FirecrawlApp from "@mendable/firecrawl-js";
import { getEnv, getVaelorXRouterBase } from "./lib/get-env";

interface ScrapeResult {
  url: string;
  success: boolean;
  title?: string;
  content?: string;
  content_length?: number;
  html?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

async function scrapeOne(
  client: FirecrawlApp,
  url: string,
  includeHtml: boolean,
  retries = 3,
): Promise<ScrapeResult> {
  const formats: ("markdown" | "html")[] = includeHtml
    ? ["markdown", "html"]
    : ["markdown"];

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = (await client.scrape(url, {
        formats,
        timeout: 30000,
      })) as Record<string, unknown>;

      const metadata = (response.metadata ?? {}) as Record<string, string>;
      const markdown = (response.markdown ?? "") as string;
      const html = (response.html ?? "") as string;

      const result: ScrapeResult = {
        url,
        success: true,
        title: metadata.title ?? "",
        content: markdown,
        content_length: markdown.length,
      };

      if (includeHtml && html) result.html = html;
      if (Object.keys(metadata).length > 0) result.metadata = metadata;
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isTimeout = msg.includes("timeout") || msg.includes("Timeout");

      if (isTimeout && attempt < retries) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
        continue;
      }
      return { url, success: false, error: msg };
    }
  }
  return { url, success: false, error: "max retries exceeded" };
}

export default tool({
  description:
    "Fetch and extract content from web pages using Firecrawl. " +
    "Converts HTML to clean markdown. " +
    "Supports multiple URLs separated by commas. " +
    "Batch URLs in a single call for efficiency. " +
    "For GitHub URLs, prefer gh CLI via Bash instead.",
  args: {
    urls: tool.schema
      .string()
      .describe(
        "URLs to scrape, comma-separated (e.g. 'https://example.com/a,https://example.com/b')",
      ),
    include_html: tool.schema
      .boolean()
      .optional()
      .describe("Include raw HTML alongside markdown. Default: false"),
  },
  async execute(args, _context) {
    // Route through the VaelorX router (derived from KORTIX_API_URL) and auth with
    // KORTIX_TOKEN; the router injects the real upstream key. Fall back to a raw
    // FIRECRAWL_API_KEY only when KORTIX_API_URL is unset (self-host/direct).
    const apiBaseURL = getVaelorXRouterBase("firecrawl") ?? undefined;
    const apiKey = apiBaseURL
      ? getEnv("KORTIX_TOKEN")
      : getEnv("FIRECRAWL_API_KEY");
    if (!apiKey) return apiBaseURL
      ? "Error: KORTIX_TOKEN not set."
      : "Error: FIRECRAWL_API_KEY not set.";

    const FirecrawlApp = (await import("@mendable/firecrawl-js")).default;
    const client = new FirecrawlApp({
      apiKey,
      apiUrl: apiBaseURL ?? "https://api.firecrawl.dev",
    });
    const includeHtml = args.include_html ?? false;

    const urlList = args.urls
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    if (urlList.length === 0) return "Error: no valid URLs provided.";

    const results = await Promise.all(
      urlList.map((u) => scrapeOne(client, u, includeHtml)),
    );

    const successful = results.filter((r) => r.success).length;
    const failed = results.length - successful;

    if (successful === 0) {
      const errors = results.map((r) => \`\${r.url}: \${r.error}\`).join("; ");
      return \`Error: Failed to scrape all \${results.length} URLs. \${errors}\`;
    }

    if (urlList.length === 1) return JSON.stringify(results[0], null, 2);

    return JSON.stringify(
      { total: results.length, successful, failed, results },
      null,
      2,
    );
  },
});
`,
  'tools/image_search.ts': `import { tool } from "@opencode-ai/plugin";
import { getEnv, getVaelorXRouterBase } from "./lib/get-env";
// NOTE: \`replicate\` is imported lazily inside enrichImages() — a top-level
// import makes opencode load this heavy SDK at sandbox boot (tool modules are
// evaluated eagerly), adding ~seconds to cold start. Deferred to first use.

const SERPER_DEFAULT_URL = "https://google.serper.dev";

function getSerperImagesUrl(): string {
  const override = getVaelorXRouterBase("serper");
  const base = override || SERPER_DEFAULT_URL;
  return \`\${base.replace(/\\/+$/, "")}/images\`;
}
const MOONDREAM_MODEL =
  "lucataco/moondream2:72ccb656353c348c1385df54b237eeb7bfa874bf11486cf0b9473e691b662d31";
const MOONDREAM_PROMPT =
  "Describe this image in detail. Include any text visible in the image.";
const IMAGE_DOWNLOAD_TIMEOUT_MS = 15_000;

interface SerperImage {
  imageUrl: string;
  title?: string;
  link?: string;
  imageWidth?: number;
  imageHeight?: number;
}

interface SerperResponse {
  images?: SerperImage[];
  searchParameters?: Record<string, unknown>;
}

interface EnrichedImage {
  url: string;
  title: string;
  source: string;
  width: number;
  height: number;
  description: string;
}

function extractImages(data: SerperResponse): EnrichedImage[] {
  return (data.images ?? []).map((img) => ({
    url: img.imageUrl,
    title: img.title ?? "",
    source: img.link ?? "",
    width: img.imageWidth ?? 0,
    height: img.imageHeight ?? 0,
    description: "",
  }));
}

async function describeImage(
  replicate: Replicate,
  imageUrl: string,
): Promise<string> {
  try {
    const res = await fetch(imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS),
      redirect: "follow",
    });

    if (!res.ok) return "";
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return "";

    const imageBytes = await res.arrayBuffer();
    const b64 = Buffer.from(imageBytes).toString("base64");
    const dataUrl = \`data:\${contentType};base64,\${b64}\`;

    const output: unknown = await replicate.run(MOONDREAM_MODEL, {
      input: { image: dataUrl, prompt: MOONDREAM_PROMPT },
    });

    if (typeof output === "string") return output.trim();
    if (output && typeof output === "object" && Symbol.iterator in output) {
      return Array.from(output as Iterable<unknown>)
        .map(String)
        .join("")
        .trim();
    }
    return "";
  } catch {
    return "";
  }
}

async function enrichImages(images: EnrichedImage[]): Promise<EnrichedImage[]> {
  const replicateBaseUrl = getVaelorXRouterBase("replicate") ?? undefined;
  // Route through the VaelorX router (derived from KORTIX_API_URL); auth with
  // KORTIX_TOKEN. Fall back to a raw REPLICATE_API_TOKEN only when unset.
  const replicateToken = replicateBaseUrl
    ? getEnv("KORTIX_TOKEN")
    : getEnv("REPLICATE_API_TOKEN");
  if (!replicateToken || images.length === 0) return images;

  const Replicate = (await import("replicate")).default;
  const replicate = new Replicate({
    auth: replicateToken,
    ...(replicateBaseUrl ? { baseUrl: replicateBaseUrl } : {}),
  });

  return Promise.all(
    images.map(async (img) => {
      try {
        const description = await describeImage(replicate, img.url);
        return { ...img, description: description || img.description };
      } catch {
        return img;
      }
    }),
  );
}

export default tool({
  description:
    "Search for images using the Serper Google Images API. " +
    "Returns image URLs with titles, source pages, dimensions, and AI-generated descriptions. " +
    "When REPLICATE_API_TOKEN is set, enriches results with Moondream2 vision descriptions. " +
    "Supports batch queries separated by |||. " +
    "Use specific descriptive queries including topic/brand names for best results.",
  args: {
    query: tool.schema
      .string()
      .describe(
        "Image search query. For batch, separate with ||| (e.g. 'cats ||| dogs')",
      ),
    num_results: tool.schema
      .number()
      .optional()
      .describe("Images per query (1-100). Default: 12"),
    enrich: tool.schema
      .boolean()
      .optional()
      .describe(
        "Enrich images with AI descriptions via Moondream2. Requires REPLICATE_API_TOKEN. Default: true",
      ),
  },
  async execute(args, _context) {
    const serperUrlOverride = getVaelorXRouterBase("serper") ?? undefined;
    // Route through the VaelorX router (derived from KORTIX_API_URL); auth with
    // KORTIX_TOKEN. Fall back to a raw SERPER_API_KEY only when unset.
    const apiKey = serperUrlOverride
      ? getEnv("KORTIX_TOKEN")
      : getEnv("SERPER_API_KEY");
    if (!apiKey) return serperUrlOverride
      ? "Error: KORTIX_TOKEN not set."
      : "Error: SERPER_API_KEY not set.";

    const numResults = Math.max(1, Math.min(args.num_results ?? 12, 100));
    const shouldEnrich = args.enrich !== false;
    const queries = args.query
      .split("|||")
      .map((q) => q.trim())
      .filter(Boolean);
    if (queries.length === 0) return "Error: empty query.";

    const headers = {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    };

    try {
      if (queries.length === 1) {
        const res = await fetch(getSerperImagesUrl(), {
          method: "POST",
          headers,
          body: JSON.stringify({ q: queries[0], num: numResults }),
        });
        if (!res.ok)
          return \`Error: Serper API returned \${res.status}: \${await res.text()}\`;

        const data = (await res.json()) as SerperResponse;
        let images = extractImages(data);

        if (images.length === 0) return \`No images found for: '\${queries[0]}'\`;
        if (shouldEnrich) images = await enrichImages(images);

        return JSON.stringify(
          { query: queries[0], total: images.length, images },
          null,
          2,
        );
      }

      const payload = queries.map((q) => ({ q, num: numResults }));
      const res = await fetch(getSerperImagesUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok)
        return \`Error: Serper API returned \${res.status}: \${await res.text()}\`;

      const data = await res.json();
      const dataArr: SerperResponse[] = Array.isArray(data) ? data : [data];

      const results = await Promise.all(
        dataArr.map(async (d, i) => {
          let images = extractImages(d);
          if (shouldEnrich) images = await enrichImages(images);
          return { query: queries[i], total: images.length, images };
        }),
      );

      return JSON.stringify({ batch_mode: true, results }, null, 2);
    } catch (e) {
      return \`Error: \${String(e)}\`;
    }
  },
});
`,
  'tools/memory.ts': `/**
 * memory — a 1:1 port of Anthropic's \`memory_20250818\` tool.
 *
 * Same six commands (view / create / str_replace / insert / delete /
 * rename), the same return strings the model is trained to read, and the
 * same security model as the official \`BetaLocalFilesystemMemoryTool\`
 * reference backend — but rooted at the project's real \`.vaelorx/memory/\`
 * folder instead of a virtual \`/memories\` mount.
 *
 * Because every write is an ordinary file change under \`.vaelorx/memory/\`,
 * memory edits flow through the normal VaelorX change-request pipeline
 * (and the \`memory-reflector\` agent) exactly like code.
 *
 * Paths are repo-relative and MUST live under \`.vaelorx/memory\`
 * (e.g. \`.vaelorx/memory/overview.md\`). Nothing is auto-injected: the agent
 * rules + this tool's description carry the memory protocol — \`view\` your
 * memory before starting a task, and record durable progress as you go.
 *
 * Security (ported verbatim from the hardened SDK source, post-CVE):
 *  - path boundary check uses a trailing separator so a sibling dir like
 *    \`.vaelorx/memory-evil\` cannot masquerade as the root (CVE-2026-34451);
 *  - symlink-escape check walks to the deepest existing ancestor and
 *    realpath-verifies it stays inside the root;
 *  - files are written 0o600 and dirs created 0o700 so a permissive
 *    container umask can't expose memory (CVE-2026-41686);
 *  - writes are atomic (temp + fsync + rename).
 */

import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

/** Repo-relative root every memory path must live under. */
const MEMORY_PREFIX = ".vaelorx/memory";

// Owner read/write only — Node's default 0o666 would be world-readable
// under a permissive umask (common in Docker base images).
const FILE_CREATE_MODE = 0o600;
// fs.mkdir defaults to 0o777; lock memory dirs down the same way.
const DIR_CREATE_MODE = 0o700;

const MAX_LINES = 999999;
const LINE_NUMBER_WIDTH = String(MAX_LINES).length; // 6

// ── helpers ──────────────────────────────────────────────────────────────

async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return false;
      throw err;
    });
}

/**
 * fsync a directory so a newly created / renamed / removed entry is durable.
 *
 * This is the load-bearing half of "create actually persisted": fsync-ing a
 * file only flushes its *contents* — the directory entry (the filename) lives
 * in the parent directory's metadata and is only guaranteed on disk after the
 * directory itself is fsynced. Without this, \`create\` can return success and
 * still vanish if the sandbox is snapshotted or killed before the dirent hits
 * disk. Best-effort: some platforms/filesystems (notably Windows) reject
 * fsync on a directory handle — those errors are non-fatal and ignored.
 */
async function fsyncDir(dirPath: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(dirPath, "r");
    await handle.sync();
  } catch (err: any) {
    // EISDIR/EINVAL/EPERM/EACCES: platform can't fsync a dir handle — fine.
    if (!["EISDIR", "EINVAL", "EPERM", "EACCES", "ENOTSUP"].includes(err?.code)) {
      throw err;
    }
  } finally {
    await handle?.close().catch(() => {});
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0B";
  const k = 1024;
  const sizes = ["B", "K", "M", "G"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  return (size % 1 === 0 ? size.toString() : size.toFixed(1)) + sizes[i];
}

/**
 * Write atomically: temp file (0o600) → fsync → rename. A crash mid-write
 * leaves either the complete old content or the complete new content.
 */
async function atomicWriteFile(targetPath: string, content: string): Promise<void> {
  const dir = path.dirname(targetPath);
  const tempPath = path.join(dir, \`.tmp-\${process.pid}-\${randomUUID()}\`);
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tempPath, "wx", FILE_CREATE_MODE);
    await handle.writeFile(content, "utf-8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tempPath, targetPath);
    // Persist the rename itself: the new dirent isn't durable until the
    // containing directory is fsynced.
    await fsyncDir(dir);
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
}

/**
 * Reject paths that escape the memory root through a symlink. Walks up from
 * the target to the deepest existing ancestor, realpath-resolves it, and
 * verifies the real path is still inside the root.
 */
async function validateNoSymlinkEscape(targetPath: string, memoryRoot: string): Promise<void> {
  const resolvedRoot = await fs.realpath(memoryRoot);
  let current = targetPath;
  while (true) {
    try {
      const resolved = await fs.realpath(current);
      if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
        throw new Error(\`Path would escape \${MEMORY_PREFIX} directory via symlink\`);
      }
      return;
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
      const parent = path.dirname(current);
      if (parent === current || current === memoryRoot) return;
      current = parent;
    }
  }
}

async function readFileContent(fullPath: string, memoryPath: string): Promise<string> {
  try {
    return await fs.readFile(fullPath, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(
        \`The file \${memoryPath} no longer exists (may have been deleted or renamed concurrently).\`,
      );
    }
    throw err;
  }
}

/** Resolve & sandbox a repo-relative memory path to an absolute path. */
async function validatePath(memoryPath: string, projectDir: string): Promise<string> {
  const root = path.resolve(projectDir, MEMORY_PREFIX);
  // Normalize a leading "./" so both ".vaelorx/memory" and "./.vaelorx/memory" work.
  const cleaned = memoryPath.replace(/^\\.\\//, "");
  if (cleaned !== MEMORY_PREFIX && !cleaned.startsWith(MEMORY_PREFIX + "/")) {
    throw new Error(\`Path must start with \${MEMORY_PREFIX}, got: \${memoryPath}\`);
  }

  const resolved = path.resolve(projectDir, cleaned);
  // Trailing separator is load-bearing: without it, a sibling dir like
  // ".vaelorx/memory-evil" would pass the prefix check.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(\`Path \${memoryPath} would escape \${MEMORY_PREFIX} directory\`);
  }

  await fs.mkdir(root, { recursive: true, mode: DIR_CREATE_MODE });
  await validateNoSymlinkEscape(resolved, root);
  return resolved;
}

// ── command handlers ─────────────────────────────────────────────────────

async function view(memoryPath: string, viewRange: number[] | undefined, dir: string): Promise<string> {
  const fullPath = await validatePath(memoryPath, dir);

  let stat;
  try {
    stat = await fs.stat(fullPath);
  } catch (err: any) {
    if (err.code === "ENOENT")
      return \`The path \${memoryPath} does not exist. Please provide a valid path.\`;
    throw err;
  }

  if (stat.isDirectory()) {
    const items: Array<{ size: string; path: string }> = [];
    const collect = async (dirPath: string, rel: string, depth: number): Promise<void> => {
      if (depth > 2) return;
      for (const item of (await fs.readdir(dirPath)).sort()) {
        if (item.startsWith(".") || item === "node_modules") continue;
        const itemPath = path.join(dirPath, item);
        const itemRel = rel ? \`\${rel}/\${item}\` : item;
        let s;
        try {
          s = await fs.stat(itemPath);
        } catch {
          continue;
        }
        if (s.isDirectory()) {
          items.push({ size: formatFileSize(s.size), path: \`\${itemRel}/\` });
          if (depth < 2) await collect(itemPath, itemRel, depth + 1);
        } else if (s.isFile()) {
          items.push({ size: formatFileSize(s.size), path: itemRel });
        }
      }
    };
    await collect(fullPath, "", 1);

    const header = \`Here're the files and directories up to 2 levels deep in \${memoryPath}, excluding hidden items and node_modules:\`;
    const lines = [
      \`\${formatFileSize(stat.size)}\\t\${memoryPath}\`,
      ...items.map((it) => \`\${it.size}\\t\${memoryPath}/\${it.path}\`),
    ];
    return \`\${header}\\n\${lines.join("\\n")}\`;
  }

  if (stat.isFile()) {
    const content = await readFileContent(fullPath, memoryPath);
    const allLines = content.split("\\n");
    if (allLines.length > MAX_LINES) {
      return \`File \${memoryPath} has too many lines (\${allLines.length}). Maximum is \${MAX_LINES.toLocaleString()} lines.\`;
    }
    let display = allLines;
    let startNum = 1;
    if (viewRange && viewRange.length === 2) {
      const start = Math.max(1, viewRange[0]!) - 1;
      const end = viewRange[1] === -1 ? allLines.length : viewRange[1];
      display = allLines.slice(start, end);
      startNum = start + 1;
    }
    const numbered = display.map(
      (line, i) => \`\${String(i + startNum).padStart(LINE_NUMBER_WIDTH, " ")}\\t\${line}\`,
    );
    return \`Here's the content of \${memoryPath} with line numbers:\\n\${numbered.join("\\n")}\`;
  }

  return \`Unsupported file type for \${memoryPath}\`;
}

async function create(memoryPath: string, fileText: string, dir: string): Promise<string> {
  const fullPath = await validatePath(memoryPath, dir);
  const parent = path.dirname(fullPath);
  await fs.mkdir(parent, { recursive: true, mode: DIR_CREATE_MODE });
  let handle: fs.FileHandle | undefined;
  try {
    // "wx" atomically claims a fresh name (no truncation of an existing file).
    handle = await fs.open(fullPath, "wx", FILE_CREATE_MODE);
    await handle.writeFile(fileText, "utf-8");
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (err: any) {
    if (err?.code === "EEXIST") return \`Error: File \${memoryPath} already exists\`;
    throw err;
  } finally {
    await handle?.close().catch(() => {});
  }
  // Without this, the file's *contents* are flushed but its directory entry
  // may not be — so a create can report success yet not survive a snapshot.
  await fsyncDir(parent);
  return \`File created successfully at: \${memoryPath}\`;
}

async function strReplace(
  memoryPath: string,
  oldStr: string,
  newStr: string,
  dir: string,
): Promise<string> {
  const fullPath = await validatePath(memoryPath, dir);
  let stat;
  try {
    stat = await fs.stat(fullPath);
  } catch (err: any) {
    if (err.code === "ENOENT")
      return \`Error: The path \${memoryPath} does not exist. Please provide a valid path.\`;
    throw err;
  }
  if (!stat.isFile()) return \`Error: The path \${memoryPath} is not a file.\`;

  const content = await readFileContent(fullPath, memoryPath);
  const lines = content.split("\\n");
  const matching: number[] = [];
  lines.forEach((line, i) => {
    if (line.includes(oldStr)) matching.push(i + 1);
  });

  if (matching.length === 0) {
    return \`No replacement was performed, old_str \\\`\${oldStr}\\\` did not appear verbatim in \${memoryPath}.\`;
  }
  if (matching.length > 1) {
    return \`No replacement was performed. Multiple occurrences of old_str \\\`\${oldStr}\\\` in lines: \${matching.join(", ")}. Please ensure it is unique\`;
  }

  const newContent = content.replace(oldStr, newStr);
  await atomicWriteFile(fullPath, newContent);

  const newLines = newContent.split("\\n");
  const changed = matching[0]! - 1;
  const from = Math.max(0, changed - 2);
  const to = Math.min(newLines.length, changed + 3);
  const snippet = newLines
    .slice(from, to)
    .map((line, i) => \`\${String(from + i + 1).padStart(LINE_NUMBER_WIDTH, " ")}\\t\${line}\`);
  return \`The memory file has been edited. Here is the snippet showing the change (with line numbers):\\n\${snippet.join("\\n")}\`;
}

async function insert(
  memoryPath: string,
  insertLine: number,
  insertText: string,
  dir: string,
): Promise<string> {
  const fullPath = await validatePath(memoryPath, dir);
  let stat;
  try {
    stat = await fs.stat(fullPath);
  } catch (err: any) {
    if (err.code === "ENOENT")
      return \`Error: The path \${memoryPath} does not exist. Please provide a valid path.\`;
    throw err;
  }
  if (!stat.isFile()) return \`Error: The path \${memoryPath} is not a file.\`;

  const content = await readFileContent(fullPath, memoryPath);
  const lines = content.split("\\n");
  if (insertLine < 0 || insertLine > lines.length) {
    return \`Error: Invalid \\\`insert_line\\\` parameter: \${insertLine}. It should be within the range of lines of the file: [0, \${lines.length}]\`;
  }
  lines.splice(insertLine, 0, insertText.replace(/\\n$/, ""));
  await atomicWriteFile(fullPath, lines.join("\\n"));
  return \`The file \${memoryPath} has been edited.\`;
}

async function del(memoryPath: string, dir: string): Promise<string> {
  const fullPath = await validatePath(memoryPath, dir);
  const cleaned = memoryPath.replace(/^\\.\\//, "");
  if (cleaned === MEMORY_PREFIX) return \`Cannot delete the \${MEMORY_PREFIX} directory itself\`;
  try {
    await fs.rm(fullPath, { recursive: true, force: false });
  } catch (err: any) {
    if (err.code === "ENOENT") return \`Error: The path \${memoryPath} does not exist\`;
    throw err;
  }
  await fsyncDir(path.dirname(fullPath));
  return \`Successfully deleted \${memoryPath}\`;
}

async function rename(oldPath: string, newPath: string, dir: string): Promise<string> {
  const oldFull = await validatePath(oldPath, dir);
  const newFull = await validatePath(newPath, dir);
  // POSIX rename() silently overwrites; best-effort guard.
  if (await exists(newFull)) return \`Error: The destination \${newPath} already exists\`;
  const newParent = path.dirname(newFull);
  await fs.mkdir(newParent, { recursive: true, mode: DIR_CREATE_MODE });
  try {
    await fs.rename(oldFull, newFull);
  } catch (err: any) {
    if (err.code === "ENOENT") return \`Error: The path \${oldPath} does not exist\`;
    throw err;
  }
  // Persist both sides of the move (the entry left one dir and entered another).
  await fsyncDir(newParent);
  await fsyncDir(path.dirname(oldFull));
  return \`Successfully renamed \${oldPath} to \${newPath}\`;
}

// ── tool definition ────────────────────────────────────────────────────────

export default tool({
  description:
    "Persistent project memory — read, write, and curate the project brain in \`.vaelorx/memory/\`. " +
    "This is the canonical way to work with memory; use it instead of the generic read/edit/write tools for anything under \`.vaelorx/memory/\`. " +
    "Memory persists across sessions and is shared with the whole team via the repo, so write durable facts here. " +
    "ALWAYS \`view\` \`.vaelorx/memory\` before starting a task to recover prior context, and record durable progress as you go — your context window may reset at any time.\\n\\n" +
    "Paths are repo-relative and MUST start with \`.vaelorx/memory\` (e.g. \`.vaelorx/memory/overview.md\`). " +
    "Keep memory coherent and organized: prefer editing existing files, rename or delete stale ones, and don't create new files unless a topic deserves its own page. " +
    "Always keep \`.vaelorx/memory/MEMORY.md\` (the index) in sync — one line per sub-file. " +
    "Never store secrets, tokens, or PII. Edits land on \`main\` through the normal change-request flow.\\n\\n" +
    "Commands: \`view\` (dir listing or file with line numbers; optional view_range), \`create\` (new file), " +
    "\`str_replace\` (replace a unique snippet), \`insert\` (insert at a line), \`delete\` (remove file/dir), \`rename\` (move file/dir).",
  args: {
    command: tool.schema
      .enum(["view", "create", "str_replace", "insert", "delete", "rename"])
      .describe("The memory operation to perform."),
    path: tool.schema
      .string()
      .optional()
      .describe(
        "Repo-relative path under \`.vaelorx/memory\` (e.g. \`.vaelorx/memory/overview.md\`). Required for view, create, str_replace, insert, delete.",
      ),
    view_range: tool.schema
      .array(tool.schema.number())
      .optional()
      .describe("Optional [start, end] line range for \`view\` of a file. Use -1 for end-of-file."),
    file_text: tool.schema.string().optional().describe("File contents. Required for \`create\`."),
    old_str: tool.schema
      .string()
      .optional()
      .describe("Exact text to replace (must be unique in the file). Required for \`str_replace\`."),
    new_str: tool.schema
      .string()
      .optional()
      .describe("Replacement text. Required for \`str_replace\` (use empty string to delete)."),
    insert_line: tool.schema
      .number()
      .optional()
      .describe("Line number to insert after (0 = top of file). Required for \`insert\`."),
    insert_text: tool.schema.string().optional().describe("Text to insert. Required for \`insert\`."),
    old_path: tool.schema.string().optional().describe("Source path. Required for \`rename\`."),
    new_path: tool.schema.string().optional().describe("Destination path. Required for \`rename\`."),
  },

  async execute(args, context) {
    const dir = context.directory;
    try {
      switch (args.command) {
        case "view":
          if (!args.path) return "Error: \`path\` is required for view.";
          return await view(args.path, args.view_range, dir);
        case "create":
          if (!args.path) return "Error: \`path\` is required for create.";
          if (args.file_text === undefined) return "Error: \`file_text\` is required for create.";
          return await create(args.path, args.file_text, dir);
        case "str_replace":
          if (!args.path) return "Error: \`path\` is required for str_replace.";
          if (args.old_str === undefined) return "Error: \`old_str\` is required for str_replace.";
          if (args.new_str === undefined) return "Error: \`new_str\` is required for str_replace.";
          return await strReplace(args.path, args.old_str, args.new_str, dir);
        case "insert":
          if (!args.path) return "Error: \`path\` is required for insert.";
          if (args.insert_line === undefined) return "Error: \`insert_line\` is required for insert.";
          if (args.insert_text === undefined) return "Error: \`insert_text\` is required for insert.";
          return await insert(args.path, args.insert_line, args.insert_text, dir);
        case "delete":
          if (!args.path) return "Error: \`path\` is required for delete.";
          return await del(args.path, dir);
        case "rename":
          if (!args.old_path) return "Error: \`old_path\` is required for rename.";
          if (!args.new_path) return "Error: \`new_path\` is required for rename.";
          return await rename(args.old_path, args.new_path, dir);
        default:
          return \`Error: unknown command\`;
      }
    } catch (err: any) {
      return \`Error: \${err?.message ?? String(err)}\`;
    }
  },
});
`,
  'tools/show.ts': `import { tool } from "@opencode-ai/plugin";
import { existsSync } from "fs";
import { resolve } from "path";

// ── Types ──────────────────────────────────────────────────────────────────

/** Content types the show tool can present. */
const TYPES = [
  "file",
  "image",
  "url",
  "text",
  "error",
  "video",
  "audio",
  "code",
  "markdown",
  "pdf",
  "html",
  "csv",
  "xlsx",
  "docx",
  "pptx",
] as const;
type ShowType = (typeof TYPES)[number];

/** Display variants that control how the frontend renders the output. */
const VARIANTS = [
  "compact",   // Minimal inline card — small footprint in the conversation
  "full",      // Full available space — ideal for URL previews, HTML, PDFs
  "gallery",   // Visual-first — centers content with proper aspect ratio
  "detail",    // Rich layout — prominent title, description, content sections
] as const;
type ShowVariant = (typeof VARIANTS)[number];

/** Aspect ratio presets for visual content. */
const ASPECT_RATIOS = [
  "auto",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:2",
  "21:9",
] as const;
type ShowAspectRatio = (typeof ASPECT_RATIOS)[number];

/** Visual theme for the output card. */
const THEMES = [
  "default",
  "success",
  "warning",
  "info",
  "danger",
] as const;
type ShowTheme = (typeof THEMES)[number];

interface ShowEntry {
  id: string;
  timestamp: string;
  type: ShowType;
  title?: string;
  description?: string;
  path?: string;
  url?: string;
  content?: string;
  variant?: ShowVariant;
  aspect_ratio?: ShowAspectRatio;
  theme?: ShowTheme;
  language?: string;
  metadata?: Record<string, unknown>;
}

function generateId(): string {
  return \`show_\${Date.now()}_\${Math.random().toString(36).slice(2, 8)}\`;
}

/** Infer a sensible default variant based on content type. */
function defaultVariant(type: ShowType): ShowVariant {
  switch (type) {
    case "url":
    case "html":
    case "pdf":
      return "full";
    case "image":
    case "video":
      return "gallery";
    case "code":
    case "markdown":
    case "text":
      return "detail";
    case "csv":
    case "xlsx":
      return "full";
    case "docx":
    case "pptx":
      return "full";
    case "audio":
    case "file":
      return "compact";
    case "error":
      return "compact";
    default:
      return "detail";
  }
}

// ── Shared validation ──────────────────────────────────────────────────────

const PATH_TYPES: ShowType[] = ["file", "image", "video", "audio", "pdf", "csv", "xlsx", "docx", "pptx"];
const CONTENT_TYPES: ShowType[] = ["text", "error", "code", "markdown", "html"];

function validateAndBuildEntry(item: Record<string, unknown>): string | ShowEntry {
  const type = item.type as ShowType | undefined;
  if (!type || !TYPES.includes(type as ShowType)) {
    return \`Error: 'type' is required. Use one of: \${TYPES.join(", ")}.\`;
  }

  if (PATH_TYPES.includes(type) && !item.path) {
    return \`Error: 'path' is required when type is '\${type}'.\`;
  }
  if (type === "url" && !item.url) {
    return \`Error: 'url' is required when type is 'url'.\`;
  }
  if (CONTENT_TYPES.includes(type) && !item.content) {
    return \`Error: 'content' is required when type is '\${type}'.\`;
  }

  if (PATH_TYPES.includes(type) && item.path) {
    const absPath = resolve(item.path as string);
    if (!existsSync(absPath)) {
      return \`Error: File not found: \${absPath}\`;
    }
  }

  const variant = (item.variant as ShowVariant) || undefined;
  if (variant && !VARIANTS.includes(variant)) {
    return \`Error: Invalid variant '\${variant}'. Use one of: \${VARIANTS.join(", ")}.\`;
  }

  const aspectRatio = (item.aspect_ratio as ShowAspectRatio) || undefined;
  if (aspectRatio && !ASPECT_RATIOS.includes(aspectRatio)) {
    return \`Error: Invalid aspect_ratio '\${aspectRatio}'. Use one of: \${ASPECT_RATIOS.join(", ")}.\`;
  }

  const theme = (item.theme as ShowTheme) || undefined;
  if (theme && !THEMES.includes(theme)) {
    return \`Error: Invalid theme '\${theme}'. Use one of: \${THEMES.join(", ")}.\`;
  }

  let metadata: Record<string, unknown> | undefined;
  if (item.metadata) {
    if (typeof item.metadata === "string") {
      try {
        metadata = JSON.parse(item.metadata);
      } catch {
        return \`Error: Invalid JSON in 'metadata' parameter.\`;
      }
    } else if (typeof item.metadata === "object") {
      metadata = item.metadata as Record<string, unknown>;
    }
  }

  const resolvedVariant = variant || defaultVariant(type);

  return {
    id: generateId(),
    timestamp: new Date().toISOString(),
    type,
    variant: resolvedVariant,
    ...(item.title ? { title: item.title as string } : {}),
    ...(item.description ? { description: item.description as string } : {}),
    ...(item.path ? { path: resolve(item.path as string) } : {}),
    ...(item.url ? { url: item.url as string } : {}),
    ...(item.content ? { content: item.content as string } : {}),
    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    ...(theme && theme !== "default" ? { theme } : {}),
    ...(item.language ? { language: item.language as string } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

// ── Tool definition ────────────────────────────────────────────────────────

export default tool({
  description:
    "Show outputs and attachments to the human user. This tool PRESENTS and DISPLAYS existing content — " +
    "it is NOT a place to author or store artifacts. Show should SHOW, not be where you write.\\n\\n" +
    "CRITICAL RULE: Do not use show to write new artifacts from scratch. If you need to create a " +
    "spec, report, plan, document, config, or any authored content — write it to a file first " +
    "using the Write tool, then present it with show(type='file', path='...'). " +
    "The 'content' parameter is for communicating brief information inline (status, summaries, " +
    "snippets, errors, previews) — not for authoring documents.\\n\\n" +
    "Good: Write spec to /workspace/spec.md → show(type='file', path='/workspace/spec.md')\\n" +
    "Good: show(type='text', content='Build succeeded in 3.2s')\\n" +
    "Good: show(type='code', content='const x = 1;', language='typescript')\\n" +
    "Bad: show(type='markdown', content='# Full spec written from scratch here...') — write to file first!\\n\\n" +
    "Types: file, image, url, text, error, video, audio, code, markdown, pdf, html, csv, xlsx, docx, pptx.\\n" +
    "IMPORTANT HTML NOTE: type='html' renders INLINE HTML from the 'content' field only. " +
    "A standalone .html file or website on disk is NOT auto-hosted — serve it with a local web server, " +
    "then pass its plain URL with type='url'. For a static site, start one with pty_spawn " +
    "(e.g. \`python3 -m http.server 3000 --directory /workspace/site\`); for an app, run its dev server " +
    "(e.g. \`npm run dev\`). Then show(type='url', url='http://localhost:3000/'). The platform auto-detects " +
    "and proxies any localhost port — just use a plain http://localhost:PORT/ URL, no special path format needed.\\n" +
    "Variants (display hints): compact, full, gallery, detail — controls layout. " +
    "Defaults are smart per type but can be overridden.\\n" +
    "aspect_ratio: auto, 1:1, 16:9, 9:16, 4:3, 3:2, 21:9 — for visual content.\\n" +
    "theme: default, success, warning, info, danger — visual accent.\\n" +
    "language: for type='code', the language for syntax highlighting (e.g. 'python', 'typescript').\\n\\n" +
    "MULTI-ITEM MODE: To show multiple items at once (rendered as a carousel), pass a JSON array " +
    "string to the 'items' parameter instead of individual type/path/url/content params. " +
    "Each item in the array is an object with the same fields (type, title, path, url, content, etc.).",
  args: {
    action: tool.schema
      .string()
      .describe("Action: 'show' to present an item to the user."),

    type: tool.schema
      .string()
      .optional()
      .describe(
        "Type of item. Required for single-item 'show' (omit when using 'items'). " +
          "Options: 'file' (any file on disk), 'image' (image file), 'url' (web link or localhost preview), " +
          "'text' (inline text), 'error' (error message), 'video' (video file), 'audio' (audio file), " +
          "'code' (syntax-highlighted code block), 'markdown' (rendered markdown), " +
          "'pdf' (PDF document), 'html' (raw HTML rendered in sandboxed iframe), " +
          "'csv' (CSV/TSV tabular data), 'xlsx' (Excel spreadsheet), " +
          "'docx' (Word document), 'pptx' (PowerPoint presentation).",
      ),

    title: tool.schema
      .string()
      .optional()
      .describe("Short heading. E.g. 'Generated Logo', 'API Response', 'Build Output'."),

    description: tool.schema
      .string()
      .optional()
      .describe(
        "Longer description shown below the title. E.g. 'A 1024x1024 logo in your brand colors'.",
      ),

    path: tool.schema
      .string()
      .optional()
      .describe(
        "Absolute file path. Required when type is 'file', 'image', 'video', 'audio', 'pdf', 'csv', 'xlsx', 'docx', or 'pptx'. " +
          "E.g. '/workspace/output/logo.png'. Note: passing a .html path as type='file' does not host/execute it; " +
          "serve it with a local web server (e.g. \`python3 -m http.server 3000\` via pty_spawn) and pass its " +
          "plain http://localhost:PORT/ URL as type='url' for live HTML pages.",
      ),

    url: tool.schema
      .string()
      .optional()
      .describe(
        "URL to show. Required when type is 'url'. Use for localhost previews (e.g. 'http://localhost:3000') " +
          "or external links. For standalone HTML files, first serve them via a web server, then pass the served URL here.",
      ),

    content: tool.schema
      .string()
      .optional()
      .describe(
        "Inline content for display. Required when type is 'text', 'error', 'code', 'markdown', or 'html'. " +
        "Use this to communicate information briefly — not to author full artifacts from scratch. " +
        "If the content is a new document you're creating (spec, report, plan, etc.), write it to a file first and use type='file' with path. " +
        "For 'html', inline HTML rendered in a sandboxed iframe (not a file path).",
      ),

    variant: tool.schema
      .string()
      .optional()
      .describe(
        "Display variant controlling the layout. Options: " +
          "'compact' (minimal inline card), 'full' (fills available space — great for previews), " +
          "'gallery' (visual-first, centered with aspect ratio — great for images/video), " +
          "'detail' (rich layout with prominent title, description, content). " +
          "Smart defaults per type if omitted.",
      ),

    aspect_ratio: tool.schema
      .string()
      .optional()
      .describe(
        "Aspect ratio for visual content. Options: 'auto' (default), '1:1', '16:9', '9:16', '4:3', '3:2', '21:9'. " +
          "Most useful with type='image' or type='video' + variant='gallery'.",
      ),

    theme: tool.schema
      .string()
      .optional()
      .describe(
        "Visual accent theme. Options: 'default', 'success' (green), 'warning' (amber), " +
          "'info' (blue), 'danger' (red). Affects the border/badge colors.",
      ),

    language: tool.schema
      .string()
      .optional()
      .describe(
        "Programming language for syntax highlighting. Only used when type='code'. " +
          "E.g. 'python', 'typescript', 'rust', 'json', 'bash'.",
      ),

    metadata: tool.schema
      .string()
      .optional()
      .describe(
        "Optional JSON string of extra metadata. E.g. '{\\"width\\":1024,\\"format\\":\\"png\\",\\"duration\\":\\"3:42\\"}'.",
      ),

    items: tool.schema
      .string()
      .optional()
      .describe(
        "JSON array of items to show as a carousel. Each item is an object with: " +
          "type (required), title, description, path, url, content, variant, aspect_ratio, theme, language, metadata. " +
          "When provided, individual type/path/url/content params are ignored. " +
          'Example: \\'[{"type":"image","title":"Logo v1","path":"/workspace/v1.png"},{"type":"image","title":"Logo v2","path":"/workspace/v2.png"}]\\'',
      ),
  },

  async execute(args, _context) {
    const action = args.action;

    // ── Multi-item mode (items array) ──
    if (args.items) {
      let parsed: unknown;
      try {
        parsed = typeof args.items === "string" ? JSON.parse(args.items) : args.items;
      } catch {
        return \`Error: Invalid JSON in 'items' parameter. Must be a JSON array of objects.\`;
      }

      if (!Array.isArray(parsed) || parsed.length === 0) {
        return \`Error: 'items' must be a non-empty JSON array.\`;
      }

      const entries: ShowEntry[] = [];
      const errors: string[] = [];

      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (!item || typeof item !== "object") {
          errors.push(\`Item \${i}: must be an object.\`);
          continue;
        }
        const result = validateAndBuildEntry(item as Record<string, unknown>);
        if (typeof result === "string") {
          errors.push(\`Item \${i}: \${result}\`);
        } else {
          entries.push(result);
        }
      }

      if (errors.length > 0 && entries.length === 0) {
        return \`Error: All items failed validation:\\n\${errors.join("\\n")}\`;
      }

      const titleLabel = args.title || \`\${entries.length} items\`;

      return JSON.stringify(
        {
          success: true,
          action: "show",
          ...(args.title && { title: args.title }),
          ...(args.description && { description: args.description }),
          ...(args.theme && args.theme !== "default" && { theme: args.theme }),
          items: entries,
          ...(errors.length > 0 && { warnings: errors }),
          message: \`\${entries.length} item(s) presented to user as carousel.\`,
        },
        null,
        2,
      );
    }

    // ── Single-item mode (type is provided directly) ──
    const type = args.type as ShowType | undefined;
    if (!type || !TYPES.includes(type as ShowType)) {
      return \`Error: 'type' is required for 'show' action. Use one of: \${TYPES.join(", ")}. Or pass 'items' for multi-item carousel.\`;
    }

    const result = validateAndBuildEntry(args);
    if (typeof result === "string") return result;

    return JSON.stringify(
      {
        success: true,
        action: "show",
        entry: result,
        message: \`Item '\${args.title || type}' presented to user.\`,
      },
      null,
      2,
    );
  },
});
`,
  'tools/lib/get-env.ts': `import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";

const S6_ENV_DIR =
  process.env.S6_ENV_DIR || "/run/s6/container_environment";

/**
 * Parsed .env file cache.
 * Loaded once on first miss, never re-read (process lifetime).
 */
let dotenvCache: Record<string, string> | null = null;

/**
 * Walk up from multiple starting points to find the nearest .env file.
 * Tries both __dirname-based path and process.cwd() to handle bundled
 * and native execution contexts.
 */
function findDotenvPath(): string | null {
  // Try multiple starting points — __dirname may differ when bundled
  const startDirs = [
    dirname(dirname(__dirname)),  // tools/lib/ → tools/ → OpenCode config dir
    process.cwd(),                // wherever OpenCode was started from
  ];

  for (const start of startDirs) {
    let dir = start;
    for (let i = 0; i < 5; i++) {
      const candidate = resolve(dir, ".env");
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break; // filesystem root
      dir = parent;
    }
  }
  return null;
}

/**
 * Parse a .env file into a key→value map.
 * Supports KEY=VALUE, ignores comments (#) and blank lines.
 * Does NOT handle multi-line values or quoted values with newlines.
 */
function parseDotenv(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const content = readFileSync(path, "utf-8");
    for (const line of content.split("\\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && value) result[key] = value;
    }
  } catch {
    // File unreadable — return empty
  }
  return result;
}

/**
 * Load the .env cache (once per process).
 */
function getDotenv(): Record<string, string> {
  if (dotenvCache !== null) return dotenvCache;
  const path = findDotenvPath();
  dotenvCache = path ? parseDotenv(path) : {};
  return dotenvCache;
}

/**
 * Read an environment variable with multi-tier fallback.
 *
 * Resolution order (first non-empty wins):
 *
 * 1. s6 env dir file     — \`/run/s6/container_environment/{key}\` (always fresh, ~1μs tmpfs read)
 * 2. \`process.env[key]\`  — Docker env, manually exported (native dev without s6)
 * 3. \`.env\` file          — nearest \`.env\` walking up from the OpenCode config dir (native dev fallback)
 *
 * s6 is checked first so that env var updates from the secrets manager
 * (kortix-master /env API) take effect immediately — no service restart needed.
 * In native dev (no s6 dir), the read throws and falls through to process.env.
 */
export function getEnv(key: string): string | undefined {
  // 1. s6 env dir — authoritative in containers, always fresh from disk.
  //    kortix-master writes here on every /env POST, so values update without restart.
  //    tmpfs read is ~1μs — negligible cost for always-correct values.
  try {
    const val = readFileSync(\`\${S6_ENV_DIR}/\${key}\`, "utf-8").trim();
    if (val) return val;
  } catch {
    // File doesn't exist — not in a container, or key not set via s6.
  }

  // 2. process.env — Docker env vars, shell exports (native dev without s6)
  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;

  // 3. .env file fallback (native dev on macOS — no Docker, no s6)
  const dotenv = getDotenv();
  const envVal = dotenv[key];
  if (envVal) return envVal;

  return undefined;
}

/**
 * Base URL for a VaelorX router-proxied upstream service, derived from
 * KORTIX_API_URL. The sandbox only ever holds KORTIX_API_URL + KORTIX_TOKEN;
 * tools build their proxy endpoint from those two. Normalizes so it works
 * whether KORTIX_API_URL is a bare origin or already ends in /v1 or /v1/router.
 * Returns null when KORTIX_API_URL is unset.
 */
export function getVaelorXRouterBase(service: string): string | null {
  const raw = getEnv("KORTIX_API_URL");
  if (!raw) return null;
  const root = raw
    .replace(/\\/+$/, "")
    .replace(/\\/v1\\/router$/, "")
    .replace(/\\/v1$/, "");
  return \`\${root}/v1/router/\${service}\`;
}
`,
  'package.json': `{
  "name": "vaelorx-opencode-config",
  "private": true,
  "//": "Dependencies for the custom tools in tools/. OpenCode runs \`bun install\` here at startup so tools can import them. The sandbox image pre-warms Bun's cache with these so the boot-time install is offline and fast.",
  "dependencies": {
    "@mendable/firecrawl-js": "^4.25.1",
    "@tavily/core": "^0.7.3",
    "replicate": "^1.4.0"
  }
}
`,
}
