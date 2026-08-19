// bb-plugin-plugin-api-docs backend.
//
// The docs are entirely frontend: the map is static content compiled into the
// app bundle, so there is nothing to serve, store, or schedule. bb requires a
// server entry for every plugin, so this factory exists and does nothing.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function plugin(bb: BbPluginApi) {
  bb.log.debug("plugin API docs loaded (frontend-only)");
}
