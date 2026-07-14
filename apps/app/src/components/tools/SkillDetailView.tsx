import { useState, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  ResourceDefinitionSection,
  ResourceDetailList,
  ResourceDetailPage,
  ResourceDetailPanel,
  ResourceInstalledControl,
  ResourceLifecycleStatus,
} from "@bb/shared-ui/resource-list";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { FilePreview } from "@/components/secondary-panel/FilePreview.js";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import { appToast } from "@/components/ui/app-toast";

export type SkillDetailHeaderControl =
  | {
      kind: "install";
      skillName: string;
      installed: boolean;
      pending: boolean;
      onInstall: () => void;
      onUninstall?: () => void;
    }
  | {
      kind: "status";
      label: string;
      tooltip: string;
      accessibleLabel?: string;
    };

export type SkillDetailContentState =
  | { kind: "loading" }
  | { kind: "error"; message: string; onRetry: () => void }
  | { kind: "ready"; content: string };

export interface SkillDetailViewProps {
  back?: ReactNode;
  leading: ReactNode;
  title: string;
  path: string;
  pathHref?: string;
  headerControl?: SkillDetailHeaderControl;
  bundledPlugin?: { pluginName: string; providerLabel: string };
  overflowMenu?: ReactNode;
  files: readonly string[];
  selectedPath: string;
  onSelectFile: (path: string) => void;
  contentState: SkillDetailContentState;
  contentActions?: ReactNode;
  editor?: ReactNode;
  footer?: ReactNode;
}

export function SkillInstallControl({
  skillName,
  installed,
  pending,
  onInstall,
}: {
  skillName: string;
  installed: boolean;
  pending: boolean;
  onInstall: () => void;
}) {
  if (installed) {
    return (
      <ResourceInstalledControl
        accessibleLabel={`Installed ${skillName} as a bb skill`}
      />
    );
  }

  const label = pending ? "Installing" : "Install";
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 shrink-0 px-2 text-xs"
      disabled={pending}
      aria-label={`${label} ${skillName} as a bb skill`}
      onClick={onInstall}
    >
      {label}
    </Button>
  );
}

export function SkillBrowseInstallControl({
  skillName,
  installed,
  pending,
  onInstall,
  onUninstall,
}: {
  skillName: string;
  installed: boolean;
  pending: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);

  if (!installed) {
    return (
      <SkillInstallControl
        skillName={skillName}
        installed={false}
        pending={pending}
        onInstall={onInstall}
      />
    );
  }

  return (
    <>
      <ResourceInstalledControl
        accessibleLabel={`Uninstall ${skillName} from bb`}
        pending={pending}
        onAction={() => setConfirmingUninstall(true)}
      />
      <ConfirmDeleteDialog
        open={confirmingUninstall}
        onOpenChange={(open) => {
          if (!pending) setConfirmingUninstall(open);
        }}
      >
        <ConfirmDeleteDialogContent
          title="Uninstall skill?"
          description={`Remove "${skillName}" from your bb skills?`}
          confirmLabel="Uninstall skill"
          pending={pending}
          onConfirm={() => {
            onUninstall();
            setConfirmingUninstall(false);
          }}
          onCancel={() => setConfirmingUninstall(false)}
        />
      </ConfirmDeleteDialog>
    </>
  );
}

export function SkillBundledPluginMetadata({
  pluginName,
  providerLabel,
}: {
  pluginName: string;
  providerLabel: string;
}) {
  return (
    <span>
      Bundled with {pluginName} ({providerLabel} plugin)
    </span>
  );
}

function SkillStatusControl({
  label,
  tooltip,
  accessibleLabel,
}: {
  label: string;
  tooltip: string;
  accessibleLabel?: string;
}) {
  return (
    <ResourceLifecycleStatus
      label={label}
      accessibleLabel={accessibleLabel}
      tooltip={tooltip}
    />
  );
}

