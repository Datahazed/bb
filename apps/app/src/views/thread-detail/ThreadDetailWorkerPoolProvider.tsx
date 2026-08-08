import { lazy, Suspense, type ReactNode } from "react";

const WorkerPoolProviderImpl = lazy(() =>
  import("./ThreadDetailWorkerPoolProviderImpl").then((module) => ({
    default: module.ThreadDetailWorkerPoolProvider,
  })),
);

export function ThreadDetailWorkerPoolProvider({
  children,
}: {
  children: ReactNode;
}) {
  if (typeof Worker === "undefined") {
    return children;
  }
  return (
    <Suspense fallback={children}>
      <WorkerPoolProviderImpl>{children}</WorkerPoolProviderImpl>
    </Suspense>
  );
}
