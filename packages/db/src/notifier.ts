import type {
  ThreadChangeKind,
  ThreadChangeMetadata,
  ProjectChangeKind,
  EnvironmentChangeKind,
  SystemChangeKind,
} from "@bb/domain";

export interface DbNotifier {
  notifyThread(
    threadId: string,
    changes: ThreadChangeKind[],
    metadata?: ThreadChangeMetadata,
  ): void;
  notifyProject(projectId: string, changes: ProjectChangeKind[]): void;
  notifyEnvironment(
    environmentId: string,
    changes: EnvironmentChangeKind[],
  ): void;
  notifySystem(changes: SystemChangeKind[]): void;
}

export const noopNotifier: DbNotifier = {
  notifyThread() {},
  notifyProject() {},
  notifyEnvironment() {},
  notifySystem() {},
};
