import { spawn } from "node:child_process";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import { requirePublicProject } from "../services/lib/entity-lookup.js";
import { resolveCommandWorkspace } from "../services/threads/provider-command-typeahead.js";

const SKILLS_BASE_URL = "https://www.skills.sh";
const REGISTRY_LIMIT = 100;
const DETAIL_PREVIEW_LIMIT = 10;
const GITHUB_STARS_PREVIEW_LIMIT = 48;
const GITHUB_STARS_CACHE_TTL_MS = 30 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 120_000;

const SUPPORTED_INSTALL_PROVIDERS = ["claude-code", "codex"] as const;
type SkillInstallProvider = (typeof SUPPORTED_INSTALL_PROVIDERS)[number];
type SkillInstallScope = "user" | "project";

interface RegistrySkill {
  id: string;
  source: string;
  skillId: string;
  name: string;
  installs: number;
  stars: number | null;
  installUrl: string | null;
  url: string;
  topic: string;
  summary: string | null;
  worksWith: string[];
}

interface SkillsApiSkill {
  id: string;
  slug: string;
  name: string;
  source: string;
  installs: number;
  installUrl: string | null;
  url: string;
}

const FALLBACK_REGISTRY_SKILLS: readonly RegistrySkill[] = [
  {
    id: "vercel-labs/skills/find-skills",
    source: "vercel-labs/skills",
    skillId: "find-skills",
    name: "find-skills",
    installs: 2_384_417,
    stars: null,
    installUrl: "https://github.com/vercel-labs/skills",
    url: "https://www.skills.sh/vercel-labs/skills/find-skills",
    topic: "Agent workflows",
    summary:
      "Discover and install specialized agent skills from the open ecosystem.",
    worksWith: ["Claude Code", "Codex"],
  },
  {
    id: "anthropics/skills/frontend-design",
    source: "anthropics/skills",
    skillId: "frontend-design",
    name: "frontend-design",
    installs: 635_858,
    stars: null,
    installUrl: "https://github.com/anthropics/skills",
    url: "https://www.skills.sh/anthropics/skills/frontend-design",
    topic: "Design & UI",
    summary: "Build distinctive, production-grade frontend interfaces.",
    worksWith: ["Claude Code", "Codex"],
  },
  {
    id: "vercel-labs/agent-skills/vercel-react-best-practices",
    source: "vercel-labs/agent-skills",
    skillId: "vercel-react-best-practices",
    name: "vercel-react-best-practices",
    installs: 532_556,
    stars: null,
    installUrl: "https://github.com/vercel-labs/agent-skills",
    url: "https://www.skills.sh/vercel-labs/agent-skills/vercel-react-best-practices",
    topic: "React",
    summary: "Apply React and Next.js implementation conventions.",
    worksWith: ["Claude Code", "Codex"],
  },
];

let lastRegistrySkills: RegistrySkill[] | null = null;
const githubStarsCache = new Map<
  string,
  { stars: number | null; expiresAt: number }
>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'");
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
}

function registrySkillUrl(id: string): string {
  return `${SKILLS_BASE_URL}/${id
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function parsePublicHomepageSkills(html: string): RegistrySkill[] {
  const byId = new Map<string, RegistrySkill>();
  const pattern =
    /\\"source\\":\\"([^"\\]+)\\",\\"skillId\\":\\"([^"\\]+)\\",\\"name\\":\\"([^"\\]+)\\",\\"installs\\":(\d+)/gu;
  for (const match of html.matchAll(pattern)) {
    const source = match[1];
    const skillId = match[2];
    const name = match[3];
    const installs = Number(match[4]);
    if (!source || !skillId || !name || !Number.isFinite(installs)) continue;
    const id = `${source}/${skillId}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      source,
      skillId,
      name,
      installs,
      stars: null,
      installUrl: source.includes(".")
        ? `https://${source}`
        : `https://github.com/${source}`,
      url: registrySkillUrl(id),
      topic: "Agent workflows",
      summary: null,
      worksWith: ["Claude Code", "Codex"],
    });
    if (byId.size >= REGISTRY_LIMIT) break;
  }
  return [...byId.values()];
}

function parsePublicDetail(
  html: string,
): Pick<RegistrySkill, "topic" | "summary"> {
  const topic =
    html.match(/href="\/topic\/[^"]+">([^<]+)</u)?.[1] ?? "Agent workflows";
  const summarySection = html.match(
    /Summary<\/div>(?<summary>[\s\S]*?)SKILL\.md/u,
  )?.groups?.summary;
  const summary =
    summarySection === undefined
      ? null
      : stripTags(summarySection)
          .replace(/\bShow more\b$/u, "")
          .trim();
  return {
    topic: decodeHtml(topic),
    summary: summary && summary.length > 0 ? summary.slice(0, 280) : null,
  };
}