function SkillPath({ path, href }: { path: string; href?: string }) {
  const [copied, setCopied] = useState(false);

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      appToast.error("Failed to copy path.");
    }
  }

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${path} in a new tab`}
              className="group -ml-1.5 inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className="truncate font-mono">{path}</span>
              <Icon
                name="ExternalLink"
                className="size-3 shrink-0"
                aria-hidden
              />
            </a>
          ) : (
            <button
              type="button"
              aria-label={`Copy skill path: ${path}`}
              onClick={copyPath}
              className="group -ml-1.5 inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className="truncate font-mono">{path}</span>
              <Icon
                name={copied ? "Check" : "Copy"}
                className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                aria-hidden
              />
            </button>
          )}
        </TooltipTrigger>
        <TooltipContent>
          {href ? "Open on skills.sh" : copied ? "Copied" : "Copy path"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function SkillFileList({
  files,
  selectedPath,
  onSelectFile,
}: {
  files: readonly string[];
  selectedPath: string;
  onSelectFile: (path: string) => void;
}) {
  return (
    <ResourceDetailList className="max-h-48 overflow-auto">
      {files.map((path) => (
        <button
          key={path}
          type="button"
          aria-pressed={path === selectedPath}
          onClick={() => onSelectFile(path)}
          className="flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left font-mono text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground aria-pressed:bg-state-active aria-pressed:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon name="FileText" className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{path}</span>
        </button>
      ))}
    </ResourceDetailList>
  );
}

export function SkillDetailView({
  back,
  leading,
  title,
  path,
  pathHref,
  headerControl,
  bundledPlugin,
  overflowMenu,
  files,
  selectedPath,
  onSelectFile,
  contentState,
  contentActions,
  editor,
  footer,
}: SkillDetailViewProps) {
  const lifecycleControl =
    headerControl?.kind === "install" ? (
      headerControl.onUninstall ? (
        <SkillBrowseInstallControl
          skillName={headerControl.skillName}
          installed={headerControl.installed}
          pending={headerControl.pending}
          onInstall={headerControl.onInstall}
          onUninstall={headerControl.onUninstall}
        />
      ) : (
        <SkillInstallControl
          skillName={headerControl.skillName}
          installed={headerControl.installed}
          pending={headerControl.pending}
          onInstall={headerControl.onInstall}
        />
      )
    ) : headerControl?.kind === "status" ? (
      <SkillStatusControl
        label={headerControl.label}
        tooltip={headerControl.tooltip}
        accessibleLabel={headerControl.accessibleLabel}
      />
    ) : undefined;

  return (
    <ResourceDetailPage
      back={back}
      leading={leading}
      title={title}
      titleMeta={
        bundledPlugin ? (
          <SkillBundledPluginMetadata
            pluginName={bundledPlugin.pluginName}
            providerLabel={bundledPlugin.providerLabel}
          />
        ) : undefined
      }
      metadata={<SkillPath path={path} href={pathHref} />}
      lifecycleControl={lifecycleControl}
      overflowMenu={overflowMenu}
    >
      {files.length > 1 && editor === undefined ? (
        <ResourceDefinitionSection label="Files">
          <SkillFileList
            files={files}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
          />
        </ResourceDefinitionSection>
      ) : null}

      <ResourceDefinitionSection label={selectedPath} actions={contentActions}>
        {editor ??
          (contentState.kind === "loading" ? (
            <ResourceDetailPanel className="px-3 py-10 text-center text-sm text-muted-foreground">
              Loading {selectedPath}…
            </ResourceDetailPanel>
          ) : contentState.kind === "error" ? (
            <ResourceDetailPanel className="px-3 py-10 text-center text-sm">
              <p role="alert" className="text-destructive">
                {contentState.message}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={contentState.onRetry}
              >
                Retry
              </Button>
            </ResourceDetailPanel>
          ) : (
            <ResourceDetailPanel className="max-h-[60dvh] overflow-auto bg-transparent">
              <FilePreview
                path={selectedPath}
                headerMode="none"
                state={{
                  kind: "ready",
                  file: {
                    name: selectedPath.split("/").at(-1) ?? selectedPath,
                    contents: contentState.content,
                  },
                  lineRange: null,
                  textPreviewKind: selectedPath.endsWith(".md")
                    ? "markdown"
                    : null,
                }}
              />
            </ResourceDetailPanel>
          ))}
      </ResourceDefinitionSection>
      {footer}
    </ResourceDetailPage>
  );
}
