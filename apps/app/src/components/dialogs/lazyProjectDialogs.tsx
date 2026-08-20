import { lazy, Suspense, type ComponentProps } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { RenameDialog } from "./RenameDialog";
import type {
  ProjectPathDialogProps,
  ProjectPathDialogTarget,
} from "./ProjectPathDialog";

type ProjectRenameDialogModule = typeof import("./ProjectRenameDialog");
type ProjectDeleteDialogModule = typeof import("./ProjectDeleteDialog");

const ProjectPathDialogContentChunk = lazy(() =>
  import("./ProjectPathDialog").then(({ ProjectPathDialogContent }) => ({
    default: ProjectPathDialogContent,
  })),
);
const ProjectRenameDialogContentChunk = lazy(() =>
  import("./ProjectRenameDialog").then(({ ProjectRenameDialogContent }) => ({
    default: ProjectRenameDialogContent,
  })),
);
const ProjectDeleteDialogContentChunk = lazy(() =>
  import("./ProjectDeleteDialog").then(({ ProjectDeleteDialogContent }) => ({
    default: ProjectDeleteDialogContent,
  })),
);

function DialogContentFallback({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <>
      <DialogHeader className="sr-only">
        <DialogTitle>{label}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div
        aria-hidden="true"
        className="min-h-32"
        data-project-dialog-placeholder=""
      />
    </>
  );
}

function getProjectPathDialogAccessibleCopy(target: ProjectPathDialogTarget): {
  label: string;
  description: string;
} {
  switch (target.kind) {
    case "create":
      return {
        label: "Add project",
        description: "Choose the folder to add as a project.",
      };
    case "update":
      return {
        label: "Update project path",
        description: `Choose the new project folder for ${target.projectName}.`,
      };
    case "add-source":
      return {
        label: "Add project source",
        description: `Choose a folder to add to ${target.projectName}.`,
      };
  }
}

/**
 * The responsive shell stays eager so a compact drawer can begin its transform
 * immediately. Only the normally closed body (including RemotePathBrowser) is
 * dynamic; the shared drawer realizes that body after two animation frames and
 * retains its shell through close.
 */
export function LazyProjectPathDialog({
  target,
  pending = false,
  platform,
  hostId,
  hostName,
  hosts,
  onOpenChange,
  onSubmit,
}: ProjectPathDialogProps) {
  const accessibleCopy =
    target === null ? null : getProjectPathDialogAccessibleCopy(target);
  const fallback = accessibleCopy ? (
    <DialogContentFallback {...accessibleCopy} />
  ) : null;
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent
        aria-label={accessibleCopy?.label}
        aria-description={accessibleCopy?.description}
      >
        {target ? (
          <Suspense fallback={fallback}>
            <ProjectPathDialogContentChunk
              key={target.kind === "create" ? "create" : target.projectId}
              target={target}
              pending={pending}
              platform={platform}
              hostId={hostId}
              hostName={hostName}
              hosts={hosts}
              onSubmit={onSubmit}
            />
          </Suspense>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function LazyProjectRenameDialog({
  target,
  pending = false,
  onOpenChange,
  onRename,
}: ComponentProps<ProjectRenameDialogModule["ProjectRenameDialog"]>) {
  return (
    <RenameDialog
      open={target !== null}
      onOpenChange={onOpenChange}
      accessibleLabel="Rename project"
      accessibleDescription="Choose a new name for this project."
    >
      {(inputRef) =>
        target ? (
          <Suspense
            fallback={
              <DialogContentFallback
                label="Rename project"
                description="Choose a new name for this project."
              />
            }
          >
            <ProjectRenameDialogContentChunk
              key={target.id}
              target={target}
              pending={pending}
              onRename={onRename}
              inputRef={inputRef}
              focusOnMount
            />
          </Suspense>
        ) : null
      }
    </RenameDialog>
  );
}

export function LazyProjectDeleteDialog({
  target,
  pending,
  onOpenChange,
  onDelete,
}: ComponentProps<ProjectDeleteDialogModule["ProjectDeleteDialog"]>) {
  const accessibleDescription = target
    ? `Remove "${target.name}" and all of its threads? This cannot be undone.`
    : undefined;
  return (
    <ConfirmDeleteDialog
      open={target !== null}
      onOpenChange={onOpenChange}
      accessibleLabel="Remove project?"
      accessibleDescription={accessibleDescription}
    >
      {target ? (
        <Suspense
          fallback={
            <DialogContentFallback
              label="Remove project?"
              description={
                accessibleDescription ?? "Confirm removing this project."
              }
            />
          }
        >
          <ProjectDeleteDialogContentChunk
            target={target}
            pending={pending}
            onDelete={onDelete}
          />
        </Suspense>
      ) : null}
    </ConfirmDeleteDialog>
  );
}
