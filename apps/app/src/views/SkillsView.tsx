import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
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
import { Skeleton } from "@/components/ui/skeleton.js";
import { Icon } from "@/components/ui/icon.js";
import { MarkdownPreview } from "@/components/ui/markdown-preview.js";
import { PageShell } from "@/components/ui/page-shell.js";
import { Pill } from "@/components/ui/pill.js";
import { CREATE_SKILL_PROMPT } from "@/components/promptbox/PromptBoxActionsMenu";
import { CreateWithTemplatesButton } from "@/components/create-via-prompt-examples";
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
      className="flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
  /** Opens the composer to create a skill, optionally seeded with a full prompt. */
  onCreateSkill: (prompt?: string) => void;
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
        {/* One library of every skill across providers. You search and manage
            here; creating a bb skill is a single template-based action, the way
            VS Code / Raycast keep authoring out of the management list rather
            than stacking a teaching panel onto a list that is never empty. */}
        <div className="space-y-2">
          <p className="text-sm leading-snug text-subtle-foreground">
            Every skill your agents can run, grouped by provider. bb skills run
            across all of them.
          </p>
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
                onChange={(event) => setQuery(event.target.value)}
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
          <p className="text-sm text-destructive">Failed to load skills.</p>
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
                    <div className="max-h-[max(16rem,60dvh)] overflow-y-auto border-t border-border-seam p-1">
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
          </>
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
 * Drop a leading YAML frontmatter block before rendering. The markdown renderer
 * doesn't understand frontmatter, so a `---\n…\n---` header would otherwise
 * render as a stray horizontal rule plus a setext heading (the closing `---`
 * underlines the `name:`/`description:` lines). The detail header already shows
 * the skill's name and scope, so the frontmatter is redundant here regardless.
 */
function stripSkillFrontmatter(content: string): string {
  const match = /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  return match ? content.slice(match[0].length).replace(/^\s*\n/, "") : content;
}

/**
 * Read-only SKILL.md body, rendered with the same markdown viewer the thread
 * file preview uses (MarkdownPreview on a faint paper wash) so a skill reads
 * like any other file in the app rather than raw monospace. Presentational and
 * exported so stories iterate on it without the dialog's queries.
 * `@container/page` + `--md-content-w` mirror FilePreview so any wide tables
 * size against this column, not the viewport.
 */
export function SkillContentPreview({ content }: { content: string }) {
  return (
    <div
      className="@container/page max-h-[60dvh] overflow-auto rounded-md border border-border bg-surface-raised px-4 py-3"
      style={{ "--md-content-w": "100cqi" } as CSSProperties}
    >
      <MarkdownPreview allowHtml content={stripSkillFrontmatter(content)} />
    </div>
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
 * Presentational skill detail popup: renders the SKILL.md (read) or an inline
 * editor, with Edit / Delete / Open-in-editor affordances. Owns only local UI
 * state (editing, draft, delete confirmation); all data + persistence arrive as
 * props so it renders in stories/tests without queries. The connected
 * {@link SkillDetailDialog} wires it to the content/update/delete queries.
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

        {isContentError ? (
          <p className="text-sm text-destructive">Failed to load the skill.</p>
        ) : isLoadingContent ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : editing ? (
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="SKILL.md"
            className="h-80 w-full resize-none rounded-md border border-input bg-card p-3 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        ) : (
          <SkillContentPreview content={content} />
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
                  disabled={isDeleting}
                  onClick={onDelete}
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
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {canOpenInEditor ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onOpenInEditor}
                >
                  <Icon name="ExternalLink" className="size-4" />
                  Open in editor
                </Button>
              ) : null}
              {canManage ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isLoadingContent}
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

/**
 * View a skill's SKILL.md; bb skills (manageable) can be edited inline or
 * deleted. Connected — owns the content/update/delete queries and renders
 * {@link SkillDetailDialogView}.
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
  const handleCreateSkill = useCallback(
    (prompt?: string) => {
      navigate(getRootComposeRoutePath(), {
        state: {
          focusPrompt: true,
          initialPrompt: prompt ?? CREATE_SKILL_PROMPT,
          createDraftKind: "skill",
        },
      });
    },
    [navigate],
  );
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
