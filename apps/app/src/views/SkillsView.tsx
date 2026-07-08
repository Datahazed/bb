import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SkillProvider, SkillSummary } from "@bb/server-contract";
import type { ProviderCliStatusResponse } from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { appToast } from "@/components/ui/app-toast";
import { FilePreview } from "@/components/secondary-panel/FilePreview.js";
import { Icon } from "@bb/shared-ui/icon";
import { PageShell } from "@/components/ui/page-shell.js";
import { Pill } from "@bb/shared-ui/pill";
import { CREATE_SKILL_PROMPT } from "@/components/promptbox/PromptBoxActionsMenu";
import { CreateWithTemplatesButton } from "@/components/create-via-prompt-examples";
import {
  getProviderIconColorClass,
  getProviderIconInfo,
} from "@/lib/provider-icon";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { cn } from "@bb/shared-ui/lib/utils";
import { usePrimaryHost } from "@/hooks/queries/host-queries";
import {
  useDeleteSkill,
  useProjectSkills,
  useSkillContent,
  useUpdateSkill,
} from "@/hooks/queries/skills-queries";
import { useHostProviderCliStatus } from "@/hooks/queries/system-queries";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";

interface SkillProviderGroup {
  /** Group key: the provider id, or "bb" for provider-agnostic bb skills. */
  key: string;
  label: string;
  providerId: SkillProvider | null;
  skills: SkillSummary[];
}

// bb-agnostic skills first, then each provider.
const PROVIDER_ORDER: readonly (SkillProvider | null)[] = [
  null,
  "claude-code",
  "codex",
];
const SKILL_ROW_HEIGHT_REM = 1.75;
const SKILL_VISIBLE_ROW_COUNT = 10;
const SKILL_ROW_GAP_PX = 1;
const SKILL_LIST_VERTICAL_PADDING_REM = 0.5;
const SKILL_LIST_MAX_HEIGHT = `calc(${
  SKILL_ROW_HEIGHT_REM * SKILL_VISIBLE_ROW_COUNT +
  SKILL_LIST_VERTICAL_PADDING_REM
}rem + ${SKILL_ROW_GAP_PX * (SKILL_VISIBLE_ROW_COUNT - 1)}px)`;
const skillListViewportStyle = {
  maxHeight: SKILL_LIST_MAX_HEIGHT,
} satisfies CSSProperties;

export interface RegistrySkill {
  id: string;
  source: string;
  skillId: string;
  name: string;
  installs: number;
  installUrl: string | null;
  url: string;
  topic: string;
  summary: string | null;
  worksWith: string[];
}

type RegistryScope = "user" | "project";
type RegistryProvider = "claude-code" | "codex";
const EMPTY_SKILLS: readonly SkillSummary[] = [];
const EMPTY_REGISTRY_PROVIDER_SET = new Set<RegistryProvider>();
const DEFAULT_PROVIDER_STATUS: Record<RegistryProvider, boolean> = {
  "claude-code": false,
  codex: false,
};

const REGISTRY_PROVIDERS = [
  { id: "claude-code", cliKey: "claudeCode", label: "Claude Code" },
  { id: "codex", cliKey: "codex", label: "Codex" },
] as const satisfies readonly {
  id: RegistryProvider;
  cliKey: "claudeCode" | "codex";
  label: string;
}[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRegistrySkills(value: unknown): RegistrySkill[] {
  if (!isRecord(value) || !Array.isArray(value.skills)) return [];
  return value.skills.filter((skill): skill is RegistrySkill => {
    if (!isRecord(skill)) return false;
    return (
      typeof skill.id === "string" &&
      typeof skill.source === "string" &&
      typeof skill.skillId === "string" &&
      typeof skill.name === "string" &&
      typeof skill.installs === "number" &&
      (skill.installUrl === null || typeof skill.installUrl === "string") &&
      typeof skill.url === "string" &&
      typeof skill.topic === "string" &&
      (skill.summary === null || typeof skill.summary === "string") &&
      Array.isArray(skill.worksWith) &&
      skill.worksWith.every((provider) => typeof provider === "string")
    );
  });
}

async function fetchRegistrySkills(query: string): Promise<RegistrySkill[]> {
  const params = new URLSearchParams();
  if (query.trim().length > 0) params.set("q", query.trim());
  const suffix = params.toString();
  const response = await fetch(
    `/api/v1/skills-registry${suffix ? `?${suffix}` : ""}`,
  );
  if (!response.ok) throw new Error("Failed to load skills registry");
  return parseRegistrySkills(await response.json());
}

async function installRegistrySkill(args: {
  skill: RegistrySkill;
  scope: RegistryScope;
  providers: RegistryProvider[];
}) {
  const response = await fetch("/api/v1/skills-registry/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: args.skill.source,
      skillId: args.skill.skillId,
      scope: args.scope,
      providers: args.providers,
      projectId: PERSONAL_PROJECT_ID,
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    ok?: unknown;
    message?: unknown;
  } | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(
      typeof body?.message === "string" ? body.message : "Skill install failed",
    );
  }
  return body;
}

function normalizeSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-");
}

function formatRegistrySource(source: string): string {
  const githubPrefix = "github.com/";
  return source.startsWith(githubPrefix)
    ? source.slice(githubPrefix.length)
    : source;
}

function formatInstallCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function providerStatusFromCli(
  data: ProviderCliStatusResponse | undefined,
): Record<RegistryProvider, boolean> {
  return {
    "claude-code": data?.claudeCode?.installed === true,
    codex: data?.codex?.installed === true,
  };
}

function providerLabel(providerId: SkillProvider | null): string {
  if (providerId === null) {
    return "bb";
  }
  return getProviderIconInfo(providerId)?.ariaLabel ?? providerId;
}

/**
 * Group skills by the provider surface they're discovered under. bb-agnostic
 * skills (`provider: null`) collapse into a single "bb" group, listed last.
 */
export function groupSkillsByProvider(
  skills: readonly SkillSummary[],
): SkillProviderGroup[] {
  const byKey = new Map<string, SkillProviderGroup>();
  for (const skill of skills) {
    const key = skill.provider ?? "bb";
    const existing = byKey.get(key);
    if (existing) {
      existing.skills.push(skill);
      continue;
    }
    byKey.set(key, {
      key,
      label: providerLabel(skill.provider),
      providerId: skill.provider,
      skills: [skill],
    });
  }
  return PROVIDER_ORDER.flatMap((provider) => {
    const group = byKey.get(provider ?? "bb");
    return group ? [group] : [];
  });
}

export function ProviderLogo({
  providerId,
  className,
}: {
  providerId: SkillProvider;
  className?: string;
}) {
  const info = getProviderIconInfo(providerId);
  if (!info) {
    return null;
  }
  const LogoIcon = info.icon;
  return (
    <LogoIcon
      className={cn(getProviderIconColorClass(providerId), className)}
    />
  );
}

/** Calm, typeahead-style row: skill icon + name + muted description. Clicking
 * views the skill. */
function SkillRow({
  skill,
  onSelect,
}: {
  skill: SkillSummary;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={skill.description ?? skill.name}
      className="flex h-7 w-full cursor-pointer items-center gap-1.5 rounded px-2 text-left text-xs hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Icon
        name="Zap"
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="truncate text-foreground">{skill.name}</span>
      {skill.description ? (
        <span className="truncate text-subtle-foreground [flex-shrink:9999]">
          {skill.description}
        </span>
      ) : null}
    </button>
  );
}

function StatusDot({ tone }: { tone: "success" | "muted" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        tone === "success" ? "bg-success" : "bg-muted-foreground/50",
      )}
    />
  );
}

function registryProviderLabel(providerId: RegistryProvider): string {
  return (
    REGISTRY_PROVIDERS.find((provider) => provider.id === providerId)?.label ??
    providerId
  );
}

