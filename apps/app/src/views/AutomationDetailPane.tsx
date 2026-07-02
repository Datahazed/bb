import { useCallback } from "react";
import type { Automation, UpdateAutomationRequest } from "@bb/server-contract";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog.js";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import {
  useAutomationDetail,
  useAutomationRuns,
  useDeleteAutomation,
  usePauseAutomation,
  useResumeAutomation,
  useUpdateAutomation,
} from "@/hooks/queries/automation-queries";
import { useDialogState } from "@/hooks/useDialogState";
import { AutomationDetailContent } from "./AutomationDetailView.js";

interface AutomationDetailPaneProps {
  /**
   * The overview's copy of the selected loop; renders instantly while the detail
   * query refreshes, and supplies the ids the pane fetches by.
   */
  automation: Automation;
  /** Bumped per open so the detail content remounts fresh when switching loops. */
  sessionKey?: number;
  /** Edit lives on the roomy full page; the pane's Edit action navigates there. */
  onEdit: () => void;
  onClose: () => void;
}

/**
 * Docked right-side detail pane — a read-only glance at a loop. Selecting a row
 * opens this inline beside the list (no scrim, list stays interactive). Editing
 * is a deliberate, roomier task, so the pane's Edit action navigates to the
 * full-page `/automations/:id` route rather than cramming a form in here. The
 * full page (also the deep-link target) reuses the same `AutomationDetailContent`.
 */
export function AutomationDetailPane({
  automation,
  sessionKey,
  onEdit,
  onClose,
}: AutomationDetailPaneProps) {
  const projectId = automation.projectId;
  const automationId = automation.id;

  const detailQuery = useAutomationDetail(projectId, automationId);
  const runsQuery = useAutomationRuns(projectId, automationId);
  const pauseAutomation = usePauseAutomation();
  const resumeAutomation = useResumeAutomation();
  const deleteAutomation = useDeleteAutomation();
  const updateAutomation = useUpdateAutomation();
  const deleteDialog = useDialogState<true>();

  const { mutate: pauseMutate } = pauseAutomation;
  const { mutate: resumeMutate } = resumeAutomation;
  const { mutate: deleteMutate } = deleteAutomation;
  const { mutateAsync: updateMutateAsync } = updateAutomation;
  const { onClose: closeDeleteDialog, onOpen: openDeleteDialog } = deleteDialog;

  const handleSave = useCallback(
    async (patch: UpdateAutomationRequest) => {
      await updateMutateAsync({ projectId, automationId, patch });
    },
    [updateMutateAsync, projectId, automationId],
  );
  const confirmDelete = useCallback(() => {
    deleteMutate(
      { projectId, automationId },
      {
        onSuccess: () => {
          closeDeleteDialog();
          onClose();
        },
      },
    );
  }, [deleteMutate, projectId, automationId, closeDeleteDialog, onClose]);

  // Show the overview's automation immediately; refine with the detail fetch.
  const current = detailQuery.data ?? automation;
  const runs = runsQuery.data?.runs ?? [];
  const hasRunsError = runsQuery.isError && runsQuery.data === undefined;
  const isRunsLoading =
    runsQuery.isFetching && runsQuery.data === undefined && !hasRunsError;
  const actionsPending =
    pauseAutomation.isPending ||
    resumeAutomation.isPending ||
    deleteAutomation.isPending;

  return (
    <aside className="flex h-full w-[28rem] shrink-0 flex-col overflow-hidden border-l border-border bg-background">
      <div className="flex shrink-0 items-center justify-end px-3 pt-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close"
          onClick={onClose}
          className="size-7 rounded-md p-0 text-muted-foreground"
        >
          <Icon name="X" className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-1">
        <AutomationDetailContent
          key={sessionKey}
          onEdit={onEdit}
          automation={current}
          runs={runs}
          runsLoading={isRunsLoading}
          runsError={hasRunsError}
          onPause={() => pauseMutate({ projectId, automationId })}
          onResume={() => resumeMutate({ projectId, automationId })}
          onDelete={() => openDeleteDialog(true)}
          onSave={handleSave}
          savePending={updateAutomation.isPending}
          actionsPending={actionsPending}
        />
      </div>
      <ConfirmDeleteDialog
        open={deleteDialog.isOpen}
        onOpenChange={deleteDialog.onOpenChange}
      >
        <ConfirmDeleteDialogContent
          title="Delete loop?"
          description={`"${current.name}" and its run history will be permanently removed. This can't be undone.`}
          confirmLabel="Delete"
          pending={deleteAutomation.isPending}
          onConfirm={confirmDelete}
          onCancel={closeDeleteDialog}
        />
      </ConfirmDeleteDialog>
    </aside>
  );
}