function isApiSkill(value: unknown): value is SkillsApiSkill {
  if (typeof value !== "object" || value === null) return false;
  const skill = value as Record<string, unknown>;
  return (
    typeof skill.id === "string" &&
    typeof skill.slug === "string" &&
    typeof skill.name === "string" &&
    typeof skill.source === "string" &&
    typeof skill.installs === "number" &&
    (skill.installUrl === null || typeof skill.installUrl === "string") &&
    typeof skill.url === "string"
  );
}

async function fetchRegistryJson(url: URL): Promise<SkillsApiSkill[] | null> {
  const token = process.env.VERCEL_OIDC_TOKEN;
  if (!token) return null;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    data?: unknown;
  } | null;
  return Array.isArray(body?.data)
    ? body.data.filter(isApiSkill).slice(0, REGISTRY_LIMIT)
    : null;
}

async function fetchPublicDirectorySkills(
  query: string,
): Promise<RegistrySkill[]> {
  const response = await fetch(`${SKILLS_BASE_URL}/`);
  if (!response.ok) {
    throw new ApiError(
      503,
      "skills_registry_unavailable",
      "skills.sh is unavailable",
    );
  }
  const skills = parsePublicHomepageSkills(await response.text());
  const normalizedQuery = query.trim().toLowerCase();
  return normalizedQuery.length === 0
    ? skills
    : skills.filter(
        (skill) =>
          skill.name.toLowerCase().includes(normalizedQuery) ||
          skill.source.toLowerCase().includes(normalizedQuery),
      );
}

async function hydrateDetails(
  skills: RegistrySkill[],
): Promise<RegistrySkill[]> {
  const hydrated = await Promise.all(
    skills.slice(0, DETAIL_PREVIEW_LIMIT).map(async (skill) => {
      try {
        const response = await fetch(skill.url);
        if (!response.ok) return skill;
        return { ...skill, ...parsePublicDetail(await response.text()) };
      } catch {
        return skill;
      }
    }),
  );
  return [...hydrated, ...skills.slice(DETAIL_PREVIEW_LIMIT)];
}

function githubRepoForSource(source: string): string | null {
  const githubHostPrefix = "github.com/";
  const githubUrlPrefix = "https://github.com/";
  const normalized = source.startsWith(githubUrlPrefix)
    ? source.slice(githubUrlPrefix.length)
    : source.startsWith(githubHostPrefix)
      ? source.slice(githubHostPrefix.length)
      : source;
  if (normalized.includes(".")) return null;

  const [owner, repo] = normalized.split("/");
  if (!owner || !repo) return null;
  const safeSegment = /^[A-Za-z0-9_.-]+$/u;
  if (!safeSegment.test(owner) || !safeSegment.test(repo)) return null;
  return `${owner}/${repo}`;
}

async function fetchGithubStars(source: string): Promise<number | null> {
  const repo = githubRepoForSource(source);
  if (repo === null) return null;

  const cached = githubStarsCache.get(repo);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.stars;

  let stars: number | null = null;
  try {
    const separatorIndex = repo.indexOf("/");
    const owner = repo.slice(0, separatorIndex);
    const repoName = repo.slice(separatorIndex + 1);
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "bb-skills-registry",
        },
      },
    );
    if (response.ok) {
      const body = await response.json().catch(() => null);
      if (isRecord(body) && typeof body.stargazers_count === "number") {
        stars = body.stargazers_count;
      }
    }
  } catch {
    stars = null;
  }

  githubStarsCache.set(repo, {
    stars,
    expiresAt: now + GITHUB_STARS_CACHE_TTL_MS,
  });
  return stars;
}

async function hydrateGithubStars(
  skills: RegistrySkill[],
): Promise<RegistrySkill[]> {
  const sources = [
    ...new Set(
      skills.slice(0, GITHUB_STARS_PREVIEW_LIMIT).map((skill) => skill.source),
    ),
  ];
  const starsBySource = new Map<string, number | null>();
  await Promise.all(
    sources.map(async (source) => {
      starsBySource.set(source, await fetchGithubStars(source));
    }),
  );
  return skills.map((skill) =>
    starsBySource.has(skill.source)
      ? { ...skill, stars: starsBySource.get(skill.source) ?? null }
      : skill,
  );
}

