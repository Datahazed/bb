import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SkillProvider, SkillSummary } from "@bb/server-contract";
import { Button } from "@/components/ui/button.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { Icon } from "@/components/ui/icon.js";
import { Input } from "@/components/ui/input.js";
import { PageShell } from "@/components/ui/page-shell.js";
import { CREATE_SKILL_PROMPT } from "@/components/promptbox/PromptBoxActionsMenu";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { useProjectSkills } from "@/hooks/queries/skills-queries";

interface SkillProviderGroup {
  /** Group key: the provider id, or "bb" for provider-agnostic bb skills. */
  key: string;
  label: string;
  providerId: SkillProvider | null;
  skills: SkillSummary[];
}

// Order providers first, then bb-agnostic skills last.
const PROVIDER_ORDER: readonly (SkillProvider | null)[] = [
  "claude-code",
  "codex",
  null,
];

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

function ProviderLogo({
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
  return <LogoIcon className={className} />;
}

/** Calm, typeahead-style row: skill icon + name + muted description. */
function SkillRow({ skill }: { skill: SkillSummary }) {
  return (
    <div className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs">
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
    </div>
  );
}

export interface SkillsOverviewProps {
  skills: readonly SkillSummary[];
  isLoading: boolean;
  hasError: boolean;
  onCreateSkill: () => void;
}

/**
 * Presentational Skills list: provider-grouped, searchable, typeahead-style
 * rows. Split from the data-fetching container so it renders in tests/stories.
 */
export function SkillsOverview({
  skills,
  isLoading,
  hasError,
  onCreateSkill,
}: SkillsOverviewProps) {
  const [query, setQuery] = useState("");
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
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <p className="max-w-prose text-sm text-muted-foreground">
          Reusable, agent-invokable workflows. Search your skills, or describe a
          new one to have an agent build it.
        </p>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Icon
              name="Search"
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Search skills"
              placeholder="Search skills"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 pl-7 pr-2 text-sm focus-visible:ring-1"
            />
          </div>
          <Button type="button" size="sm" className="shrink-0" onClick={onCreateSkill}>
            <Icon name="Plus" className="size-4" />
            New skill
          </Button>
        </div>
        {hasError ? (
          <p className="text-sm text-destructive">Failed to load skills.</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : skills.length === 0 ? (
          <EmptyStatePanel className="py-6">No skills yet.</EmptyStatePanel>
        ) : groups.length === 0 ? (
          <EmptyStatePanel className="py-6">
            {`No skills match "${query}"`}
          </EmptyStatePanel>
        ) : (
          <div className="overflow-hidden rounded-md border border-border bg-popover text-popover-foreground">
            {groups.map((group) => (
              <section key={group.key}>
                <div className="flex items-center gap-1.5 border-b border-border-seam px-3 py-1.5 text-xs text-muted-foreground">
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
                </div>
                <div className="flex flex-col gap-px p-1">
                  {group.skills.map((skill) => (
                    <SkillRow
                      key={`${group.key}-${skill.scope}-${skill.name}`}
                      skill={skill}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

export function SkillsView() {
  const navigate = useNavigate();
  const skillsQuery = useProjectSkills(PERSONAL_PROJECT_ID);
  const skills = skillsQuery.data?.skills ?? [];
  const hasError = skillsQuery.isError && skillsQuery.data === undefined;
  const isLoading =
    skillsQuery.isFetching && skillsQuery.data === undefined && !hasError;
  // Create via prompt: open the composer seeded with the bb-skill prompt; the
  // spawned thread authors the SKILL.md.
  const handleCreateSkill = useCallback(() => {
    navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true, initialPrompt: CREATE_SKILL_PROMPT },
    });
  }, [navigate]);
  return (
    <SkillsOverview
      skills={skills}
      isLoading={isLoading}
      hasError={hasError}
      onCreateSkill={handleCreateSkill}
    />
  );
}
