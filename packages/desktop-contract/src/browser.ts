import { z } from "zod";

/**
 * Hard caps on attacker-influenced strings crossing the browser IPC boundary so
 * a hostile page cannot force oversized values into IPC payloads or persisted
 * (localStorage) tab state. The main process truncates to these before sending;
 * the schemas reject anything longer.
 */
export const BB_DESKTOP_BROWSER_MAX_URL_LENGTH = 4096;
export const BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH = 1024;

/**
 * Pixel rect of the panel region the native browser view must overlay,
 * measured by the renderer against its own layout viewport. The preload
 * converts these CSS pixels to native window points at the current page zoom
 * before it sends the rect to the desktop main process. This rect is the
 * single placement authority: the renderer re-measures and pushes it whenever
 * its layout moves the panel, and the desktop main process only intersects it
 * with the live window content bounds — it never extrapolates placement from
 * native window resizes, whose size the renderer's (possibly lagging) chrome
 * paint does not yet reflect.
 */
export const bbDesktopBrowserViewBoundsSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
  })
  .strict();
export type BbDesktopBrowserViewBounds = z.infer<
  typeof bbDesktopBrowserViewBoundsSchema
>;

export interface BbDesktopBrowserViewportBounds {
  width: number;
  height: number;
}

interface ClampIntegerToRangeArgs {
  max: number;
  min: number;
  value: number;
}

export interface ClampBbDesktopBrowserViewBoundsArgs {
  bounds: BbDesktopBrowserViewBounds;
  viewport: BbDesktopBrowserViewportBounds;
}

function clampIntegerToRange(args: ClampIntegerToRangeArgs): number {
  return Math.min(Math.max(args.value, args.min), args.max);
}

export function clampBbDesktopBrowserViewBounds(
  args: ClampBbDesktopBrowserViewBoundsArgs,
): BbDesktopBrowserViewBounds {
  const viewportRight = Math.max(0, Math.round(args.viewport.width));
  const viewportBottom = Math.max(0, Math.round(args.viewport.height));
  const x = clampIntegerToRange({
    value: args.bounds.x,
    min: 0,
    max: viewportRight,
  });
  const y = clampIntegerToRange({
    value: args.bounds.y,
    min: 0,
    max: viewportBottom,
  });
  const right = clampIntegerToRange({
    value: args.bounds.x + args.bounds.width,
    min: x,
    max: viewportRight,
  });
  const bottom = clampIntegerToRange({
    value: args.bounds.y + args.bounds.height,
    min: y,
    max: viewportBottom,
  });

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

/**
 * Create-or-update the view for a browser tab. `url` may be empty to mean "no
 * page yet" (the renderer shows its new-tab screen and keeps the view hidden).
 *
 * Version-skew warning: the desktop shell attaches to any already-running bb
 * server that passes its health probe (no version handshake — see
 * apps/desktop/src/server-probe.ts) and loads the SPA that server serves, so
 * the renderer and the shell's main process routinely come from different
 * builds. This and the other `.strict()` browser request shapes are therefore
 * wire-frozen: adding a required field breaks old SPAs against a new shell,
 * and adding any field breaks new SPAs against an old shell's strict parser.
 * Change them only alongside an explicit capability/version negotiation in
 * the preload bridge.
 */
export const bbDesktopBrowserAttachRequestSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
    bounds: bbDesktopBrowserViewBoundsSchema,
    visible: z.boolean(),
  })
  .strict();
export type BbDesktopBrowserAttachRequest = z.infer<
  typeof bbDesktopBrowserAttachRequestSchema
>;

export const bbDesktopBrowserNavigateRequestSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().min(1).max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
export type BbDesktopBrowserNavigateRequest = z.infer<
  typeof bbDesktopBrowserNavigateRequestSchema
>;

export const bbDesktopBrowserSetBoundsRequestSchema = z
  .object({
    tabId: z.string().min(1),
    bounds: bbDesktopBrowserViewBoundsSchema,
  })
  .strict();
export type BbDesktopBrowserSetBoundsRequest = z.infer<
  typeof bbDesktopBrowserSetBoundsRequestSchema
