import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";

interface FolderOnboardingDialogContentProps {
  // The user's entry previewed as breadcrumbs ("Work › Q3 › Planning").
  pathLabel: string;
  // Only shown when grouping is currently off, since accepting turns it on.
  showGroupingHint: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Body of the first-folder confirmation: explains that "/" files a thread into
 * a folder, previews the resulting path, and offers Create / Cancel. Split from
 * the modal shell so stories can render it without the overlay (mirrors
 * {@link ConfirmDeleteDialogContent}).
 */
export function FolderOnboardingDialogContent({
  pathLabel,
  showGroupingHint,
  pending,
  onConfirm,
  onCancel,
}: FolderOnboardingDialogContentProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Organize threads into folders</DialogTitle>
        <DialogDescription>
          Using “/” groups this thread into a folder:
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2 text-sm">
        <div className="rounded-md bg-muted px-3 py-2 font-medium break-words">
          {pathLabel}
        </div>
        {showGroupingHint ? (
          <p className="text-muted-foreground">
            Folder grouping will turn on so you can see it.
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="button" disabled={pending} onClick={onConfirm}>
          Create folder
        </Button>
      </DialogFooter>
    </>
  );
}

interface FolderOnboardingDialogProps {
  open: boolean;
  pathLabel: string;
  showGroupingHint: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  // Esc / overlay dismiss routes back through cancel (reopen rename).
  onOpenChange: (open: boolean) => void;
}

/**
 * First-folder confirmation modal, shown the first time a rename would create a
 * folder. Accepting submits the rename and enables folder grouping; declining
 * (button, Esc, or overlay) hands control back to the rename dialog with the
 * draft intact.
 */
export function FolderOnboardingDialog({
  open,
  pathLabel,
  showGroupingHint,
  pending,
  onConfirm,
  onCancel,
  onOpenChange,
}: FolderOnboardingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <FolderOnboardingDialogContent
            pathLabel={pathLabel}
            showGroupingHint={showGroupingHint}
            pending={pending}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
