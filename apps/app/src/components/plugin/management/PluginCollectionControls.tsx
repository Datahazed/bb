import type { ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { ResourceToolbar } from "@bb/shared-ui/resource-list";

export function PluginCreateControl({
  onCreate,
  onInstallFromSource,
}: {
  onCreate: () => void;
  onInstallFromSource: () => void;
}) {
  return (
    <div className="flex items-stretch">
      <Button type="button" className="rounded-r-none" onClick={onCreate}>
        <Icon name="MessageSquarePlus" className="size-3.5" aria-hidden />
        Create a plugin
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            aria-label="Create a plugin options"
            className="rounded-l-none border-l border-l-primary-foreground/20 px-1.5"
          >
            <Icon name="ChevronDown" className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          mobileTitle="Create a plugin options"
          className="w-max min-w-40"
        >
          <DropdownMenuItem onSelect={onInstallFromSource}>
            <Icon name="Download" className="size-4" aria-hidden />
            Install from source
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function PluginCollectionToolbar({
  searchValue,
  searchPlaceholder,
  searchClearLabel,
  onSearchChange,
  filter,
  sort,
  action,
  controlsClassName,
}: {
  searchValue: string;
  searchPlaceholder: string;
  searchClearLabel: string;
  onSearchChange: (value: string) => void;
  filter?: ReactNode;
  sort?: ReactNode;
  action?: ReactNode;
  controlsClassName?: string;
}) {
  return (
    <ResourceToolbar
      searchValue={searchValue}
      searchPlaceholder={searchPlaceholder}
      searchClearLabel={searchClearLabel}
      onSearchChange={onSearchChange}
      controls={
        sort === undefined && filter === undefined ? undefined : (
          <>
            {sort}
            {filter}
          </>
        )
      }
      controlsClassName={controlsClassName}
      action={action}
    />
  );
}
