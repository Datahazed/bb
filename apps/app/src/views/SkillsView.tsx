import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SkillProvider, SkillSummary } from "@bb/server-contract";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { Icon } from "@/components/ui/icon.js";
import { PageShell } from "@/components/ui/page-shell.js";
import { Pill } from "@/components/ui/pill.js";
import { CREATE_SKILL_PROMPT } from "@/components/promptbox/PromptBoxActionsMenu";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { cn } from "@/lib/utils";
import {
  useDeleteSkill,
  useProjectSkills,
  useSkillContent,
  useUpdateSkill,
} from "@/hooks/queries/skills-queries";
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
      className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

export interface SkillsOverviewProps {
  skills: readonly SkillSummary[];
  isLoading: boolean;
  hasError: boolean;
  onCreateSkill: () => void;
  onSelectSkill: (skill: SkillSummary) => void;
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
  onSelectSkill,
}: SkillsOverviewProps) {
  const [query, setQuery] = useState("");
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
    <PageShell contentClassName="pt-4 md:pt-5" maxWidthClassName="max-w-5xl">
      <div className="space-y-4">
        <p className="max-w-prose text-sm text-muted-foreground">
          Reusable, agent-invokable workflows. Search your skills, or describe a
          new one to have an agent build it.
        </p>
        <div className="flex items-center gap-2">
          <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-muted px-2 transition-shadow focus-within:ring-1 focus-within:ring-ring">
            <Icon
              name="Search"
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <input
              aria-label="Search skills"
              placeholder="Search skills"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
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
                    className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:bg-state-hover"
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
                    <div className="max-h-64 overflow-y-auto border-t border-border-seam p-1">
                      <div className="flex flex-col gap-px">
                        {group.skills.map((skill) => (
                          <SkillRow
                            key={`${group.key}-${skill.scope}-${skill.name}`}
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
      </div>
    </PageShell>
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

/**
 * View a skill's SKILL.md; bb skills (manageable) can be edited inline or
 * deleted. Connected — owns the content/update/delete queries.
 */
function SkillDetailDialog({
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setEditing(false);
    setConfirmingDelete(false);
  }, [skill?.scope, skill?.name, skill?.provider]);

  const content = contentQuery.data?.content ?? "";
  const deletableScope =
    skill && (skill.scope === "bb-user" || skill.scope === "bb-project")
      ? skill.scope
      : null;
  const canManage = skill?.manageable === true && deletableScope !== null;
  const canOpenInEditor = skill !== null && canOpenPreferredFileTarget;

  function handleOpenInEditor() {
    if (!skill) return;
    void openPathInPreferredFileTarget({ path: skill.filePath, lineNumber: null });
  }

  async function handleSave() {
    if (!skill || deletableScope === null) return;
    try {
      await updateSkill.mutateAsync({
        scope: deletableScope,
        name: skill.name,
        environmentId: null,
        content: draft,
      });
      setEditing(false);
    } catch {
      // Errors surface via the global handler; keep the edits for retry.
    }
  }

  function handleDelete() {
    if (!skill || deletableScope === null) return;
    deleteSkill.mutate(
      { scope: deletableScope, name: skill.name, environmentId: null },
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog
      open={skill !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Icon name="Zap" className="size-4 text-file-accent" />
            <span className="min-w-0 truncate">{skill?.name}</span>
            {skill?.provider ? (
              <ProviderLogo providerId={skill.provider} className="size-3.5" />
            ) : null}
            {skill ? (
              <Pill variant="outline" className="ml-1 shrink-0">
                {SCOPE_LABELS[skill.scope]}
              </Pill>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        {contentQuery.isError ? (
          <p className="text-sm text-destructive">Failed to load the skill.</p>
        ) : contentQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : editing ? (
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="SKILL.md"
            className="h-80 w-full resize-none rounded-md border border-input bg-card p-3 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        ) : (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card p-3 font-mono text-xs leading-relaxed text-foreground">
            {content}
          </pre>
        )}

        <DialogFooter className="sm:justify-between">
          {canManage && !editing ? (
            confirmingDelete ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                Delete this skill?
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
                  disabled={deleteSkill.isPending}
                  onClick={handleDelete}
                >
                  Delete
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmingDelete(true)}
              >
                <Icon name="Trash2" className="size-4" />
                Delete
              </Button>
            )
          ) : (
            <span />
          )}

          {editing ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={updateSkill.isPending}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={updateSkill.isPending || contentQuery.isLoading}
                onClick={handleSave}
              >
                Save
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {canOpenInEditor ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenInEditor}
                >
                  <Icon name="ExternalLink" className="size-4" />
                  Open in editor
                </Button>
              ) : null}
              {canManage ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={contentQuery.isLoading}
                  onClick={() => {
                    setDraft(content);
                    setEditing(true);
                  }}
                >
                  <Icon name="Edit" className="size-4" />
                  Edit
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Read-only</span>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SkillsView() {
  const navigate = useNavigate();
  const skillsQuery = useProjectSkills(PERSONAL_PROJECT_ID);
  const skills = skillsQuery.data?.skills ?? [];
  const hasError = skillsQuery.isError && skillsQuery.data === undefined;
  const isLoading =
    skillsQuery.isFetching && skillsQuery.data === undefined && !hasError;
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null);
  // Create via prompt: open the composer seeded with the bb-skill prompt; the
  // spawned thread authors the SKILL.md.
  const handleCreateSkill = useCallback(() => {
    navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true, initialPrompt: CREATE_SKILL_PROMPT },
    });
  }, [navigate]);
  return (
    <>
      <SkillsOverview
        skills={skills}
        isLoading={isLoading}
        hasError={hasError}
        onCreateSkill={handleCreateSkill}
        onSelectSkill={setSelectedSkill}
      />
      <SkillDetailDialog
        projectId={PERSONAL_PROJECT_ID}
        skill={selectedSkill}
        onClose={() => setSelectedSkill(null)}
      />
    </>
  );
}
