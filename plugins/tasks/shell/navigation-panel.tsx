import type { PluginNavPanelRightPanelViewProps } from "@get-bb/plugin-sdk/app";
import {
  useActiveTasks,
  useFolders,
  usePresets,
  useProjects,
  useSidebarSummary,
} from "./data.js";
import { TasksRefreshProvider } from "./refresh.js";
import { parseTasksRoute, useTasksNavigation } from "./routes.js";
import { TasksSidebar } from "./sidebar.js";
import { NewProjectDialog } from "../views/manage/index.js";
import { useState } from "react";

function TasksNavigationPanelContent({
  isVisible,
  subPath,
  onNewProject,
}: Pick<PluginNavPanelRightPanelViewProps, "subPath"> & {
  isVisible: boolean;
  onNewProject: () => void;
}) {
  const route = parseTasksRoute(subPath);
  const navigation = useTasksNavigation();
  const folders = useFolders({ enabled: isVisible });
  const projects = useProjects({ enabled: isVisible });
  const summaries = useSidebarSummary({ enabled: isVisible });
  const presets = usePresets({ enabled: isVisible });
  const activeTasks = useActiveTasks({ enabled: isVisible });

  return (
    <TasksSidebar
      route={route}
      folders={folders.data}
      projects={projects.data}
      summaries={summaries.data}
      presets={presets.data}
      activeTasks={activeTasks.data}
      isLoading={projects.isLoading || summaries.isLoading}
      isVisible={isVisible}
      onNavigate={navigation.go}
      onNewProject={onNewProject}
    />
  );
}

export function TasksNavigationPanel({
  isVisible = true,
  subPath,
}: PluginNavPanelRightPanelViewProps) {
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  return (
    <TasksRefreshProvider>
      <TasksNavigationPanelContent
        isVisible={isVisible}
        subPath={subPath}
        onNewProject={() => setNewProjectOpen(true)}
      />
      {newProjectOpen ? (
        <NewProjectDialog
          open
          isVisible={isVisible}
          onOpenChange={setNewProjectOpen}
        />
      ) : null}
    </TasksRefreshProvider>
  );
}
