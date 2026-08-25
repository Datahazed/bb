import { createFileRoute } from "@tanstack/react-router";
import { getEnv } from "@/server/env";
import { serveMarketplaceObject } from "@/server/marketplace";

// V2 discovery data and its assets share the existing marketplace R2 bucket,
// under versioned object keys. The v1 route keeps its legacy root mapping.
const handle = ({ request }: { request: Request }) =>
  serveMarketplaceObject({ bucket: getEnv().MARKETPLACE, request });

export const Route = createFileRoute("/marketplace/v2/$")({
  server: { handlers: { GET: handle, HEAD: handle } },
});
