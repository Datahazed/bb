import { useState, type ReactNode } from "react";
import { CompactSecondaryPanelShelf } from "./CompactSecondaryPanelShelf";

export default {
  title: "right-panel/Compact shelf",
};

const noop = () => {};

function PanelBody({ label }: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md border border-border-seam bg-surface-raised text-xs">
          i
        </span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="h-9 rounded-md border border-border bg-surface-raised" />
      <div className="h-9 rounded-md border border-border bg-surface-raised" />
      <div className="h-9 rounded-md border border-border bg-surface-raised" />
    </div>
  );
}

function PageBehind({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border-seam px-4">
        <span className="flex size-7 items-center justify-center rounded-md border border-border-seam text-xs">
          ☰
        </span>
        <span className="text-sm font-medium">Rework folder model</span>
      </div>
      <div className="flex-1 p-4 text-sm text-muted-foreground">
        Thread timeline sits here. When the shelf is open this page stays
        visible; when a tab goes full page it is fully displaced.
      </div>
      {children}
    </div>
  );
}

export function Shelf() {
  return (
    <PageBehind>
      <CompactSecondaryPanelShelf
        open
        onClose={noop}
        presentation="shelf"
        srLabel="Right panel"
      >
        <PanelBody label="Thread info" />
      </CompactSecondaryPanelShelf>
    </PageBehind>
  );
}

export function FullPage() {
  return (
    <PageBehind>
      <CompactSecondaryPanelShelf
        open
        onClose={noop}
        presentation="full"
        srLabel="Right panel"
      >
        <PanelBody label="New tab" />
      </CompactSecondaryPanelShelf>
    </PageBehind>
  );
}

export function Closed() {
  return (
    <PageBehind>
      <CompactSecondaryPanelShelf
        open={false}
        onClose={noop}
        presentation="shelf"
        srLabel="Right panel"
      >
        <PanelBody label="Thread info" />
      </CompactSecondaryPanelShelf>
    </PageBehind>
  );
}

export function ShelfToFullPage() {
  const [presentation, setPresentation] = useState<"shelf" | "full">("shelf");
  const [open, setOpen] = useState(true);
  return (
    <PageBehind>
      <div className="absolute inset-x-0 bottom-0 z-100 flex gap-2 p-3">
        <button
          type="button"
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs"
          onClick={() => setPresentation("shelf")}
        >
          Info (shelf)
        </button>
        <button
          type="button"
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs"
          onClick={() => setPresentation("full")}
        >
          Open tab (full page)
        </button>
        <button
          type="button"
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Close" : "Open"}
        </button>
      </div>
      <CompactSecondaryPanelShelf
        open={open}
        onClose={() => setOpen(false)}
        presentation={presentation}
        srLabel="Right panel"
      >
        <PanelBody
          label={presentation === "shelf" ? "Thread info" : "New tab"}
        />
      </CompactSecondaryPanelShelf>
    </PageBehind>
  );
}
