import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SkillProvider, SkillSummary } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { appToast } from "@/components/ui/app-toast";
import { OverflowFade } from "@/components/ui/overflow-fade";
import { FilePreview } from "@/components/secondary-panel/FilePreview.js";
import {
  ResourceActionButton,
  ResourceBrowseCard,
  ResourceCardStat,
  ResourceDetailPage,
  ResourceDetailSection,
  ResourceListPanel,
  ResourceListState,
  ResourceMeta,
  ResourceMultiSelectMenu,
  ResourceOverflowMenu,
  ResourceProperty,
  ResourcePropertyList,
  ResourceRow,
  ResourceSectionTitle,
  ResourceShelfSeeAllAction,
  ResourceSortMenu,
  ResourceSourceItem,
  ResourceSourceShelf,
  ResourceStatus,
  ResourceTabDescription,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import { Icon } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { PageShell } from "@/components/ui/page-shell.js";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
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
import {
  useDeleteSkill,
  useProjectSkills,
  useSkillContent,
  useUpdateSkill,
} from "@/hooks/queries/skills-queries";
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

export interface RegistryPagination {
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
}

export interface RegistrySkillsPage {
  skills: RegistrySkill[];
  pagination: RegistryPagination;
}

export type RegistryProvider = "claude-code" | "codex";
const EMPTY_SKILLS: readonly SkillSummary[] = [];
const NOOP = () => {};
const REGISTRY_PAGE_SIZE = 24;
const EMPTY_REGISTRY_PAGINATION: RegistryPagination = {
  page: 0,
  perPage: REGISTRY_PAGE_SIZE,
  total: 0,
  hasMore: false,
};
const SKILLS_SH_URL = "https://www.skills.sh/";

const REGISTRY_PROVIDERS = [
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
] as const satisfies readonly {
  id: RegistryProvider;
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

export async function fetchRegistrySkills(args: {
  query: string;
  page: number;
  perPage?: number;
}): Promise<RegistrySkillsPage> {
  const params = new URLSearchParams();
  if (args.query.trim().length > 0) params.set("q", args.query.trim());
  params.set("page", String(args.page));
  params.set("perPage", String(args.perPage ?? REGISTRY_PAGE_SIZE));
  const response = await fetch(`/api/v1/skills-registry?${params.toString()}`);
  if (!response.ok) throw new Error("Failed to load skills registry");
  const body = await response.json();
  if (!isRecord(body) || !isRecord(body.pagination)) {
    throw new Error("Invalid skills registry response");
  }
  const { page, perPage, total, hasMore } = body.pagination;
  if (
    typeof page !== "number" ||
    !Number.isInteger(page) ||
    page < 0 ||
    typeof perPage !== "number" ||
    !Number.isInteger(perPage) ||
    perPage < 1 ||
    typeof total !== "number" ||
    !Number.isInteger(total) ||
    total < 0 ||
    typeof hasMore !== "boolean"
  ) {
    throw new Error("Invalid skills registry pagination");
  }
  return {
    skills: parseRegistrySkills(body),
    pagination: { page, perPage, total, hasMore },
  };
}

export async function installRegistrySkill(args: { skill: RegistrySkill }) {
  const response = await fetch("/api/v1/skills-registry/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: args.skill.source,
      skillId: args.skill.skillId,
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

function providerLabel(providerId: SkillProvider | null): string {
  if (providerId === null) {
    return "bb";
  }
  return getProviderIconInfo(providerId)?.ariaLabel ?? providerId;
}

type ResourceProviderFilter = "bb" | SkillProvider;
type ResourceSortMode = "provider" | "alpha";
type RegistrySkillSortMode = "installs" | "stars" | "alpha";
type ResourceSortDirection = "asc" | "desc";

const RESOURCE_PROVIDER_FILTERS: readonly ResourceProviderFilter[] = [
  "bb",
  "claude-code",
  "codex",
];

function skillProviderFilterId(skill: SkillSummary): ResourceProviderFilter {
  return skill.provider ?? "bb";
}

function providerFilterLabel(provider: ResourceProviderFilter): string {
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
  onEdit,
  onDelete,
}: {
  skill: SkillSummary;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const description = skillDescription(skill);
  const showDisabledManageActions = !skill.manageable;
  const hasManageActions = Boolean(
    onEdit || onDelete || showDisabledManageActions,
  );
  const readOnlyReason =
    skill.scope === "bb-builtin"
      ? "Built-in skill"
      : skill.provider !== null
        ? `Managed by ${providerLabel(skill.provider)}`
        : "Read-only skill";
  const actions = hasManageActions ? (
    <>
      {onEdit || showDisabledManageActions ? (
        <ResourceActionButton
          label={`Edit ${skill.name}`}
          icon="Edit"
          disabled={!onEdit}
          disabledReason={!onEdit ? readOnlyReason : undefined}
          onClick={onEdit ?? NOOP}
        />
      ) : null}
      {onDelete || showDisabledManageActions ? (
        <ResourceActionButton
          label={`Delete ${skill.name}`}
          icon="Trash2"
          tone="destructive"
          disabled={!onDelete}
          disabledReason={!onDelete ? readOnlyReason : undefined}
          onClick={onDelete ?? NOOP}
        />
      ) : null}
    </>
  ) : undefined;
  return (
    <ResourceRow
      leading={<SkillLeading skill={skill} />}
      title={skill.name}
      description={description}
      onOpen={onSelect}
      actions={actions}
      trailingVisual={
        <Icon
          name="ChevronRight"
          className="size-4 text-muted-foreground/65 transition-[color,transform] duration-150 ease-out group-hover:translate-x-1 group-hover:text-foreground group-focus-within:translate-x-1 group-focus-within:text-foreground"
          aria-hidden
        />
      }
    />
  );
}
function RegistrySkillSocialProof({ skill }: { skill: RegistrySkill }) {
  const installs = formatInstallCount(skill.installs);
  const stars = skill.stars !== null ? formatInstallCount(skill.stars) : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[11px] leading-none">
      <ResourceCardStat
        icon="Download"
        iconClassName="text-success"
        accessibleLabel={`${installs} installs`}
      >
        {installs}
      </ResourceCardStat>
      {stars !== null ? (
        <ResourceCardStat
          icon="Star"
          iconClassName="fill-attention/20 text-attention"
          accessibleLabel={`${stars} stars`}
        >
          {stars}
        </ResourceCardStat>
      ) : null}
    </span>
  );
}

function RegistryInstallButton({
  skill,
  installed,
  pending,
  onInstall,
}: {
  skill: RegistrySkill;
  installed: boolean;
  pending: boolean;
  onInstall: (skill: RegistrySkill) => void;
}) {
  if (installed) {
    return (
      <span
        aria-label={`Installed ${skill.name} as a bb skill`}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-surface-recessed-soft-solid px-2 text-xs text-muted-foreground"
      >
        <Icon name="Download" className="size-3.5 text-success" aria-hidden />
        Installed
      </span>
    );
  }
  const label = pending ? "Installing" : "Install";

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 shrink-0 bg-transparent px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
      disabled={pending}
      aria-label={`${label} ${skill.name} as a bb skill`}
      onClick={() => onInstall(skill)}
    >
      <Icon
        name="Download"
        className="size-3.5 text-muted-foreground"
        aria-hidden
      />
      {label}
    </Button>
  );
}

function RegistrySkillSourceItem({
  skill,
  installed,
  onInstall,
  onSelect,
  pending,
}: {
  skill: RegistrySkill;
  installed: boolean;
  onInstall: (skill: RegistrySkill) => void;
  onSelect: (skill: RegistrySkill) => void;
  pending: boolean;
}) {
  return (
    <ResourceBrowseCard
      title={skill.name}
      byline={`by ${formatRegistrySource(skill.source)}`}
      description={skill.summary ?? `Works with ${skill.worksWith.join(", ")}.`}
      openLabel={`View details for ${skill.name}`}
      onOpen={() => onSelect(skill)}
      headerAction={
        <RegistryInstallButton
          skill={skill}
          installed={installed}
          pending={pending}
          onInstall={onInstall}
        />
      }
      footerMeta={<RegistrySkillSocialProof skill={skill} />}
    />
  );
}

function RegistrySkillRow({
  skill,
  installed,
  pending,
  onInstall,
  onSelect,
}: {
  skill: RegistrySkill;
  installed: boolean;
  pending: boolean;
  onInstall: (skill: RegistrySkill) => void;
  onSelect: (skill: RegistrySkill) => void;
}) {
  return (
    <ResourceRow
      leading={<RegistrySkillLeading skill={skill} />}
      title={skill.name}
      description={
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="shrink-0">
            by {formatRegistrySource(skill.source)}
          </span>
          <span aria-hidden>·</span>
          <span className="truncate">
            {skill.summary ?? `Works with ${skill.worksWith.join(", ")}.`}
          </span>
        </span>
      }
      state={<RegistrySkillSocialProof skill={skill} />}
      onOpen={() => onSelect(skill)}
      actionsVisibility="always"
      actions={
        <RegistryInstallButton
          skill={skill}
          installed={installed}
          pending={pending}
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
      className="inline-flex items-center gap-1 rounded-sm text-[11px] text-subtle-foreground/65 hover:text-subtle-foreground/90 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className="font-mono">skills.sh</span>
    </a>
  );
}

function RegistrySkillsSource({
  skills,
  isLoading,
  hasError,
  pendingSkillId,
  browseAction,
  onRetry,
  onInstall,
  onSelect,
  isInstalled,
}: {
  skills: readonly RegistrySkill[];
  isLoading: boolean;
  hasError: boolean;
  pendingSkillId: string | null;
  browseAction?: ReactNode;
  onRetry?: () => void;
  onInstall: (skill: RegistrySkill) => void;
  onSelect: (skill: RegistrySkill) => void;
  isInstalled: (skill: RegistrySkill) => boolean;
}) {
  const visibleSkills = useMemo(
    () =>
      [...skills].sort(
        (left, right) =>
          right.installs - left.installs || left.name.localeCompare(right.name),
      ),
    [skills],
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
        attribution={<SkillsShAttributionLink />}
      >
        {["w-36", "w-48", "w-28"].map((nameWidth) => (
          <ResourceSourceItem key={nameWidth}>
            <div className="flex items-center gap-[var(--resource-source-shelf-label-gap)] p-[var(--resource-source-shelf-inset)]">
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

  if (visibleSkills.length === 0) return null;

  return (
    <ResourceSourceShelf
      label="Browse"
      attribution={<SkillsShAttributionLink />}
      browseAction={browseAction}
      scrollOverlay={
        visibleSkills.length > 3 ? (
          <OverflowFade
            placement="right"
            tone="recessed"
            className="w-[var(--resource-source-shelf-fade-ramp)]"
          />
        ) : undefined
      }
    >
      {visibleSkills.map((skill) => (
        <ResourceSourceItem key={skill.id}>
          <RegistrySkillSourceItem
            skill={skill}
            installed={isInstalled(skill)}
            pending={pendingSkillId === skill.id}
            onInstall={onInstall}
            onSelect={onSelect}
          />
        </ResourceSourceItem>
      ))}
    </ResourceSourceShelf>
  );
}

export function RegistrySkillsBrowsePage({
  skills,
  pagination,
  isLoading,
  hasError,
  query,
  pendingSkillId,
  onRetry,
  onQueryChange,
  onPageChange,
  onInstall,
  onSelect,
  isInstalled,
}: {
  skills: readonly RegistrySkill[];
  pagination: RegistryPagination;
  isLoading: boolean;
  hasError: boolean;
  query: string;
  pendingSkillId: string | null;
  onRetry?: () => void;
  onQueryChange: (query: string) => void;
  onPageChange: (page: number) => void;
  onInstall: (skill: RegistrySkill) => void;
  onSelect: (skill: RegistrySkill) => void;
  isInstalled: (skill: RegistrySkill) => boolean;
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
          : sortMode === "stars"
            ? (left.stars ?? -1) - (right.stars ?? -1) ||
              left.name.localeCompare(right.name)
            : left.name.localeCompare(right.name);
      return applySortDirection(base, sortDirection);
    });
  }, [skills, sortDirection, sortMode]);
  const handleSortChange = useCallback(
    (nextSort: string) => {
      if (
        nextSort !== "installs" &&
        nextSort !== "stars" &&
        nextSort !== "alpha"
      ) {
        return;
      }
      if (nextSort === sortMode) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }
      setSortMode(nextSort);
      setSortDirection(nextSort === "alpha" ? "asc" : "desc");
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
              { id: "stars", label: "Stars" },
              { id: "alpha", label: "Skill name" },
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
        <ResourceListState
          state="loading"
          message="Loading skills.sh skills"
          loadingRows={REGISTRY_PAGE_SIZE}
        />
      ) : skills.length === 0 ? (
        <EmptyStatePanel className="py-6">
          {query.trim().length === 0
            ? "No skills.sh resources available."
            : `No skills.sh resources match "${query}"`}
        </EmptyStatePanel>
      ) : (
        <ResourceListPanel maxHeightClassName="max-h-none">
          {sortedSkills.map((skill) => (
            <RegistrySkillRow
              key={skill.id}
              skill={skill}
              installed={isInstalled(skill)}
              pending={pendingSkillId === skill.id}
              onInstall={onInstall}
              onSelect={onSelect}
            />
          ))}
        </ResourceListPanel>
      )}
      {pagination.total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <span className="text-xs text-subtle-foreground">
            {pagination.page * pagination.perPage + 1}–
            {Math.min(
              pagination.page * pagination.perPage + skills.length,
              pagination.total,
            )}{" "}
            of {pagination.total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pagination.page === 0}
              onClick={() => onPageChange(pagination.page - 1)}
            >
              <Icon name="ChevronLeft" aria-hidden />
              Previous
            </Button>
            <span className="min-w-20 text-center text-xs text-muted-foreground">
              Page {pagination.page + 1}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!pagination.hasMore}
              onClick={() => onPageChange(pagination.page + 1)}
            >
              Next
              <Icon name="ChevronRight" aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
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
  pendingRegistrySkillId?: string | null;
  registryBrowseAction?: ReactNode;
  /** Opens the composer to create a skill, optionally seeded with a full prompt. */
  onCreateSkill: (prompt?: string) => void;
  onSelectSkill: (skill: SkillSummary) => void;
  onEditSkill?: (skill: SkillSummary) => void;
  onDeleteSkill?: (skill: SkillSummary) => void;
  onSelectRegistrySkill?: (skill: RegistrySkill) => void;
  onQueryChange?: (query: string) => void;
  onInstallRegistrySkill?: (skill: RegistrySkill) => void;
  isRegistrySkillInstalled?: (skill: RegistrySkill) => boolean;
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
  pendingRegistrySkillId = null,
  registryBrowseAction,
  onCreateSkill,
  onSelectSkill,
  onEditSkill,
  onDeleteSkill,
  onSelectRegistrySkill = () => {},
  onQueryChange = () => {},
  onInstallRegistrySkill = () => {},
  isRegistrySkillInstalled = () => false,
  onRetry,
  onRetryRegistry,
}: SkillsOverviewProps) {
  const [providerFilters, setProviderFilters] = useState<
    ResourceProviderFilter[]
  >([]);
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
      disabled: !providerCounts.has(provider),
    }));
  }, [providerCounts]);
  useEffect(() => {
    setProviderFilters((current) =>
      current.filter((provider) => providerCounts.has(provider)),
    );
  }, [providerCounts]);
  useEffect(() => {
    if (sortMode === "provider" && providerBucketCount <= 1) {
      setSortMode("alpha");
      setSortDirection("asc");
    }
  }, [providerBucketCount, sortMode]);
  const visibleSkills = useMemo(() => {
    const filtered = skills.filter((skill) => {
      if (
        providerFilters.length > 0 &&
        !providerFilters.includes(skillProviderFilterId(skill))
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
  }, [normalizedQuery, providerFilters, skills, sortDirection, sortMode]);
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
        Manage skills from bb and your configured agents. bb skills work across
        every agent you use in bb.
      </ResourceTabDescription>
      <RegistrySkillsSource
        skills={registrySkills}
        isLoading={registryIsLoading}
        hasError={registryHasError}
        pendingSkillId={pendingRegistrySkillId}
        browseAction={registryBrowseAction}
        onRetry={onRetryRegistry}
        onInstall={onInstallRegistrySkill}
        onSelect={onSelectRegistrySkill}
        isInstalled={isRegistrySkillInstalled}
      />
      <section aria-labelledby="installed-skills-heading" className="space-y-2">
        <ResourceSectionTitle id="installed-skills-heading" className="px-3">
          Installed skills
        </ResourceSectionTitle>
        <ResourceToolbar
          searchValue={query}
          searchPlaceholder="Search skills"
          onSearchChange={onQueryChange}
          controlsClassName="h-8 gap-0.5 rounded-md bg-surface-recessed p-0.5 [&>button]:size-7 [&>button]:rounded-sm"
          controls={
            <>
              <ResourceMultiSelectMenu
                label="Agent"
                icon="Layers"
                selectedValues={providerFilters}
                options={providerOptions}
                onChange={(values) =>
                  setProviderFilters(values as ResourceProviderFilter[])
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
                  { id: "alpha", label: "Skill name" },
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
          <ResourceListState
            state="error"
            message="Couldn't load skills."
            onRetry={onRetry}
          />
        ) : isLoading ? (
          <ResourceListState state="loading" message="Loading skills" />
        ) : visibleSkills.length === 0 ? (
          <ResourceListState
            state="empty"
            message={
              normalizedQuery === "" && providerFilters.length === 0
                ? "No skills installed."
                : normalizedQuery === ""
                  ? "No skills match these agents."
                  : `No skills match "${query}"`
            }
          />
        ) : (
          <ResourceListPanel>
            {visibleSkills.map((skill) => (
              <SkillRow
                key={`${skill.scope}-${skill.provider ?? "bb"}-${skill.name}-${skill.filePath}`}
                skill={skill}
                onSelect={() => onSelectSkill(skill)}
                onEdit={
                  skill.manageable && onEditSkill
                    ? () => onEditSkill(skill)
                    : undefined
                }
                onDelete={
                  skill.manageable && onDeleteSkill
                    ? () => onDeleteSkill(skill)
                    : undefined
                }
              />
            ))}
          </ResourceListPanel>
        )}
      </section>
    </div>
  );
}

function RegistrySkillDetailView({
  skill,
  installed,
  pending,
  onInstall,
}: {
  skill: RegistrySkill;
  installed: boolean;
  pending: boolean;
  onInstall: (skill: RegistrySkill) => void;
}) {
  return (
    <ResourceDetailPage
      leading={<RegistrySkillLeading skill={skill} />}
      title={skill.name}
      info={<RegistrySkillSocialProof skill={skill} />}
      metadata={
        <ResourceMeta
          items={["skills.sh", formatRegistrySource(skill.source), skill.topic]}
        />
      }
      description={skill.summary}
      modeActions={
        <RegistryInstallButton
          skill={skill}
          installed={installed}
          pending={pending}
          onInstall={onInstall}
        />
      }
    >
      <ResourceDetailSection label="Details">
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
          {installed ? (
            <ResourceProperty label="Installed as">
              bb user skill
            </ResourceProperty>
          ) : null}
        </ResourcePropertyList>
      </ResourceDetailSection>
    </ResourceDetailPage>
  );
}

export interface SkillDetailDialogViewProps {
  skill: SkillSummary | null;
  /** Already-fetched SKILL.md source. */
  content: string;
  isLoadingContent: boolean;
  /** A background refetch is checking for out-of-band SKILL.md changes. */
  isRefreshingContent: boolean;
  isContentError: boolean;
  /** Expose inline Edit + Delete (manageable bb user/project skills only). */
  canManage: boolean;
  canOpenInEditor: boolean;
  initiallyEditing?: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  /** Clears one-shot route state after overview-row Edit enters edit mode. */
  onInitialEditStarted?: () => void;
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
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Copy skill path: ${path}`}
            onClick={handleCopy}
            className="group -ml-1.5 inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="truncate font-mono">{path}</span>
            <Icon
              name={copied ? "Check" : "Copy"}
              className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              aria-hidden
            />
          </button>
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied" : "Copy path"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
  isRefreshingContent,
  isContentError,
  canManage,
  canOpenInEditor,
  initiallyEditing = false,
  isSaving,
  isDeleting,
  onInitialEditStarted = () => {},
  onSave,
  onDelete,
  onOpenInEditor,
}: SkillDetailDialogViewProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const initialEditConsumedRef = useRef<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setConfirmingDelete(false);
    initialEditConsumedRef.current = null;
  }, [skill?.scope, skill?.name, skill?.provider]);

  useEffect(() => {
    if (
      !initiallyEditing ||
      !canManage ||
      skill === null ||
      isLoadingContent ||
      isRefreshingContent ||
      isContentError
    ) {
      return;
    }
    const editKey = `${skill.scope}:${skill.provider ?? "bb"}:${skill.name}`;
    if (initialEditConsumedRef.current === editKey) return;
    initialEditConsumedRef.current = editKey;
    setConfirmingDelete(false);
    setDraft(content);
    setEditing(true);
    onInitialEditStarted();
  }, [
    canManage,
    content,
    initiallyEditing,
    isContentError,
    isLoadingContent,
    isRefreshingContent,
    onInitialEditStarted,
    skill,
  ]);

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

  const sectionActions = editing ? (
    <>
      <ResourceActionButton
        label="Cancel editing"
        icon="X"
        disabled={isSaving}
        onClick={() => setEditing(false)}
      />
      <ResourceActionButton
        label="Save skill"
        icon="Check"
        disabled={isSaving || isLoadingContent}
        onClick={handleSave}
      />
    </>
  ) : undefined;

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
                  disabled: isLoadingContent || isRefreshingContent,
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
          textPreviewKind: "markdown",
        }}
      />
    </div>
  );

  return (
    <ResourceDetailPage
      leading={<SkillLeading skill={skill} />}
      title={skill.name}
      info={
        <ResourceStatus tone={canManage ? "success" : "muted"}>
          {detailStatusLabel}
        </ResourceStatus>
      }
      overflowMenu={headerActions}
      metadata={<SkillPathCopyButton path={skill.filePath} />}
    >
      <ResourceDetailSection label="SKILL.md" actions={sectionActions}>
        {contentBody}
        {editing ? (
          <span className="sr-only">Skill edit mode is active.</span>
        ) : null}
      </ResourceDetailSection>
      <ConfirmDeleteDialog
        open={confirmingDelete}
        onOpenChange={(open) => {
          if (!isDeleting) setConfirmingDelete(open);
        }}
      >
        <ConfirmDeleteDialogContent
          title="Delete skill?"
          description={`Delete "${skill.name}" from its bb scope? This cannot be undone.`}
          confirmLabel="Delete skill"
          pending={isDeleting}
          onConfirm={onDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      </ConfirmDeleteDialog>
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
  initiallyEditing = false,
  onInitialEditStarted,
}: {
  projectId: string;
  skill: SkillSummary | null;
  onClose: () => void;
  initiallyEditing?: boolean;
  onInitialEditStarted?: () => void;
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
      isRefreshingContent={contentQuery.isFetching}
      isContentError={contentQuery.isError}
      canManage={skill?.manageable === true && deletableScope !== null}
      canOpenInEditor={skill !== null && canOpenPreferredFileTarget}
      initiallyEditing={initiallyEditing}
      isSaving={updateSkill.isPending}
      isDeleting={deleteSkill.isPending}
      onInitialEditStarted={onInitialEditStarted}
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
  const [registryPage, setRegistryPage] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<SkillSummary | null>(null);
  const [confirmedRegistryInstalls, setConfirmedRegistryInstalls] = useState<
    Set<string>
  >(() => new Set());
  const skillsQuery = useProjectSkills(PERSONAL_PROJECT_ID);
  const deleteSkill = useDeleteSkill(PERSONAL_PROJECT_ID);
  const skills = skillsQuery.data?.skills ?? EMPTY_SKILLS;
  const hasError = skillsQuery.isError && skillsQuery.data === undefined;
  const isLoading =
    skillsQuery.isFetching && skillsQuery.data === undefined && !hasError;
  const isRegistryBrowseRoute =
    location.pathname === getRegistrySkillsRoutePath();
  const registryRequestPage =
    isRegistryBrowseRoute || routeRegistrySkillId !== undefined
      ? registryPage
      : 0;
  const registryQuery = useQuery({
    queryKey: ["skills-registry", query.trim(), registryRequestPage],
    queryFn: () =>
      fetchRegistrySkills({
        query,
        page: registryRequestPage,
        perPage: REGISTRY_PAGE_SIZE,
      }),
    staleTime: 60_000,
  });
  const registryInstall = useMutation({
    mutationFn: installRegistrySkill,
    onSuccess: (_result, variables) => {
      setConfirmedRegistryInstalls((current) => {
        const next = new Set(current);
        next.add(variables.skill.id);
        return next;
      });
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
      (registryQuery.data?.skills ?? []).find(
        (skill) =>
          skill.id === routeRegistrySkillId ||
          skill.skillId === routeRegistrySkillId,
      ) ?? null
    );
  }, [registryQuery.data, routeRegistrySkillId]);
  const isRegistrySkillInstalled = useCallback(
    (skill: RegistrySkill): boolean => {
      const names = new Set([
        normalizeSkillName(skill.skillId),
        normalizeSkillName(skill.name),
      ]);
      return (
        confirmedRegistryInstalls.has(skill.id) ||
        skills.some(
          (installedSkill) =>
            installedSkill.scope === "bb-user" &&
            installedSkill.provider === null &&
            names.has(normalizeSkillName(installedSkill.name)),
        )
      );
    },
    [confirmedRegistryInstalls, skills],
  );
  const installRegistry = useCallback(
    (skill: RegistrySkill) => {
      registryInstall.mutate({ skill });
    },
    [registryInstall],
  );
  const openSkill = useCallback(
    (skill: SkillSummary, options?: { editing?: boolean }) => {
      navigate(
        getSkillDetailRoutePath({
          scope: skill.scope,
          providerId: skill.provider,
          skillName: skill.name,
        }),
        options?.editing ? { state: { editSkill: true } } : undefined,
      );
    },
    [navigate],
  );
  const openRegistrySkill = useCallback(
    (skill: RegistrySkill) => {
      if (!isRegistryBrowseRoute) setRegistryPage(0);
      navigate(getRegistrySkillDetailRoutePath({ registrySkillId: skill.id }));
    },
    [isRegistryBrowseRoute, navigate],
  );
  const handleRegistryQueryChange = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
    setRegistryPage(0);
  }, []);
  const closeSkillDetail = useCallback(() => {
    navigate(getSkillsRoutePath());
  }, [navigate]);
  const confirmDeleteSkill = useCallback(() => {
    if (
      deleteTarget === null ||
      (deleteTarget.scope !== "bb-user" && deleteTarget.scope !== "bb-project")
    ) {
      return;
    }
    deleteSkill.mutate(
      {
        scope: deleteTarget.scope,
        name: deleteTarget.name,
        environmentId: null,
      },
      {
        onSuccess: () => {
          appToast.success("Skill deleted");
          setDeleteTarget(null);
        },
      },
    );
  }, [deleteSkill, deleteTarget]);
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
  const initiallyEditingSelectedSkill =
    typeof location.state === "object" &&
    location.state !== null &&
    "editSkill" in location.state &&
    location.state.editSkill === true;
  const clearInitialEditState = useCallback(() => {
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, navigate]);
  return (
    <>
      {selectedSkill ? (
        <SkillDetailPage
          projectId={PERSONAL_PROJECT_ID}
          skill={selectedSkill}
          onClose={closeSkillDetail}
          initiallyEditing={initiallyEditingSelectedSkill}
          onInitialEditStarted={clearInitialEditState}
        />
      ) : selectedRegistrySkill ? (
        <RegistrySkillDetailView
          skill={selectedRegistrySkill}
          installed={isRegistrySkillInstalled(selectedRegistrySkill)}
          pending={pendingRegistrySkillId === selectedRegistrySkill.id}
          onInstall={installRegistry}
        />
      ) : isRegistryBrowseRoute ? (
        <RegistrySkillsBrowsePage
          skills={registryQuery.data?.skills ?? []}
          pagination={
            registryQuery.data?.pagination ?? {
              ...EMPTY_REGISTRY_PAGINATION,
              page: registryRequestPage,
            }
          }
          isLoading={
            registryQuery.isFetching && registryQuery.data === undefined
          }
          hasError={registryQuery.isError}
          query={query}
          pendingSkillId={pendingRegistrySkillId}
          onRetry={() => void registryQuery.refetch()}
          onQueryChange={handleRegistryQueryChange}
          onPageChange={setRegistryPage}
          onInstall={installRegistry}
          onSelect={openRegistrySkill}
          isInstalled={isRegistrySkillInstalled}
        />
      ) : (
        <SkillsOverview
          skills={skills}
          isLoading={isLoading}
          hasError={hasError}
          query={query}
          registrySkills={registryQuery.data?.skills ?? []}
          registryIsLoading={
            registryQuery.isFetching && registryQuery.data === undefined
          }
          registryHasError={registryQuery.isError}
          pendingRegistrySkillId={pendingRegistrySkillId}
          registryBrowseAction={
            <ResourceShelfSeeAllAction
              type="button"
              onClick={() => {
                setRegistryPage(0);
                navigate(getRegistrySkillsRoutePath());
              }}
            />
          }
          onCreateSkill={handleCreateSkill}
          onSelectSkill={openSkill}
          onEditSkill={(skill) => openSkill(skill, { editing: true })}
          onDeleteSkill={setDeleteTarget}
          onSelectRegistrySkill={openRegistrySkill}
          onQueryChange={handleRegistryQueryChange}
          onInstallRegistrySkill={installRegistry}
          isRegistrySkillInstalled={isRegistrySkillInstalled}
          onRetry={() => void skillsQuery.refetch()}
          onRetryRegistry={() => void registryQuery.refetch()}
        />
      )}
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteSkill.isPending) setDeleteTarget(null);
        }}
      >
        {deleteTarget ? (
          <ConfirmDeleteDialogContent
            title="Delete skill?"
            description={`Delete "${deleteTarget.name}" from its bb scope? This cannot be undone.`}
            confirmLabel="Delete skill"
            pending={deleteSkill.isPending}
            onConfirm={confirmDeleteSkill}
            onCancel={() => setDeleteTarget(null)}
          />
        ) : null}
      </ConfirmDeleteDialog>
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