function RegistrySkillRow({
  skill,
  installedProviders,
  providerStatus,
  scope,
  onScopeChange,
  onInstall,
  onSelect,
  pending,
}: {
  skill: RegistrySkill;
  installedProviders: ReadonlySet<RegistryProvider>;
  providerStatus: Record<RegistryProvider, boolean>;
  scope: RegistryScope;
  onScopeChange: (scope: RegistryScope) => void;
  onInstall: (skill: RegistrySkill, providers: RegistryProvider[]) => void;
  onSelect: (skill: RegistrySkill) => void;
  pending: boolean;
}) {
  const configuredProviders = REGISTRY_PROVIDERS.filter(
    (provider) => providerStatus[provider.id],
  ).map((provider) => provider.id);
  const remainingProviders = configuredProviders.filter(
    (provider) => !installedProviders.has(provider),
  );
  const isInstalled = installedProviders.size > 0;
  const defaultProviders = isInstalled
    ? remainingProviders
    : configuredProviders;
  const statusLabel = isInstalled
    ? "Installed"
    : configuredProviders.length > 0
      ? "Available"
      : "No provider";
  return (
    <div className="flex min-w-0 items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-state-hover">
      <Icon name="Zap" className="size-3.5 shrink-0 text-muted-foreground" />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => onSelect(skill)}
        title={skill.summary ?? skill.name}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-foreground">{skill.name}</span>
          <span className="truncate text-subtle-foreground">
            {formatRegistrySource(skill.source)}
          </span>
        </span>
        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-subtle-foreground">
          <span>{formatInstallCount(skill.installs)} installs</span>
          <span>{skill.topic}</span>
          <span className="truncate">
            Works with {skill.worksWith.join(", ")}
          </span>
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
        <StatusDot tone={isInstalled ? "success" : "muted"} />
        {statusLabel}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 shrink-0 px-2 text-xs"
        disabled={pending || defaultProviders.length === 0}
        onClick={() => onInstall(skill, [...defaultProviders])}
      >
        {isInstalled ? "Add provider" : "Install"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground"
            aria-label={`${skill.name} install options`}
          >
            <Icon name="ChevronDown" className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-56"
          mobileTitle={`${skill.name} install options`}
        >
          {(["user", "project"] as const).map((option) => (
            <DropdownMenuItem
              key={option}
              onSelect={() => onScopeChange(option)}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2 capitalize">
                <StatusDot tone={scope === option ? "success" : "muted"} />
                {option}
              </span>
              <span className="text-xs text-muted-foreground">scope</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {REGISTRY_PROVIDERS.map((provider) => {
            const configured = providerStatus[provider.id];
            const installed = installedProviders.has(provider.id);
            return (
              <DropdownMenuItem
                key={provider.id}
                disabled={!configured || pending || installed}
                onSelect={() => onInstall(skill, [provider.id])}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <StatusDot tone={configured ? "success" : "muted"} />
                  <ProviderLogo
                    providerId={provider.id}
                    className="size-3.5 shrink-0"
                  />
                  <span>{provider.label}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {installed ? "Installed" : configured ? scope : "Disabled"}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export interface SkillsOverviewProps {
  skills: readonly SkillSummary[];
  isLoading: boolean;
  hasError: boolean;
  query?: string;
  registrySkills?: readonly RegistrySkill[];
  registryIsLoading?: boolean;
  registryHasError?: boolean;
  registryScope?: RegistryScope;
  providerStatus?: Record<RegistryProvider, boolean>;
  pendingRegistrySkillId?: string | null;
  /** Opens the composer to create a skill, optionally seeded with a full prompt. */
  onCreateSkill: (prompt?: string) => void;
  onSelectSkill: (skill: SkillSummary) => void;
  onSelectRegistrySkill?: (skill: RegistrySkill) => void;
  onQueryChange?: (query: string) => void;
  onRegistryScopeChange?: (scope: RegistryScope) => void;
  onInstallRegistrySkill?: (
    skill: RegistrySkill,
    providers: RegistryProvider[],
  ) => void;
  getInstalledProvidersForRegistrySkill?: (
    skill: RegistrySkill,
  ) => ReadonlySet<RegistryProvider>;
  /** Refetch after a load failure — gives the error state a way out. */
  onRetry?: () => void;
  onRetryRegistry?: () => void;
}

/**
 * Presentational Skills list: provider-grouped, searchable, typeahead-style
 * rows. Split from the data-fetching container so it renders in tests/stories.
 */
export function SkillsOverview({
  skills,
  isLoading,
  hasError,
  query = "",
  registrySkills = [],
  registryIsLoading = false,
  registryHasError = false,
  registryScope = "user",
  providerStatus = DEFAULT_PROVIDER_STATUS,
  pendingRegistrySkillId = null,
  onCreateSkill,
  onSelectSkill,
  onSelectRegistrySkill = () => {},
  onQueryChange = () => {},
  onRegistryScopeChange = () => {},
  onInstallRegistrySkill = () => {},
  getInstalledProvidersForRegistrySkill = () => EMPTY_REGISTRY_PROVIDER_SET,
  onRetry,
  onRetryRegistry,
}: SkillsOverviewProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);
  const normalizedQuery = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const filtered = skills.filter(
      (skill) =>
        normalizedQuery === "" ||
        skill.name.toLowerCase().includes(normalizedQuery) ||
        (skill.description ?? "").toLowerCase().includes(normalizedQuery),
    );
    return groupSkillsByProvider(filtered);
  }, [skills, normalizedQuery]);
  return (
    <div className="space-y-4">
      {/* One library of every skill across providers. You search and manage
            here; creating a bb skill is a single template-based action, the way
            VS Code / Raycast keep authoring out of the management list rather
            than stacking a teaching panel onto a list that is never empty. */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-input bg-transparent px-2 transition-shadow focus-within:ring-1 focus-within:ring-border">
            <Icon
              name="Search"
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <input
              aria-label="Search skills"
              placeholder="Search skills"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <CreateWithTemplatesButton
            kind="skill"
            label="New bb skill"
            onCreate={onCreateSkill}
          />
        </div>
      </div>
      {hasError ? (
        // Failure is direction, not a dead end: say what happened plainly and
        // offer the way out, kept calm rather than alarmist.
        <EmptyStatePanel role="alert" className="py-6">
          <div className="flex flex-col items-center gap-2">
            <span>Couldn't load skills.</span>
            {onRetry ? (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </div>
        </EmptyStatePanel>
      ) : isLoading ? (
        <div className="space-y-px" aria-busy aria-label="Loading skills">
          {[
            ["w-28", "w-48"],
            ["w-36", "w-40"],
            ["w-24", "w-56"],
            ["w-32", "w-44"],
            ["w-40", "w-52"],
            ["w-28", "w-44"],
          ].map(([nameWidth, descWidth]) => (
            <div
              key={`${nameWidth}-${descWidth}`}
              className="flex items-center gap-1.5 px-2 py-1.5"
            >
              <Skeleton className="size-3.5 rounded" />
              <Skeleton className={cn("h-3", nameWidth)} />
              <Skeleton className={cn("h-3", descWidth)} />
            </div>
          ))}
        </div>
      ) : (
        <>
          {groups.length === 0 ? (
            normalizedQuery === "" ? null : (
              <EmptyStatePanel className="py-6">
                {`No skills match "${query}"`}
              </EmptyStatePanel>
            )
          ) : (
            <div className="space-y-2">
              {groups.map((group) => {
                const isCollapsed = collapsed.has(group.key);
                return (
                  <section
                    key={group.key}
                    className="overflow-hidden rounded-md border border-border bg-popover text-popover-foreground"
                  >
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      aria-expanded={!isCollapsed}
                      className="flex w-full items-center gap-1.5 bg-surface-recessed px-3 py-1.5 text-xs text-muted-foreground hover:bg-state-hover"
                    >
                      <Icon
                        name="ChevronRight"
                        className={cn(
                          "size-3 shrink-0 text-muted-foreground transition-transform duration-150",
                          !isCollapsed && "rotate-90",
                        )}
                        aria-hidden
                      />
                      {group.providerId ? (
                        <ProviderLogo
                          providerId={group.providerId}
                          className="size-3.5"
                        />
                      ) : null}
                      <span className="font-medium">{group.label}</span>
                      <span className="text-subtle-foreground">
                        {group.skills.length}
                      </span>
                    </button>
                    {isCollapsed ? null : (
                      <div
                        className="overflow-y-auto p-1"
                        style={skillListViewportStyle}
                      >
                        <div className="flex flex-col gap-px">
                          {group.skills.map((skill) => (
                            <SkillRow
                              key={`${group.key}-${skill.scope}-${skill.name}-${skill.filePath}`}
                              skill={skill}
                              onSelect={() => onSelectSkill(skill)}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
          {registryHasError ? (
            <EmptyStatePanel role="alert" className="py-6">
              <div className="flex flex-col items-center gap-2">
                <span>Couldn't load skills.sh.</span>
                {onRetryRegistry ? (
                  <Button variant="outline" size="sm" onClick={onRetryRegistry}>
                    Retry
                  </Button>
                ) : null}
              </div>
            </EmptyStatePanel>
          ) : registryIsLoading ? (
            <div
              className="space-y-px"
              aria-busy
              aria-label="Loading skills.sh"
            >
              {["w-36", "w-48", "w-28"].map((nameWidth) => (
                <div
                  key={nameWidth}
                  className="flex items-center gap-1.5 px-2 py-1.5"
                >
                  <Skeleton className="size-3.5 rounded" />
                  <Skeleton className={cn("h-3", nameWidth)} />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          ) : registrySkills.length > 0 ? (
            <section className="overflow-hidden rounded-md border border-border bg-popover text-popover-foreground">
              <div className="flex items-center gap-1.5 bg-surface-recessed px-3 py-1.5 text-xs text-muted-foreground">
                <Icon name="Zap" className="size-3.5 shrink-0" aria-hidden />
                <span className="font-medium">skills.sh</span>
                <span className="text-subtle-foreground">
                  {registrySkills.length}
                </span>
              </div>
              <div
                className="overflow-y-auto p-1"
                style={skillListViewportStyle}
              >
                <div className="flex flex-col gap-px">
                  {registrySkills.map((skill) => (
                    <RegistrySkillRow
                      key={skill.id}
                      skill={skill}
                      installedProviders={getInstalledProvidersForRegistrySkill(
                        skill,
                      )}
                      providerStatus={providerStatus}
                      scope={registryScope}
                      pending={pendingRegistrySkillId === skill.id}
                      onScopeChange={onRegistryScopeChange}
                      onInstall={onInstallRegistrySkill}
                      onSelect={onSelectRegistrySkill}
                    />
                  ))}
                </div>
              </div>
            </section>
          ) : normalizedQuery === "" ? null : (
            <EmptyStatePanel className="py-6">
              {`No skills.sh resources match "${query}"`}
            </EmptyStatePanel>
          )}
        </>
      )}
    </div>
  );
}

function RegistrySkillDetailView({
  skill,
  installedProviders,
  providerStatus,
  scope,
  pending,
  onBack,
  onScopeChange,
  onInstall,
}: {
  skill: RegistrySkill;
  installedProviders: ReadonlySet<RegistryProvider>;
  providerStatus: Record<RegistryProvider, boolean>;
  scope: RegistryScope;
  pending: boolean;
  onBack: () => void;
  onScopeChange: (scope: RegistryScope) => void;
  onInstall: (skill: RegistrySkill, providers: RegistryProvider[]) => void;
}) {
  const configuredProviders = REGISTRY_PROVIDERS.filter(
    (provider) => providerStatus[provider.id],
  ).map((provider) => provider.id);
  const remainingProviders = configuredProviders.filter(
    (provider) => !installedProviders.has(provider),
  );
  const isInstalled = installedProviders.size > 0;
  const defaultProviders = isInstalled
    ? remainingProviders
    : configuredProviders;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <Icon name="ChevronLeft" className="size-3.5" />
        Skills
      </Button>
      <div className="space-y-4 rounded-md border border-border bg-popover p-4 text-popover-foreground">
        <div className="flex min-w-0 items-start gap-3">
          <Icon
            name="Zap"
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="truncate text-base font-semibold">{skill.name}</h1>
            <p className="truncate text-xs text-muted-foreground">
              {formatRegistrySource(skill.source)}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot tone={isInstalled ? "success" : "muted"} />
            {isInstalled ? "Installed" : "Available"}
          </span>
        </div>
        {skill.summary ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {skill.summary}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{formatInstallCount(skill.installs)} installs</span>
          <span>{skill.topic}</span>
          <span>Works with {skill.worksWith.join(", ")}</span>
          {installedProviders.size > 0 ? (
            <span>
              Installed on{" "}
              {[...installedProviders].map(registryProviderLabel).join(", ")}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md bg-surface-recessed p-0.5">
            {(["user", "project"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={cn(
                  "h-7 rounded px-2 text-xs capitalize",
                  scope === option
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
                onClick={() => onScopeChange(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            disabled={pending || defaultProviders.length === 0}
            onClick={() => onInstall(skill, [...defaultProviders])}
          >
            {isInstalled ? "Add provider" : "Install"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                aria-label={`${skill.name} provider picker`}
              >
                <Icon name="ChevronDown" className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56"
              mobileTitle={`${skill.name} providers`}
            >
              {REGISTRY_PROVIDERS.map((provider) => {
                const configured = providerStatus[provider.id];
                const installed = installedProviders.has(provider.id);
                return (
                  <DropdownMenuItem
                    key={provider.id}
                    disabled={!configured || pending || installed}
                    onSelect={() => onInstall(skill, [provider.id])}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <StatusDot tone={configured ? "success" : "muted"} />
                      <ProviderLogo
                        providerId={provider.id}
                        className="size-3.5 shrink-0"
                      />
                      <span>{provider.label}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {installed
                        ? "Installed"
                        : configured
                          ? scope
                          : "Disabled"}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

const SCOPE_LABELS: Record<SkillSummary["scope"], string> = {
  "bb-builtin": "bb · built-in",
  "bb-user": "bb · user",
  "bb-project": "bb · project",
  "claude-user": "Claude · user",
  "claude-project": "Claude · project",
  codex: "Codex",
  plugin: "Plugin",
};

export interface SkillDetailDialogViewProps {
  skill: SkillSummary | null;
  /** Already-fetched SKILL.md source. */
  content: string;
  isLoadingContent: boolean;
  isContentError: boolean;
  /** Expose inline Edit + Delete (manageable bb user/project skills only). */
  canManage: boolean;
  canOpenInEditor: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  onClose: () => void;
  /**
   * Persist edited content. Resolves `true` when the save succeeded so the view
   * leaves edit mode; `false` keeps the draft for retry.
   */
  onSave: (content: string) => Promise<boolean>;
  onDelete: () => void;
  onOpenInEditor: () => void;
}

/**
 * Presentational skill detail page: renders the SKILL.md (read) or an inline
 * editor, with Edit / Delete / Open-in-editor affordances. Owns only local UI
 * state (editing, draft, delete confirmation); all data + persistence arrive as
 * props so it renders in stories/tests without queries. The connected
 * {@link SkillDetailPage} wires it to the content/update/delete queries.
 */
export function SkillDetailDialogView({
  skill,
  content,
  isLoadingContent,
  isContentError,
  canManage,
  canOpenInEditor,
  isSaving,
  isDeleting,
  onClose,
  onSave,
  onDelete,
  onOpenInEditor,
}: SkillDetailDialogViewProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setEditing(false);
    setConfirmingDelete(false);
  }, [skill?.scope, skill?.name, skill?.provider]);

  async function handleSave() {
    if (await onSave(draft)) {
      setEditing(false);
    }
  }

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Focus the editor the moment editing starts, so it's truly edit-in-place.
  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
    }
  }, [editing]);

  function startEditing() {
    setConfirmingDelete(false);
    setDraft(content);
    setEditing(true);
  }

  // Read mode: a single overflow by the title (Notion/Linear-style). Edit is
  // reached from here and happens inline; the viewer has no toolbar.
  const overflowMenu =
    canManage || canOpenInEditor ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground"
            aria-label="Skill actions"
          >
            <Icon name="MoreHorizontal" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-0"
          mobileTitle="Skill actions"
        >
          {canManage ? (
            <DropdownMenuItem onSelect={startEditing}>
              <Icon name="Edit" className="size-4 text-muted-foreground" />
              Edit
            </DropdownMenuItem>
          ) : null}
          {canOpenInEditor ? (
            <DropdownMenuItem onSelect={onOpenInEditor}>
              <Icon
                name="ExternalLink"
                className="size-4 text-muted-foreground"
              />
              Open in editor
            </DropdownMenuItem>
          ) : null}
          {canManage ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setConfirmingDelete(true)}
              >
                <Icon name="Trash2" className="size-4" />
                Delete
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  // Edit (Cancel/Save) and delete-confirm actions live below the preview.
  const footerActions = editing ? (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={isSaving}
        onClick={() => setEditing(false)}
      >
        Cancel
      </Button>
      <Button
        size="sm"
        disabled={isSaving || isLoadingContent}
        onClick={handleSave}
      >
        Save
      </Button>
    </>
  ) : confirmingDelete ? (
    <>
      <span className="mr-auto self-center text-xs text-muted-foreground">
        Delete this skill?
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setConfirmingDelete(false)}
      >
        Cancel
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive hover:text-destructive"
        disabled={isDeleting}
        onClick={onDelete}
      >
        Delete
      </Button>
    </>
  ) : null;

  if (skill === null) return null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-muted-foreground hover:text-foreground"
        onClick={onClose}
      >
        <Icon name="ChevronLeft" className="size-3.5" />
        Skills
      </Button>
      <div className="space-y-4 rounded-md border border-border bg-popover p-4 text-popover-foreground">
        <div className="flex min-w-0 items-start gap-3">
          <Icon
            name="Zap"
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="truncate text-base font-semibold">{skill.name}</h1>
              {skill.provider ? (
                <ProviderLogo
                  providerId={skill.provider}
                  className="size-3.5 shrink-0"
                />
              ) : null}
              <Pill variant="outline" className="shrink-0">
                {SCOPE_LABELS[skill.scope]}
              </Pill>
            </div>
            {skill.description ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {skill.description}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {editing || confirmingDelete ? null : overflowMenu}
          </div>
        </div>

        <div className="grid gap-2 rounded-md border border-border bg-surface-recessed p-3 text-xs sm:grid-cols-3">
          <div className="min-w-0">
            <div className="text-subtle-foreground">Kind</div>
            <div className="mt-0.5 truncate text-foreground">Skill</div>
          </div>
          <div className="min-w-0">
            <div className="text-subtle-foreground">Provider</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-foreground">
              {skill.provider ? (
                <>
                  <ProviderLogo
                    providerId={skill.provider}
                    className="size-3.5 shrink-0"
                  />
                  <span className="truncate">
                    {providerLabel(skill.provider)}
                  </span>
                </>
              ) : (
                <span className="truncate">bb</span>
              )}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-subtle-foreground">Scope</div>
            <div className="mt-0.5 truncate text-foreground">
              {SCOPE_LABELS[skill.scope]}
            </div>
          </div>
        </div>

        {isContentError ? (
          <p className="text-sm text-destructive">Failed to load the skill.</p>
        ) : isLoadingContent ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : editing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="SKILL.md"
            className="h-[60dvh] w-full resize-none rounded-md border border-border bg-surface-raised p-3 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        ) : (
          <div className="max-h-[60dvh] overflow-auto rounded-md border border-border">
            <FilePreview
              path="SKILL.md"
              headerMode="none"
              state={{
                kind: "ready",
                file: { name: "SKILL.md", contents: content },
                lineRange: null,
                showMarkdownModeToggle: false,
              }}
            />
          </div>
        )}

        {footerActions ? (
          <div className="flex justify-end gap-2">{footerActions}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * View a skill's SKILL.md; bb skills (manageable) can be edited inline or
 * deleted. Connected — owns the content/update/delete queries and renders
 * {@link SkillDetailDialogView}.
 */
function SkillDetailPage({
  projectId,
  skill,
  onClose,
}: {
  projectId: string;
  skill: SkillSummary | null;
  onClose: () => void;
}) {
  const contentQuery = useSkillContent(projectId, skill);
  const updateSkill = useUpdateSkill(projectId);
  const deleteSkill = useDeleteSkill(projectId);
  // Skills live on the local host (personal project), so the SKILL.md is a real
  // local file we can hand to the user's editor.
  const { canOpenPreferredFileTarget, openPathInPreferredFileTarget } =
    useLocalOpenTargets({ enabled: skill !== null });

  const deletableScope =
    skill && (skill.scope === "bb-user" || skill.scope === "bb-project")
      ? skill.scope
      : null;

  return (
    <SkillDetailDialogView
      skill={skill}
      content={contentQuery.data?.content ?? ""}
      isLoadingContent={contentQuery.isLoading}
      isContentError={contentQuery.isError}
      canManage={skill?.manageable === true && deletableScope !== null}
      canOpenInEditor={skill !== null && canOpenPreferredFileTarget}
      isSaving={updateSkill.isPending}
      isDeleting={deleteSkill.isPending}
      onClose={onClose}
      onSave={async (content) => {
        if (!skill || deletableScope === null) return false;
        try {
          await updateSkill.mutateAsync({
            scope: deletableScope,
            name: skill.name,
            environmentId: null,
            content,
          });
          return true;
        } catch {
          // Errors surface via the global handler; keep the edits for retry.
          return false;
        }
      }}
      onDelete={() => {
        if (!skill || deletableScope === null) return;
        deleteSkill.mutate(
          { scope: deletableScope, name: skill.name, environmentId: null },
          { onSuccess: onClose },
        );
      }}
      onOpenInEditor={() => {
        if (!skill) return;
        void openPathInPreferredFileTarget({
          path: skill.filePath,
          lineNumber: null,
        });
      }}
    />
  );
}

export function SkillsLibrary() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [registryScope, setRegistryScope] = useState<RegistryScope>("user");
  const skillsQuery = useProjectSkills(PERSONAL_PROJECT_ID);
  const skills = skillsQuery.data?.skills ?? EMPTY_SKILLS;
  const hasError = skillsQuery.isError && skillsQuery.data === undefined;
  const isLoading =
    skillsQuery.isFetching && skillsQuery.data === undefined && !hasError;
  const primaryHost = usePrimaryHost();
  const providerCliStatus = useHostProviderCliStatus({
    hostId: primaryHost?.id ?? null,
    enabled: primaryHost !== null,
  });
  const providerStatus = useMemo(
    () => providerStatusFromCli(providerCliStatus.data),
    [providerCliStatus.data],
  );
  const registryQuery = useQuery({
    queryKey: ["skills-registry", query.trim()],
    queryFn: () => fetchRegistrySkills(query),
    staleTime: 60_000,
  });
  const registryInstall = useMutation({
    mutationFn: installRegistrySkill,
    onSuccess: () => {
      appToast.success("Skill installed");
      void skillsQuery.refetch();
    },
    onError: (error) => {
      appToast.error(error instanceof Error ? error.message : String(error));
    },
  });
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null);
  const [selectedRegistrySkill, setSelectedRegistrySkill] =
    useState<RegistrySkill | null>(null);
  const installedProvidersForRegistrySkill = useCallback(
    (skill: RegistrySkill): ReadonlySet<RegistryProvider> => {
      const names = new Set([
        normalizeSkillName(skill.skillId),
        normalizeSkillName(skill.name),
      ]);
      return new Set(
        REGISTRY_PROVIDERS.flatMap((provider) =>
          skills.some(
            (installedSkill) =>
              installedSkill.provider === provider.id &&
              names.has(normalizeSkillName(installedSkill.name)),
          )
            ? [provider.id]
            : [],
        ),
      );
    },
    [skills],
  );
  const installRegistry = useCallback(
    (skill: RegistrySkill, providers: RegistryProvider[]) => {
      if (providers.length === 0) return;
      registryInstall.mutate({ skill, scope: registryScope, providers });
    },
    [registryInstall, registryScope],
  );
  // Create via prompt: open the composer seeded with the bb-skill prompt; the
  // spawned thread authors the SKILL.md.
  const handleCreateSkill = useCallback(
    (prompt?: string) => {
      navigate(getRootComposeRoutePath(), {
        state: {
          focusPrompt: true,
          initialPrompt: prompt ?? CREATE_SKILL_PROMPT,
          replaceInitialPrompt: true,
          createDraftKind: "skill",
        },
      });
    },
    [navigate],
  );
  const pendingRegistrySkillId =
    registryInstall.isPending && registryInstall.variables
      ? registryInstall.variables.skill.id
      : null;
  return (
    <>
      {selectedSkill ? (
        <SkillDetailPage
          projectId={PERSONAL_PROJECT_ID}
          skill={selectedSkill}
          onClose={() => setSelectedSkill(null)}
        />
      ) : selectedRegistrySkill ? (
        <RegistrySkillDetailView
          skill={selectedRegistrySkill}
          installedProviders={installedProvidersForRegistrySkill(
            selectedRegistrySkill,
          )}
          providerStatus={providerStatus}
          scope={registryScope}
          pending={pendingRegistrySkillId === selectedRegistrySkill.id}
          onBack={() => setSelectedRegistrySkill(null)}
          onScopeChange={setRegistryScope}
          onInstall={installRegistry}
        />
      ) : (
        <SkillsOverview
          skills={skills}
          isLoading={isLoading}
          hasError={hasError}
          query={query}
          registrySkills={registryQuery.data ?? []}
          registryIsLoading={
            registryQuery.isFetching && registryQuery.data === undefined
          }
          registryHasError={registryQuery.isError}
          registryScope={registryScope}
          providerStatus={providerStatus}
          pendingRegistrySkillId={pendingRegistrySkillId}
          onCreateSkill={handleCreateSkill}
          onSelectSkill={setSelectedSkill}
          onSelectRegistrySkill={setSelectedRegistrySkill}
          onQueryChange={setQuery}
          onRegistryScopeChange={setRegistryScope}
          onInstallRegistrySkill={installRegistry}
          getInstalledProvidersForRegistrySkill={
            installedProvidersForRegistrySkill
          }
          onRetry={() => void skillsQuery.refetch()}
          onRetryRegistry={() => void registryQuery.refetch()}
        />
      )}
    </>
  );
}

export function SkillsView() {
  return (
    <PageShell contentClassName="pt-4 md:pt-5" maxWidthClassName="max-w-5xl">
      <SkillsLibrary />
    </PageShell>
  );
}