>;

export const bbDesktopBrowserSetVisibleRequestSchema = z
  .object({
    tabId: z.string().min(1),
    visible: z.boolean(),
  })
  .strict();
export type BbDesktopBrowserSetVisibleRequest = z.infer<
  typeof bbDesktopBrowserSetVisibleRequestSchema
>;

/** Ref for tab-scoped commands with no other payload (detach/back/forward/reload/stop). */
export const bbDesktopBrowserTabRefSchema = z
  .object({
    tabId: z.string().min(1),
  })
  .strict();

/**
 * Current navigation state of a browser view, pushed main → renderer on every
 * relevant `webContents` event. A snapshot of live state — never a queue ladder.
 */
export const bbDesktopBrowserStateSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title: z.string().max(BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
    isLoading: z.boolean(),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
    errorText: z.string().max(BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
  })
  .strict();
export type BbDesktopBrowserState = z.infer<typeof bbDesktopBrowserStateSchema>;

/**
 * Request from main → renderer to open a popup (`window.open`/`target=_blank`)
 * as a new in-panel browser tab. The native OS popup window is always denied.
 */
export const bbDesktopBrowserOpenTabRequestSchema = z
  .object({
    url: z.string().min(1).max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
export type BbDesktopBrowserOpenTabRequest = z.infer<
  typeof bbDesktopBrowserOpenTabRequestSchema
>;

/**
 * Source-attributed variant of {@link bbDesktopBrowserOpenTabRequestSchema}.
 * Emitted on a new channel so the legacy wire-frozen popup event can remain
 * unchanged for desktop/SPA version skew.
 */
export const bbDesktopBrowserScopedOpenTabRequestSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().min(1).max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
export type BbDesktopBrowserScopedOpenTabRequest = z.infer<
  typeof bbDesktopBrowserScopedOpenTabRequestSchema
>;

/**
 * Upper bound for a snapshot data URL. A JPEG of a full-window view on a 5K
 * display lands well under this; the cap exists so a misbehaving push can
 * never balloon renderer memory.
 */
export const BB_DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH = 8_388_608;

/** Hard limits for the experimental page-inspection bridge. */
export const BB_DESKTOP_BROWSER_INSPECTION_MAX_STRUCTURED_BYTES = 131_072;
export const BB_DESKTOP_BROWSER_INSPECTION_MAX_PNG_BYTES = 8 * 1024 * 1024;
export const BB_DESKTOP_BROWSER_INSPECTION_MAX_PNG_DATA_URL_LENGTH =
  Math.ceil((BB_DESKTOP_BROWSER_INSPECTION_MAX_PNG_BYTES * 4) / 3) + 64;
export const BB_DESKTOP_BROWSER_INSPECTION_MAX_DOM_LENGTH = 16_384;
export const BB_DESKTOP_BROWSER_INSPECTION_MAX_TEXT_LENGTH = 2_000;
export const BB_DESKTOP_BROWSER_INSPECTION_MAX_SELECTOR_LENGTH = 2_048;

const bbDesktopBrowserInspectionFiniteNumberSchema = z
  .number()
  .finite()
  .min(-10_000_000)
  .max(10_000_000);

export const bbDesktopBrowserInspectionPointSchema = z
  .object({
    x: bbDesktopBrowserInspectionFiniteNumberSchema,
    y: bbDesktopBrowserInspectionFiniteNumberSchema,
  })
  .strict();

export const bbDesktopBrowserInspectionSizeSchema = z
  .object({
    width: bbDesktopBrowserInspectionFiniteNumberSchema.nonnegative(),
    height: bbDesktopBrowserInspectionFiniteNumberSchema.nonnegative(),
  })
  .strict();

export const bbDesktopBrowserInspectionRectSchema = z
  .object({
    x: bbDesktopBrowserInspectionFiniteNumberSchema,
    y: bbDesktopBrowserInspectionFiniteNumberSchema,
    width: bbDesktopBrowserInspectionFiniteNumberSchema.nonnegative(),
    height: bbDesktopBrowserInspectionFiniteNumberSchema.nonnegative(),
  })
  .strict();

/** A new channel carries this shape; the frozen attach wire is unchanged. */
export const bbDesktopBrowserInspectionRequestSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    requestId: z.string().min(1).max(256),
    kind: z.enum(["element", "region", "auto"]),
  })
  .strict();