async function listRegistrySkills(query: string): Promise<RegistrySkill[]> {
  const apiUrl = new URL(
    query.trim().length > 0 ? "/api/v1/skills/search" : "/api/v1/skills",
    SKILLS_BASE_URL,
  );
  if (query.trim().length > 0) {
    apiUrl.searchParams.set("q", query.trim());
    apiUrl.searchParams.set("limit", String(REGISTRY_LIMIT));
  } else {
    apiUrl.searchParams.set("view", "all-time");
    apiUrl.searchParams.set("per_page", String(REGISTRY_LIMIT));
  }
  const apiSkills = await fetchRegistryJson(apiUrl);
  const skills =
    apiSkills?.map((skill) => ({
      id: skill.id,
      source: skill.source,
      skillId: skill.slug,
      name: skill.name,
      installs: skill.installs,
      stars: null,
      installUrl: skill.installUrl,
      url: skill.url,
      topic: "Agent workflows",
      summary: null,
      worksWith: ["Claude Code", "Codex"],
    })) ?? (await fetchPublicDirectorySkills(query));
  const hydrated = await hydrateGithubStars(await hydrateDetails(skills));
  lastRegistrySkills = hydrated;
  return hydrated;
}

function filterRegistryFallback(query: string): RegistrySkill[] {
  const normalizedQuery = query.trim().toLowerCase();
  const fallback = lastRegistrySkills ?? [...FALLBACK_REGISTRY_SKILLS];
  return normalizedQuery.length === 0
    ? fallback
    : fallback.filter(
        (skill) =>
          skill.name.toLowerCase().includes(normalizedQuery) ||
          skill.source.toLowerCase().includes(normalizedQuery),
      );
}

function parseProviders(value: unknown): SkillInstallProvider[] {
  if (!Array.isArray(value)) return [];
  const providers = value.filter((provider): provider is SkillInstallProvider =>
    SUPPORTED_INSTALL_PROVIDERS.includes(provider as SkillInstallProvider),
  );
  return [...new Set(providers)];
}

function parseInstallScope(value: unknown): SkillInstallScope | null {
  return value === "user" || value === "project" ? value : null;
}

function packageRefForSource(source: string): string {
  const githubPrefix = "github.com/";
  if (source.startsWith(githubPrefix)) return source.slice(githubPrefix.length);
  return source.includes(".") ? `https://${source}` : source;
}

function runSkillsInstall(args: {
  cwd: string;
  provider: SkillInstallProvider;
  packageRef: string;
  skillId: string;
  scope: SkillInstallScope;
}): Promise<{ ok: boolean; stdout: string; stderr: string; command: string }> {
  const commandArgs = [
    "-y",
    "skills@latest",
    "add",
    args.packageRef,
    "--agent",
    args.provider,
    "--skill",
    args.skillId,
    "--yes",
    ...(args.scope === "user" ? ["--global"] : []),
  ];
  return new Promise((resolve) => {
    const child = spawn("npx", commandArgs, { cwd: args.cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, INSTALL_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        stdout,
        stderr: stderr.length > 0 ? stderr : error.message,
        command: `npx ${commandArgs.join(" ")}`,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        stdout,
        stderr,
        command: `npx ${commandArgs.join(" ")}`,
      });
    });
  });
}

export function registerSkillsRegistryRoutes(app: Hono, deps: AppDeps): void {
  app.get("/skills-registry", async (context) => {
    const query = context.req.query("q") ?? "";
    try {
      return context.json({ skills: await listRegistrySkills(query) });
    } catch (error) {
      deps.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        "skills.sh registry fetch failed; using fallback data",
      );
      return context.json({ skills: filterRegistryFallback(query) });
    }
  });

  app.post("/skills-registry/install", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      source?: unknown;
      skillId?: unknown;
      scope?: unknown;
      providers?: unknown;
      projectId?: unknown;
      environmentId?: unknown;
    } | null;
    if (
      body === null ||
      typeof body.source !== "string" ||
      typeof body.skillId !== "string"
    ) {
      throw new ApiError(400, "invalid_request", "Expected source and skillId");
    }
    const providers = parseProviders(body.providers);
    const scope = parseInstallScope(body.scope);
    if (providers.length === 0 || scope === null) {
      throw new ApiError(
        400,
        "invalid_request",
        "Expected providers and scope",
      );
    }

    let cwd = deps.config.dataDir;
    if (scope === "project") {
      if (typeof body.projectId !== "string") {
        throw new ApiError(
          400,
          "invalid_request",
          "Project scope requires a project",
        );
      }
      requirePublicProject(deps.db, body.projectId);
      const workspace = resolveCommandWorkspace(deps, {
        projectId: body.projectId,
        environmentId:
          typeof body.environmentId === "string" ? body.environmentId : null,
      });
      if (workspace.cwd === null) {
        throw new ApiError(
          409,
          "invalid_request",
          "No workspace resolved for this project's skills",
        );
      }
      cwd = workspace.cwd;
    }

    const packageRef = packageRefForSource(body.source);
    const results = [];
    for (const provider of providers) {
      results.push(
        await runSkillsInstall({
          cwd,
          provider,
          packageRef,
          skillId: body.skillId,
          scope,
        }),
      );
    }
    return context.json({ ok: results.every((result) => result.ok), results });
  });
}
