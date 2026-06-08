import { EnvironmentLifecycle } from "./environment-lifecycle.js";
import { ProjectLifecycle } from "./project-lifecycle.js";
import { ThreadRuntimeLifecycle } from "./thread-runtime-lifecycle.js";
import type { LifecycleServiceDeps } from "./shared.js";

export interface Lifecycles {
  environmentLifecycle: EnvironmentLifecycle;
  projectLifecycle: ProjectLifecycle;
  threadLifecycle: ThreadRuntimeLifecycle;
}

/**
 * Boot composition for the Phase 2 lifecycle modules. The environment and
 * thread lifecycles reference each other (provision settlement touches bound
 * threads; thread stops cancel environment provisions), so the environment
 * lifecycle is late-bound to the thread lifecycle's hook surface.
 */
export function createLifecycles(deps: LifecycleServiceDeps): Lifecycles {
  const environmentLifecycle = new EnvironmentLifecycle(deps);
  const threadLifecycle = new ThreadRuntimeLifecycle(deps, environmentLifecycle);
  environmentLifecycle.bindThreadLifecycle(threadLifecycle);
  const projectLifecycle = new ProjectLifecycle(
    deps,
    threadLifecycle,
    environmentLifecycle,
  );
  return { environmentLifecycle, projectLifecycle, threadLifecycle };
}