export type BbDesktopBrowserInspectionRequest = z.infer<
  typeof bbDesktopBrowserInspectionRequestSchema
>;

export const bbDesktopBrowserInspectionCancelRequestSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    requestId: z.string().min(1).max(256),
  })
  .strict();

const bbDesktopBrowserInspectionPageSchema = z
  .object({
    url: z.string().max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title: z.string().max(BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
    viewport: bbDesktopBrowserInspectionSizeSchema,
    scroll: bbDesktopBrowserInspectionPointSchema,
  })
  .strict();

const bbDesktopBrowserInspectionStylesSchema = z
  .object({
    display: z.string().max(256).optional(),
    position: z.string().max(256).optional(),
    color: z.string().max(256).optional(),
    backgroundColor: z.string().max(256).optional(),
    fontFamily: z.string().max(512).optional(),
    fontSize: z.string().max(256).optional(),
    fontWeight: z.string().max(256).optional(),
    lineHeight: z.string().max(256).optional(),
    margin: z.string().max(256).optional(),
    padding: z.string().max(256).optional(),
    border: z.string().max(512).optional(),
    borderRadius: z.string().max(256).optional(),
    boxShadow: z.string().max(512).optional(),
    opacity: z.string().max(256).optional(),
    overflow: z.string().max(256).optional(),
    zIndex: z.string().max(256).optional(),
    flex: z.string().max(256).optional(),
    grid: z.string().max(512).optional(),
    transform: z.string().max(512).optional(),
  })
  .strict();

const bbDesktopBrowserInspectionAriaAttributesSchema = z
  .object({
    "aria-label": z.string().max(512).optional(),
    "aria-labelledby": z.string().max(512).optional(),
    "aria-describedby": z.string().max(512).optional(),
    "aria-expanded": z.string().max(64).optional(),
    "aria-pressed": z.string().max(64).optional(),
    "aria-checked": z.string().max(64).optional(),
    "aria-current": z.string().max(64).optional(),
    "aria-hidden": z.string().max(64).optional(),
  })
  .strict();

const bbDesktopBrowserInspectionElementDescriptorSchema = z
  .object({
    selector: z.string().max(BB_DESKTOP_BROWSER_INSPECTION_MAX_SELECTOR_LENGTH),
    tag: z.string().min(1).max(64),
    id: z.string().max(256).nullable(),
    classNames: z.array(z.string().max(256)).max(12),
    text: z.string().max(240),
    rect: bbDesktopBrowserInspectionRectSchema,
  })
  .strict();

export const bbDesktopBrowserInspectionLocatorSchema = z
  .object({
    selectors: z
      .array(
        z
          .string()
          .min(1)
          .max(BB_DESKTOP_BROWSER_INSPECTION_MAX_SELECTOR_LENGTH),
      )
      .min(1)
      .max(8),
  })
  .strict();

const bbDesktopBrowserInspectionAccessibilityHintSchema = z
  .object({
    source: z.literal("dom-hint"),
    roleHint: z.string().max(256).nullable(),
    nameHint: z.string().max(512).nullable(),
    attributes: bbDesktopBrowserInspectionAriaAttributesSchema,
  })
  .strict();

const bbDesktopBrowserInspectionRegionAccessibilityHintSchema =
  bbDesktopBrowserInspectionAccessibilityHintSchema.refine(
    (value) =>
      value.roleHint !== null ||
      value.nameHint !== null ||
      Object.keys(value.attributes).length > 0,
    "Region accessibility hints must contain target-specific signal",
  );

const bbDesktopBrowserInspectionReactHintSchema = z
  .object({
    componentStack: z.array(z.string().min(1).max(256)).max(20),
    source: z
      .object({
        fileName: z.string().min(1).max(1_024),
        lineNumber: z.number().int().positive().max(10_000_000),
        columnNumber: z.number().int().positive().max(10_000_000).nullable(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (value) => value.componentStack.length > 0 || value.source !== undefined,
    "Region React hints must contain target-specific signal",
  );

const bbDesktopBrowserInspectionElementContextSchema =
  bbDesktopBrowserInspectionElementDescriptorSchema
    .omit({ text: true })
    .extend({
      dom: z.string().max(BB_DESKTOP_BROWSER_INSPECTION_MAX_DOM_LENGTH),
      text: z.string().max(BB_DESKTOP_BROWSER_INSPECTION_MAX_TEXT_LENGTH),
      styles: bbDesktopBrowserInspectionStylesSchema,
      accessibility: bbDesktopBrowserInspectionAccessibilityHintSchema,
      reactComponentStack: z
        .array(z.string().min(1).max(256))
        .max(20)
        .nullable(),
    })
    .strict();

const bbDesktopBrowserInspectionRegionTargetSchema = z
  .object({
    absoluteLocator: bbDesktopBrowserInspectionLocatorSchema,
    relativeLocator: bbDesktopBrowserInspectionLocatorSchema,
    text: z.string().max(240),
    rect: bbDesktopBrowserInspectionRectSchema,
    accessibility:
      bbDesktopBrowserInspectionRegionAccessibilityHintSchema.optional(),
    react: bbDesktopBrowserInspectionReactHintSchema.optional(),
  })
  .strict();

const bbDesktopBrowserInspectionRegionGroupSchema = z
  .object({
    absoluteLocator: bbDesktopBrowserInspectionLocatorSchema,
    relativeLocator: bbDesktopBrowserInspectionLocatorSchema,
    count: z.number().int().positive().max(1_000_000),
    rect: bbDesktopBrowserInspectionRectSchema,
  })
  .strict();

const bbDesktopBrowserInspectionRegionContextV1Schema = z
  .object({
    elements: z
      .array(bbDesktopBrowserInspectionElementDescriptorSchema)
      .max(20),
  })
  .strict();

const bbDesktopBrowserInspectionRegionContextV2Schema = z
  .object({
    commonAncestor: z
      .object({
        kind: z.enum(["element", "shadow-root", "composed-element"]),
        absoluteLocator: bbDesktopBrowserInspectionLocatorSchema,
      })
      .strict()
      .nullable(),
    targets: z.array(bbDesktopBrowserInspectionRegionTargetSchema).max(64),
    groups: z.array(bbDesktopBrowserInspectionRegionGroupSchema).max(24),
    omittedTargetCount: z.number().int().nonnegative().max(10_000_000),
    omittedGroupCount: z.number().int().nonnegative().max(10_000_000),
    scanTruncated: z.boolean(),
  })
  .strict();

const bbDesktopBrowserInspectionPageResultV1ObjectSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(["element", "region"]),
    page: bbDesktopBrowserInspectionPageSchema,
    rect: bbDesktopBrowserInspectionRectSchema,
    deviceScaleFactor: z.number().finite().positive().max(16),
    element: bbDesktopBrowserInspectionElementContextSchema.nullable(),
    region: bbDesktopBrowserInspectionRegionContextV1Schema.nullable(),
  })
  .strict();

const bbDesktopBrowserInspectionPageResultV2ObjectSchema = z
  .object({
    version: z.literal(2),
    kind: z.enum(["element", "region"]),
    page: bbDesktopBrowserInspectionPageSchema,
    rect: bbDesktopBrowserInspectionRectSchema,
    deviceScaleFactor: z.number().finite().positive().max(16),
    element: bbDesktopBrowserInspectionElementContextSchema.nullable(),
    region: bbDesktopBrowserInspectionRegionContextV2Schema.nullable(),
  })
  .strict();

/** Untrusted result returned by the page-world controller before capturePage. */
export const bbDesktopBrowserInspectionPageResultSchema =
  bbDesktopBrowserInspectionPageResultV1ObjectSchema.superRefine(
    (value, context) => {
      const correctBranch =
        value.kind === "element"
          ? value.element !== null && value.region === null
          : value.region !== null && value.element === null;
      if (!correctBranch) {
        context.addIssue({
          code: "custom",
          message: "Inspection result does not match its capture kind",
        });
      }
      if (
        new TextEncoder().encode(JSON.stringify(value)).byteLength >
        BB_DESKTOP_BROWSER_INSPECTION_MAX_STRUCTURED_BYTES
      ) {
        context.addIssue({
          code: "custom",
          message: "Inspection result exceeds the structured payload limit",
        });
      }
    },
  );
export type BbDesktopBrowserInspectionPageResult = z.infer<
  typeof bbDesktopBrowserInspectionPageResultSchema
>;

/** Version-two page result for deterministic, shadow-aware region capture. */
export const bbDesktopBrowserInspectionPageResultV2Schema =
  bbDesktopBrowserInspectionPageResultV2ObjectSchema.superRefine(
    (value, context) => {
      const correctBranch =
        value.kind === "element"
          ? value.element !== null && value.region === null
          : value.region !== null && value.element === null;
      if (!correctBranch) {
        context.addIssue({
          code: "custom",
          message: "Inspection result does not match its capture kind",
        });
      }
      if (
        value.region !== null &&
        value.region.commonAncestor === null &&
        (value.region.targets.length > 0 ||
          value.region.groups.length > 0 ||
          value.region.omittedTargetCount > 0 ||
          value.region.omittedGroupCount > 0)
      ) {
        context.addIssue({
          code: "custom",
          path: ["region", "commonAncestor"],
          message:
            "Only an empty geometric region may omit its common ancestor",
        });
      }
      if (
        new TextEncoder().encode(JSON.stringify(value)).byteLength >
        BB_DESKTOP_BROWSER_INSPECTION_MAX_STRUCTURED_BYTES
      ) {
        context.addIssue({
          code: "custom",
          message: "Inspection result exceeds the structured payload limit",
        });
      }
    },
  );
export type BbDesktopBrowserInspectionPageResultV2 = z.infer<
  typeof bbDesktopBrowserInspectionPageResultV2Schema
>;

function decodedPngBytes(dataUrl: string): number {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) return Number.POSITIVE_INFINITY;
  const payload = dataUrl.slice(prefix.length);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

const bbDesktopBrowserInspectionScreenshotSchema = z
  .object({
    dataUrl: z
      .string()
      .max(BB_DESKTOP_BROWSER_INSPECTION_MAX_PNG_DATA_URL_LENGTH)
      .refine(
        (value) =>
          decodedPngBytes(value) <= BB_DESKTOP_BROWSER_INSPECTION_MAX_PNG_BYTES,
        "Inspection PNG exceeds the image limit",
      ),
    pixelSize: bbDesktopBrowserInspectionSizeSchema,
    deviceScaleFactor: z.number().finite().positive().max(16),
    pageZoom: z.number().finite().positive().max(16),
    cssToImageScale: bbDesktopBrowserInspectionPointSchema.refine(
      (value) => value.x > 0 && value.y > 0,
      "Image scale must be positive",
    ),
  })
  .strict();

const withInspectionResultLimit = <T extends z.ZodType>(schema: T) =>
  schema.superRefine((value, context) => {
    const record = value as { screenshot: { dataUrl: string } };
    const { dataUrl: _dataUrl, ...screenshot } = record.screenshot;
    const structured = { ...(value as object), screenshot };
    if (
      new TextEncoder().encode(JSON.stringify(structured)).byteLength >
      BB_DESKTOP_BROWSER_INSPECTION_MAX_STRUCTURED_BYTES
    ) {
      context.addIssue({
        code: "custom",
        message: "Inspection result exceeds the structured payload limit",
      });
    }
  });

export const bbDesktopBrowserInspectionResultSchema = withInspectionResultLimit(
  bbDesktopBrowserInspectionPageResultV1ObjectSchema
    .omit({ deviceScaleFactor: true })
    .extend({
      screenshot: bbDesktopBrowserInspectionScreenshotSchema,
    })
    .strict(),
);
export type BbDesktopBrowserInspectionResult = z.infer<
  typeof bbDesktopBrowserInspectionResultSchema
>;

export const bbDesktopBrowserInspectionResultV2Schema =
  withInspectionResultLimit(
    bbDesktopBrowserInspectionPageResultV2ObjectSchema
      .omit({ deviceScaleFactor: true })
      .extend({
        screenshot: bbDesktopBrowserInspectionScreenshotSchema,
      })
      .strict(),
  );
export type BbDesktopBrowserInspectionResultV2 = z.infer<
  typeof bbDesktopBrowserInspectionResultV2Schema
>;

/**
 * A transient bitmap of a browser view, pushed main → renderer at the start
 * of a native window resize burst while the native view is hidden (the
 * independently composited overlay cannot stay visually glued to the chrome
 * mid-resize). The renderer paints it inside the panel so it scales with the
 * chrome. `dataUrl: null` clears the placeholder once the resize settles and
 * the live view is shown again.
 */
export const bbDesktopBrowserSnapshotSchema = z
  .object({
    tabId: z.string().min(1),
    dataUrl: z
      .string()
      .max(BB_DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH)
      .nullable(),
  })
  .strict();
export type BbDesktopBrowserSnapshot = z.infer<
  typeof bbDesktopBrowserSnapshotSchema
>;

export type BbDesktopBrowserStateHandler = (
  state: BbDesktopBrowserState,
) => void;
export type BbDesktopBrowserOpenTabHandler = (
  request: BbDesktopBrowserOpenTabRequest,
) => void;
export type BbDesktopBrowserScopedOpenTabHandler = (
  request: BbDesktopBrowserScopedOpenTabRequest,
) => void;
export type BbDesktopBrowserSnapshotHandler = (
  snapshot: BbDesktopBrowserSnapshot,
) => void;
export type BbDesktopBrowserUnsubscribe = () => void;

export interface BbDesktopBrowserApi {
  /** Create (or reuse) and show the view for `tabId`, loading `url` if non-empty. */
  attach(request: BbDesktopBrowserAttachRequest): void;
  /** Destroy the view for `tabId` (tears down its `webContents`). */
  detach(tabId: string): void;
  navigate(request: BbDesktopBrowserNavigateRequest): void;
  goBack(tabId: string): void;
  goForward(tabId: string): void;
  reload(tabId: string): void;
  stop(tabId: string): void;
  setBounds(request: BbDesktopBrowserSetBoundsRequest): void;
  setVisible(request: BbDesktopBrowserSetVisibleRequest): void;
  /** Optional for desktop/SPA version skew. `null` means cancellation. */
  experimental_inspectPage?(
    request: BbDesktopBrowserInspectionRequest,
  ): Promise<BbDesktopBrowserInspectionResult | null>;
  /** Optional V2 capability with deterministic, shadow-aware region results. */
  experimental_inspectPageV2?(
    request: BbDesktopBrowserInspectionRequest,
  ): Promise<BbDesktopBrowserInspectionResultV2 | null>;
  /** Cancel the active experimental inspection for `tabId`, if any. */
  experimental_cancelPageInspection?(tabId: string, requestId: string): void;
  /** Subscribe to navigation-state pushes for every view in this window. */
  onState(listener: BbDesktopBrowserStateHandler): BbDesktopBrowserUnsubscribe;
  /** Subscribe to popup requests that should open as a new in-panel browser tab. */
  onOpenTab(
    listener: BbDesktopBrowserOpenTabHandler,
  ): BbDesktopBrowserUnsubscribe;
  /**
   * Subscribe to popup requests with the originating browser tab id. Optional
   * for version skew with desktop shells that predate source-attributed popups.
   */
  onScopedOpenTab?(
    listener: BbDesktopBrowserScopedOpenTabHandler,
  ): BbDesktopBrowserUnsubscribe;
  /**
   * Subscribe to resize-burst snapshot pushes. Optional purely for version
   * skew: the SPA routinely attaches to an older desktop shell whose preload
   * predates snapshots (see the wire-freeze note on
   * {@link bbDesktopBrowserAttachRequestSchema}); callers feature-detect and
   * fall back to the bare panel background during resizes.
   */
  onSnapshot?(
    listener: BbDesktopBrowserSnapshotHandler,
  ): BbDesktopBrowserUnsubscribe;
}
