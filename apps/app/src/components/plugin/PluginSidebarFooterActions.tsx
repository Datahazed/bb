import { useNavigate } from "react-router-dom";
import { cn } from "@bb/shared-ui/lib/utils";
import { COARSE_POINTER_CHILD_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar.js";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import {
  usePluginSlots,
  type PluginSidebarFooterActionSlot,
} from "@/lib/plugin-slots";
import { getPluginConfigurationRoutePath } from "@/lib/route-paths";
import { usePluginSidebarFooterActionActive } from "@/lib/plugin-sidebar-footer-action-state";

const SIDEBAR_FOOTER_ACTION_CLASS = cn(
  COARSE_POINTER_CHILD_ICON_BUTTON_CLASS,
  "text-muted-foreground hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground [&>svg]:opacity-80",
);

/**
 * Plugin `sidebarFooterAction` slots: host-rendered icon buttons in the app
 * sidebar footer (after Settings, before the bug-report action). Activating
 * one runs the plugin's `run` with `{ openSettings }` — throws/rejections
 * are logged and never break the sidebar.
 */
export function PluginSidebarFooterActions(props: { onNavigate?: () => void }) {
  const { sidebarFooterActions } = usePluginSlots();
  if (sidebarFooterActions.length === 0) return null;
  return (
    <PluginSidebarFooterActionList
      actions={sidebarFooterActions}
      onNavigate={props.onNavigate}
    />
  );
}

function PluginSidebarFooterActionList({
  actions,
  onNavigate,
}: {
  actions: readonly PluginSidebarFooterActionSlot[];
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <>
      {actions.map((action) => (
        <PluginSidebarFooterAction
          key={`${action.pluginId}/${action.id}/${action.generation}`}
          action={action}
          navigate={navigate}
          onNavigate={onNavigate}
        />
      ))}
    </>
  );
}

function PluginSidebarFooterAction({
  action,
  navigate,
  onNavigate,
}: {
  action: PluginSidebarFooterActionSlot;
  navigate: ReturnType<typeof useNavigate>;
  onNavigate?: () => void;
}) {
  const active = usePluginSidebarFooterActionActive(action.pluginId, action.id);
  const title =
    active && action.experimental_activeTitle !== undefined
      ? action.experimental_activeTitle
      : action.title;
  return (
    <SidebarMenuItem className="min-w-0">
      <SidebarMenuButton
        className={SIDEBAR_FOOTER_ACTION_CLASS}
        tooltip={{ children: title, hidden: false, side: "top" }}
        aria-label={title}
        aria-pressed={active}
        data-active={active}
        data-testid={`plugin-sidebar-footer-action-${action.pluginId}-${action.id}`}
        onClick={() => {
          onNavigate?.();
          runSidebarFooterAction({ action, navigate });
        }}
      >
        <PluginIcon pluginId={action.pluginId} icon={action.icon} />
        {active && action.experimental_activeIndicator === "dot" ? (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 size-1.5 rounded-full bg-sidebar-primary"
            data-testid={`plugin-sidebar-footer-action-indicator-${action.pluginId}-${action.id}`}
          />
        ) : null}
        <span className="sr-only">{title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function runSidebarFooterAction({
  action,
  navigate,
}: {
  action: PluginSidebarFooterActionSlot;
  navigate: ReturnType<typeof useNavigate>;
}): void {
  const openSettings = () => {
    void navigate(
      getPluginConfigurationRoutePath({ pluginId: action.pluginId }),
    );
  };
  const warn = (error: unknown) => {
    console.warn(
      `[plugin:${action.pluginId}] sidebarFooterAction "${action.id}" failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  };
  try {
    const result = action.run({ openSettings });
    if (result instanceof Promise) result.catch(warn);
  } catch (error) {
    warn(error);
  }
}
