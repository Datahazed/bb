import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
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
import {
  ResourceBrowseCard,
  ResourceCardStat,
  ResourceDetailPage,
  ResourceListPanel,
  ResourceMeta,
  ResourceOptionMenu,
  ResourceOverflowMenu,
  ResourceProperty,
  ResourcePropertyList,
  ResourceRow,
  ResourceSortMenu,
  ResourceSourceItem,
  ResourceSourceShelf,
  ResourceStatus,
  ResourceTabDescription,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import { Icon } from "@bb/shared-ui/icon";
import { PageShell } from "@/components/ui/page-shell.js";
import { CREATE_SKILL_PROMPT } from "@/lib/automation-prompt";
import { CreateWithTemplatesButton } from "@/components/create-via-prompt-examples";
import {
  getProviderIconColorClass,
  getProviderIconInfo,
} from "@/lib/provider-icon";
import {
  getRegistrySkillDetailRoutePath,
  getRegistrySkillsRoutePath,
  getRootComposeRoutePath,
  getSkillDetailRoutePath,
  getSkillsRoutePath,
} from "@/lib/route-paths";
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

const SKILL_PROVIDER_ROUTE_IDS = ["bb", "claude-code", "codex"] as const;

function isSkillScope(
  value: string | undefined,
): value is SkillSummary["scope"] {
  return value !== undefined && value in SCOPE_LABELS;
}

function isSkillProviderRouteId(
  value: string | undefined,
): value is (typeof SKILL_PROVIDER_ROUTE_IDS)[number] {
  return (
    value !== undefined &&
    SKILL_PROVIDER_ROUTE_IDS.some((providerId) => providerId === value)
  );
}

export interface RegistrySkill {
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

export type RegistryScope = "user" | "project";
export type RegistryProvider = "claude-code" | "codex";
const EMPTY_SKILLS: readonly SkillSummary[] = [];
const EMPTY_REGISTRY_PROVIDER_SET = new Set<RegistryProvider>();
const SKILLS_SH_URL = "https://www.skills.sh/";
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

const SCOPE_LABELS: Record<SkillSummary["scope"], string> = {
  "bb-builtin": "Built-in",
  "bb-user": "bb · user",
  "bb-project": "bb · project",
  "claude-user": "Claude · user",
  "claude-project": "Claude · project",
  codex: "Codex",
  plugin: "Plugin",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRegistrySkills(value: unknown): RegistrySkill[] {
  if (!isRecord(value) || !Array.isArray(value.skills)) return [];
  const parsed: RegistrySkill[] = [];
  for (const skill of value.skills) {
    if (!isRecord(skill)) continue;
    const {
      id,
      source,
      skillId,
      name,
      installs,
      stars,
      installUrl,
      url,
      topic,
      summary,
      worksWith,
    } = skill;
    if (
      typeof id !== "string" ||
      typeof source !== "string" ||
      typeof skillId !== "string" ||
      typeof name !== "string" ||
      typeof installs !== "number" ||
      (stars !== undefined && stars !== null && typeof stars !== "number") ||
      (installUrl !== null && typeof installUrl !== "string") ||
      typeof url !== "string" ||
      typeof topic !== "string" ||
      (summary !== null && typeof summary !== "string") ||
      !Array.isArray(worksWith) ||
      !worksWith.every(
        (provider): provider is string => typeof provider === "string",
      )
    ) {
      continue;
    }
    parsed.push({
      id,
      source,
      skillId,
      name,
      installs,
      stars: typeof stars === "number" ? stars : null,
      installUrl,
      url,
      topic,
      summary,
      worksWith,
    });
  }
  return parsed;
}

export async function fetchRegistrySkills(
  query: string,
): Promise<RegistrySkill[]> {
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

export function normalizeSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-");
}

export function formatRegistrySource(source: string): string {
  const githubPrefix = "github.com/";
  return source.startsWith(githubPrefix)
    ? source.slice(githubPrefix.length)
    : source;
}

export function formatInstallCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function providerStatusFromCli(
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

type ResourceProviderFilter = "all" | "bb" | SkillProvider;
type ResourceSortMode = "provider" | "alpha";
type RegistrySkillSortMode = "installs" | "alpha";
type ResourceSortDirection = "asc" | "desc";

const RESOURCE_PROVIDER_FILTERS: readonly ResourceProviderFilter[] = [
  "all",
  "bb",
  "claude-code",
  "codex",
];

function skillProviderFilterId(skill: SkillSummary): ResourceProviderFilter {
  return skill.provider ?? "bb";
}

function providerFilterLabel(provider: ResourceProviderFilter): string {
  if (provider === "all") return "All agents";
  if (provider === "bb") return "bb";
  return providerLabel(provider);
}

function compareNullableProvider(
  left: SkillProvider | null,
  right: SkillProvider | null,
): number {
  return providerLabel(left).localeCompare(providerLabel(right));
}

function applySortDirection(
  result: number,
  direction: ResourceSortDirection,
): number {
  return direction === "asc" ? result : -result;
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

function BbLogo({ className = "size-4" }: { className?: string }) {
  return (
    <img
      src="/bb-mark.svg"
      alt=""
      aria-hidden="true"
      className={cn(className, "object-contain dark:invert")}
    />
  );
}

function SkillLeading({ skill }: { skill: SkillSummary }) {
  if (skill.provider !== null) {
    return <ProviderLogo providerId={skill.provider} className="size-4" />;
  }
  return <BbLogo />;
}

function skillDescription(skill: SkillSummary): string {
  return skill.description ?? SCOPE_LABELS[skill.scope];
}

function SkillRow({
  skill,
  onSelect,
}: {
  skill: SkillSummary;
  onSelect: () => void;
}) {
  const description = skillDescription(skill);
  return (
    <ResourceRow
      leading={<SkillLeading skill={skill} />}
      title={skill.name}
      description={description}
      onOpen={onSelect}
      actions={
        <button
          type="button"
          onClick={onSelect}
          aria-label={`Open ${skill.name}`}
          className="rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon
            name="ChevronRight"
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </button>
      }
    />
  );
}
function registryProviderLabel(providerId: RegistryProvider): string {
  return (
    REGISTRY_PROVIDERS.find((provider) => provider.id === providerId)?.label ??
    providerId
  );
}

function RegistrySkillSocialProof({ skill }: { skill: RegistrySkill }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[11px] leading-none">
      <ResourceCardStat icon="Download">
        {formatInstallCount(skill.installs)} installs
      </ResourceCardStat>
      {skill.stars !== null ? (
        <ResourceCardStat icon="Star">
          {formatInstallCount(skill.stars)} stars
        </ResourceCardStat>
      ) : null}
    </span>
  );
}

function RegistryInstallButton({
  skill,
  installedProviders,
  providerStatus,
  scope,
  pending,
  onScopeChange,
  onInstall,
}: {
  skill: RegistrySkill;
  installedProviders: ReadonlySet<RegistryProvider>;
  providerStatus: Record<RegistryProvider, boolean>;
  scope: RegistryScope;
  pending: boolean;
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
  const primaryProviders = isInstalled
    ? remainingProviders
    : configuredProviders;
  const fullyInstalled = isInstalled && remainingProviders.length === 0;
  const disabled =
    pending || fullyInstalled || configuredProviders.length === 0;
  const label = pending
    ? "Installing"
    : fullyInstalled
      ? "Installed"
      : "Install";
  const primaryProvider = primaryProviders[0];
  const primaryActionLabel =
    primaryProviders.length > 1
      ? "Install on all configured agents"
      : primaryProvider !== undefined
        ? `Install on ${registryProviderLabel(primaryProvider)}`
        : "No configured agents";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          disabled={disabled}
          aria-label={`${skill.name} install options`}
        >
          {label}
          {fullyInstalled ? null : (
            <Icon name="ChevronDown" className="size-3.5" aria-hidden />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-60"
        mobileTitle={`${skill.name} install options`}
      >
        <DropdownMenuItem
          disabled={primaryProviders.length === 0}
          onSelect={() => onInstall(skill, [...primaryProviders])}
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{primaryActionLabel}</span>
            <span className="text-xs text-muted-foreground">{scope} scope</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {(["user", "project"] as const).map((option) => {
          const selected = scope === option;
          return (
            <DropdownMenuItem
              key={option}
              onSelect={(event) => {
                event.preventDefault();
                onScopeChange(option);
              }}
              className="flex items-center justify-between gap-3"
            >
              <span className="capitalize">{option} scope</span>
              <Icon
                name="Check"
                aria-hidden
                className={cn("size-4", selected ? "opacity-100" : "opacity-0")}
              />
            </DropdownMenuItem>
          );
        })}
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
                    : "Not configured"}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RegistrySkillSourceItem({
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
  return (
    <ResourceBrowseCard
      title={skill.name}
      meta={`by ${formatRegistrySource(skill.source)}`}
      description={skill.summary ?? `Works with ${skill.worksWith.join(", ")}.`}
      state={<RegistrySkillSocialProof skill={skill} />}
      onOpen={() => onSelect(skill)}
      action={
        <RegistryInstallButton
          skill={skill}
          installedProviders={installedProviders}
          providerStatus={providerStatus}
          scope={scope}
          pending={pending}
          onScopeChange={onScopeChange}
          onInstall={onInstall}
        />
      }
    />
  );
}

function RegistrySkillLeading({ skill }: { skill: RegistrySkill }) {
  const provider = REGISTRY_PROVIDERS.find((candidate) =>
    skill.worksWith.includes(candidate.id),
  )?.id;
  return provider ? (
    <ProviderLogo providerId={provider} className="size-4" />
  ) : (
    <BbLogo />
  );
}

function SkillsShAttributionLink() {
  return (
    <a
      href={SKILLS_SH_URL}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-sm text-[11px] text-subtle-foreground hover:text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span>powered by skills.sh</span>
    </a>
  );
}

function RegistrySkillsSource({
  skills,
  isLoading,
  hasError,
  scope,
  providerStatus,
  pendingSkillId,
  browseAction,
  onRetry,
  onScopeChange,
  onInstall,
  onSelect,
  getInstalledProviders,
}: {
  skills: readonly RegistrySkill[];
  isLoading: boolean;
  hasError: boolean;
  scope: RegistryScope;
  providerStatus: Record<RegistryProvider, boolean>;
  pendingSkillId: string | null;
  browseAction?: ReactNode;
  onRetry?: () => void;
  onScopeChange: (scope: RegistryScope) => void;
  onInstall: (skill: RegistrySkill, providers: RegistryProvider[]) => void;
  onSelect: (skill: RegistrySkill) => void;
  getInstalledProviders: (
    skill: RegistrySkill,
  ) => ReadonlySet<RegistryProvider>;
}) {
  const availableSkills = useMemo(
    () =>
      skills
        .filter((skill) => getInstalledProviders(skill).size === 0)
        .sort(
          (left, right) =>
            right.installs - left.installs ||
            left.name.localeCompare(right.name),
        ),
    [getInstalledProviders, skills],
  );
  if (hasError) {
    return (
      <EmptyStatePanel role="alert" className="py-6">
        <div className="flex flex-col items-center gap-2">
          <span>Couldn't load skills.sh.</span>
          <SkillsShAttributionLink />
          {onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      </EmptyStatePanel>
    );
  }

  if (isLoading) {
    return (
      <ResourceSourceShelf
        label="Browse"
        leading={<Icon name="Zap" className="size-3.5 shrink-0" aria-hidden />}
        count={<SkillsShAttributionLink />}
      >
        {["w-36", "w-48", "w-28"].map((nameWidth) => (
          <ResourceSourceItem key={nameWidth}>
            <div className="flex items-center gap-1.5 px-3 py-2">
              <Skeleton className="size-4 rounded" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className={cn("h-3.5", nameWidth)} />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-7 w-16" />
            </div>
          </ResourceSourceItem>
        ))}
      </ResourceSourceShelf>
    );
  }

  if (availableSkills.length === 0) return null;

  return (
    <ResourceSourceShelf
      label="Browse"
      leading={<Icon name="Zap" className="size-3.5 shrink-0" aria-hidden />}
      count={<SkillsShAttributionLink />}
      action={browseAction}
    >
      {availableSkills.map((skill) => (
        <ResourceSourceItem key={skill.id}>
          <RegistrySkillSourceItem
            skill={skill}
            installedProviders={getInstalledProviders(skill)}
            providerStatus={providerStatus}
            scope={scope}
            pending={pendingSkillId === skill.id}
            onScopeChange={onScopeChange}
            onInstall={onInstall}
            onSelect={onSelect}
          />
        </ResourceSourceItem>
      ))}
    </ResourceSourceShelf>
  );
}

function RegistrySkillsBrowsePage({
  skills,
  isLoading,
  hasError,
  query,
  scope,
  providerStatus,
  pendingSkillId,
  onRetry,
  onQueryChange,
  onScopeChange,
  onInstall,
  onSelect,
  getInstalledProviders,
}: {
  skills: readonly RegistrySkill[];
  isLoading: boolean;
  hasError: boolean;
  query: string;
  scope: RegistryScope;
  providerStatus: Record<RegistryProvider, boolean>;
  pendingSkillId: string | null;
  onRetry?: () => void;
  onQueryChange: (query: string) => void;
  onScopeChange: (scope: RegistryScope) => void;
  onInstall: (skill: RegistrySkill, providers: RegistryProvider[]) => void;
  onSelect: (skill: RegistrySkill) => void;
  getInstalledProviders: (
    skill: RegistrySkill,
  ) => ReadonlySet<RegistryProvider>;
}) {
  const [sortMode, setSortMode] = useState<RegistrySkillSortMode>("installs");
  const [sortDirection, setSortDirection] =
    useState<ResourceSortDirection>("desc");
  const sortedSkills = useMemo(() => {
    return [...skills].sort((left, right) => {
      const base =
        sortMode === "installs"
          ? left.installs - right.installs ||
            left.name.localeCompare(right.name)
          : left.name.localeCompare(right.name);
      return applySortDirection(base, sortDirection);
    });
  }, [skills, sortDirection, sortMode]);
  const handleSortChange = useCallback(
    (nextSort: string) => {
      if (nextSort !== "installs" && nextSort !== "alpha") return;
      if (nextSort === sortMode) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }
      setSortMode(nextSort);
      setSortDirection(nextSort === "installs" ? "desc" : "asc");
    },
    [sortMode],
  );

  return (
    <div className="space-y-4">
      <ResourceToolbar
        searchValue={query}
        searchPlaceholder="Search skills.sh"
        onSearchChange={onQueryChange}
        controls={
          <ResourceSortMenu
            value={sortMode}
            direction={sortDirection}
            options={[
              { id: "installs", label: "Install count" },
              { id: "alpha", label: "Alphabetical" },
            ]}
            onChange={handleSortChange}
          />
        }
      />
      <div className="flex justify-end px-1">
        <SkillsShAttributionLink />
      </div>
      {hasError ? (
        <EmptyStatePanel role="alert" className="py-6">
          <div className="flex flex-col items-center gap-2">
            <span>Couldn't load skills.sh.</span>
            {onRetry ? (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </div>
        </EmptyStatePanel>
      ) : isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
          {["w-36", "w-44", "w-32", "w-40", "w-28", "w-48"].map((nameWidth) => (
            <div
              key={nameWidth}
              className="min-h-40 rounded-md border border-border bg-background p-3"
            >
              <div className="flex items-center gap-2">
                <Skeleton className="size-9 rounded-md" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className={cn("h-3.5", nameWidth)} />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="mt-4 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-3/4" />
            </div>
          ))}
        </div>
      ) : skills.length === 0 ? (
        <EmptyStatePanel className="py-6">
          {query.trim().length === 0
            ? "No skills.sh resources available."
            : `No skills.sh resources match "${query}"`}
        </EmptyStatePanel>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {sortedSkills.map((skill) => (
            <RegistrySkillSourceItem
              key={skill.id}
              skill={skill}
              installedProviders={getInstalledProviders(skill)}
              providerStatus={providerStatus}
              scope={scope}
              pending={pendingSkillId === skill.id}
              onScopeChange={onScopeChange}
              onInstall={onInstall}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
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
  registryBrowseAction?: ReactNode;
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
  registryBrowseAction,
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
  const [providerFilter, setProviderFilter] =
    useState<ResourceProviderFilter>("all");
  const [sortMode, setSortMode] = useState<ResourceSortMode>("alpha");
  const [sortDirection, setSortDirection] =
    useState<ResourceSortDirection>("asc");
  const normalizedQuery = query.trim().toLowerCase();
  const providerCounts = useMemo(() => {
    const counts = new Map<ResourceProviderFilter, number>();
    for (const skill of skills) {
      const provider = skillProviderFilterId(skill);
      counts.set(provider, (counts.get(provider) ?? 0) + 1);
    }
    return counts;
  }, [skills]);
  const providerBucketCount = providerCounts.size;
  const providerOptions = useMemo(() => {
    return RESOURCE_PROVIDER_FILTERS.map((provider) => ({
      id: provider,
      label: providerFilterLabel(provider),
      disabled: provider !== "all" && !providerCounts.has(provider),
    }));
  }, [providerCounts]);
  useEffect(() => {
    if (providerFilter === "all") return;
    if (!providerCounts.has(providerFilter)) {
      setProviderFilter("all");
    }
  }, [providerCounts, providerFilter]);
  useEffect(() => {
    if (sortMode === "provider" && providerBucketCount <= 1) {
      setSortMode("alpha");
      setSortDirection("asc");
    }
  }, [providerBucketCount, sortMode]);
  const visibleSkills = useMemo(() => {
    const filtered = skills.filter((skill) => {
      if (
        providerFilter !== "all" &&
        skillProviderFilterId(skill) !== providerFilter
      ) {
        return false;
      }
      return (
        normalizedQuery === "" ||
        [
          skill.name,
          skill.description ?? "",
          providerLabel(skill.provider),
          SCOPE_LABELS[skill.scope],
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      );
    });
    return [...filtered].sort((left, right) => {
      const base =
        sortMode === "provider"
          ? compareNullableProvider(left.provider, right.provider) ||
            left.name.localeCompare(right.name)
          : left.name.localeCompare(right.name);
      return applySortDirection(base, sortDirection);
    });
  }, [normalizedQuery, providerFilter, skills, sortDirection, sortMode]);
  const handleSortChange = useCallback(
    (nextSort: string) => {
      if (nextSort !== "provider" && nextSort !== "alpha") return;
      if (nextSort === "provider" && providerBucketCount <= 1) return;
      if (nextSort === sortMode) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }
      setSortMode(nextSort);
      setSortDirection("asc");
    },
    [providerBucketCount, sortMode],
  );
  return (
    <div className="space-y-4">
      <ResourceTabDescription>
        Skills are reusable instructions available to agents in bb. Browse
        installable skills first, then search and manage the skills already
        available in this workspace.
      </ResourceTabDescription>
      <RegistrySkillsSource
        skills={registrySkills}
        isLoading={registryIsLoading}
        hasError={registryHasError}
        scope={registryScope}
        providerStatus={providerStatus}
        pendingSkillId={pendingRegistrySkillId}
        browseAction={registryBrowseAction}
        onRetry={onRetryRegistry}
        onScopeChange={onRegistryScopeChange}
        onInstall={onInstallRegistrySkill}
        onSelect={onSelectRegistrySkill}
        getInstalledProviders={getInstalledProvidersForRegistrySkill}
      />
      <ResourceToolbar
        searchValue={query}
        searchPlaceholder="Search skills"
        onSearchChange={onQueryChange}
        controls={
          <>
            <ResourceOptionMenu
              label="Agent"
              icon="Layers"
              value={providerFilter}
              options={providerOptions}
              onChange={(value) =>
                setProviderFilter(value as ResourceProviderFilter)
              }
            />
            <ResourceSortMenu
              value={sortMode}
              direction={sortDirection}
              options={[
                {
                  id: "provider",
                  label: "Agent",
                  disabled: providerBucketCount <= 1,
                },
                { id: "alpha", label: "Alphabetical" },
              ]}
              onChange={handleSortChange}
            />
          </>
        }
        action={
          <CreateWithTemplatesButton
            kind="skill"
            label="New bb skill"
            onCreate={onCreateSkill}
          />
        }
      />
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
      ) : visibleSkills.length === 0 ? (
        normalizedQuery === "" && providerFilter === "all" ? null : (
          <EmptyStatePanel className="py-6">
            {normalizedQuery === ""
              ? "No skills match this agent."
              : `No skills match "${query}"`}
          </EmptyStatePanel>
        )
      ) : (
        <ResourceListPanel>
          {visibleSkills.map((skill) => (
            <SkillRow
              key={`${skill.scope}-${skill.provider ?? "bb"}-${skill.name}-${skill.filePath}`}
              skill={skill}
              onSelect={() => onSelectSkill(skill)}
            />
          ))}
        </ResourceListPanel>
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
  onScopeChange,
  onInstall,
}: {
  skill: RegistrySkill;
  installedProviders: ReadonlySet<RegistryProvider>;
  providerStatus: Record<RegistryProvider, boolean>;
  scope: RegistryScope;
  pending: boolean;
  onScopeChange: (scope: RegistryScope) => void;
  onInstall: (skill: RegistrySkill, providers: RegistryProvider[]) => void;
}) {
  return (
    <ResourceDetailPage
      leading={<RegistrySkillLeading skill={skill} />}
      title={skill.name}
      status={<RegistrySkillSocialProof skill={skill} />}
      meta={
        <ResourceMeta
          items={["skills.sh", formatRegistrySource(skill.source), skill.topic]}
        />
      }
      description={skill.summary}
      actions={
        <RegistryInstallButton
          skill={skill}
          installedProviders={installedProviders}
          providerStatus={providerStatus}
          scope={scope}
          pending={pending}
          onScopeChange={onScopeChange}
          onInstall={onInstall}
        />
      }
    >
      <section className="space-y-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">
          Details
        </p>
        <ResourcePropertyList>
          <ResourceProperty label="Installs">
            {formatInstallCount(skill.installs)}
          </ResourceProperty>
          {skill.stars !== null ? (
            <ResourceProperty label="GitHub stars">
              {formatInstallCount(skill.stars)}
            </ResourceProperty>
          ) : null}
          <ResourceProperty label="Works with">
            {skill.worksWith.join(", ")}
          </ResourceProperty>
          {installedProviders.size > 0 ? (
            <ResourceProperty label="Installed on">
              {[...installedProviders].map(registryProviderLabel).join(", ")}
            </ResourceProperty>
          ) : null}
        </ResourcePropertyList>
      </section>
    </ResourceDetailPage>
  );
}

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
  /**
   * Persist edited content. Resolves `true` when the save succeeded so the view
   * leaves edit mode; `false` keeps the draft for retry.
   */
  onSave: (content: string) => Promise<boolean>;
  onDelete: () => void;
  onOpenInEditor: () => void;
}

function SkillPathCopyButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      appToast.error("Failed to copy path.");
    }
  }, [path]);

  return (
    <button
      type="button"
      title={copied ? "Copied path" : "Copy path"}
      aria-label={`Copy skill path: ${path}`}
      onClick={handleCopy}
      className="group inline-flex max-w-full items-center gap-1 rounded-sm text-xs text-subtle-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className="truncate font-mono">{path}</span>
      <Icon
        name={copied ? "Check" : "Copy"}
        className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        aria-hidden
      />
    </button>
  );
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

  const actionRow = editing ? (
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
  const detailStatusLabel =
    skill.scope === "bb-builtin"
      ? "Built-in"
      : canManage
        ? "Editable"
        : "Read-only";
  const headerActions =
    !editing && !confirmingDelete && (canManage || canOpenInEditor) ? (
      <ResourceOverflowMenu
        label={`${skill.name} actions`}
        items={[
          ...(canManage
            ? [
                {
                  label: "Edit",
                  icon: "Edit" as const,
                  disabled: isLoadingContent,
                  onSelect: startEditing,
                },
              ]
            : []),
          ...(canOpenInEditor
            ? [
                {
                  label: "Open in editor",
                  icon: "ExternalLink" as const,
                  onSelect: onOpenInEditor,
                },
              ]
            : []),
          ...(canManage
            ? [
                { kind: "separator" as const },
                {
                  label: "Delete",
                  icon: "Trash2" as const,
                  tone: "destructive" as const,
                  onSelect: () => setConfirmingDelete(true),
                },
              ]
            : []),
        ]}
      />
    ) : null;
  const contentBody = isContentError ? (
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
  );

  return (
    <ResourceDetailPage
      leading={<SkillLeading skill={skill} />}
      title={skill.name}
      status={
        <ResourceStatus tone={canManage ? "success" : "muted"}>
          {detailStatusLabel}
        </ResourceStatus>
      }
      headerActions={headerActions}
      meta={<SkillPathCopyButton path={skill.filePath} />}
      actions={actionRow}
    >
      <section className="space-y-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">
          SKILL.md
        </p>
        {contentBody}
        {editing || confirmingDelete ? (
          <span className="sr-only">Skill edit mode is active.</span>
        ) : null}
      </section>

      {confirmingDelete && !editing ? (
        <p className="text-xs text-muted-foreground">
          This deletes the local skill file from the selected scope.
        </p>
      ) : null}
    </ResourceDetailPage>
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
  const location = useLocation();
  const {
    scope: routeScope,
    providerId: routeProviderId,
    skillName: routeSkillName,
    registrySkillId: routeRegistrySkillId,
  } = useParams<{
    scope?: string;
    providerId?: string;
    skillName?: string;
    registrySkillId?: string;
  }>();
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
  const selectedSkill = useMemo(() => {
    if (
      !isSkillScope(routeScope) ||
      !isSkillProviderRouteId(routeProviderId) ||
      routeSkillName === undefined
    ) {
      return null;
    }
    const provider = routeProviderId === "bb" ? null : routeProviderId;
    return (
      skills.find(
        (skill) =>
          skill.scope === routeScope &&
          skill.provider === provider &&
          skill.name === routeSkillName,
      ) ?? null
    );
  }, [routeProviderId, routeScope, routeSkillName, skills]);
  const selectedRegistrySkill = useMemo(() => {
    if (routeRegistrySkillId === undefined) {
      return null;
    }
    return (
      (registryQuery.data ?? []).find(
        (skill) =>
          skill.id === routeRegistrySkillId ||
          skill.skillId === routeRegistrySkillId,
      ) ?? null
    );
  }, [registryQuery.data, routeRegistrySkillId]);
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
  const openSkill = useCallback(
    (skill: SkillSummary) => {
      navigate(
        getSkillDetailRoutePath({
          scope: skill.scope,
          providerId: skill.provider,
          skillName: skill.name,
        }),
      );
    },
    [navigate],
  );
  const openRegistrySkill = useCallback(
    (skill: RegistrySkill) => {
      navigate(getRegistrySkillDetailRoutePath({ registrySkillId: skill.id }));
    },
    [navigate],
  );
  const closeSkillDetail = useCallback(() => {
    navigate(getSkillsRoutePath());
  }, [navigate]);
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
  const isRegistryBrowseRoute =
    location.pathname === getRegistrySkillsRoutePath();
  return (
    <>
      {selectedSkill ? (
        <SkillDetailPage
          projectId={PERSONAL_PROJECT_ID}
          skill={selectedSkill}
          onClose={closeSkillDetail}
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
          onScopeChange={setRegistryScope}
          onInstall={installRegistry}
        />
      ) : isRegistryBrowseRoute ? (
        <RegistrySkillsBrowsePage
          skills={registryQuery.data ?? []}
          isLoading={
            registryQuery.isFetching && registryQuery.data === undefined
          }
          hasError={registryQuery.isError}
          query={query}
          scope={registryScope}
          providerStatus={providerStatus}
          pendingSkillId={pendingRegistrySkillId}
          onRetry={() => void registryQuery.refetch()}
          onQueryChange={setQuery}
          onScopeChange={setRegistryScope}
          onInstall={installRegistry}
          onSelect={openRegistrySkill}
          getInstalledProviders={installedProvidersForRegistrySkill}
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
          registryBrowseAction={
            <Button asChild variant="ghost" size="sm" className="h-6 px-2">
              <Link to={getRegistrySkillsRoutePath()}>
                See all
                <Icon name="ChevronRight" className="size-3.5" aria-hidden />
              </Link>
            </Button>
          }
          onCreateSkill={handleCreateSkill}
          onSelectSkill={openSkill}
          onSelectRegistrySkill={openRegistrySkill}
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
