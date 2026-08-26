import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  UrlLink,
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type PluginNavPanelProps,
  type PluginSettingsSectionProps,
} from "@get-bb/plugin-sdk/app";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { Textarea } from "@bb/shared-ui/textarea";

import type { rpcContract } from "./server";
import {
  SceneRenderer,
  type SceneRenderObject,
  type SceneRenderProbeEvent,
} from "./scene-renderer.js";
import {
  createSceneSeedUiFixture,
  SCENESEED_QA_SUBPATH,
} from "./sceneseed-ui-fixture.js";
import type {
  CanvasSnapshotDto,
  CanvasSummaryDto,
  CardDto,
  JobDto,
  ObjectDto,
  Placement,
  Transform3D,
} from "./store.js";
import "./app.css";

const PANEL_PATH = "sceneseed";
const ACTIVE_CARD_STATES = new Set<CardDto["state"]>([
  "ready",
  "queued",
  "interpreting",
  "realizing",
]);

type ConnectionState = ReturnType<typeof useRealtimeConnectionState>;

interface DraftCard {
  id: string;
  prompt: string;
}

type PlacementSource =
  | { kind: "draft"; id: string; prompt: string }
  | { kind: "card"; id: string; prompt: string };

interface WorkspaceActions {
  rename(name: string): Promise<void>;
  deleteCanvas(): Promise<void>;
  place(source: PlacementSource, placement: Placement): Promise<void>;
  cancel(jobId: string): Promise<void>;
  transform(object: ObjectDto, transform: Transform3D): Promise<void>;
  remix(objectId: string): Promise<void>;
  duplicate(object: ObjectDto): Promise<void>;
  remove(object: ObjectDto): Promise<void>;
}

function nextClientId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (id) return `${prefix}_${id.replaceAll("-", "")}`;
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCanvasSignal(
  payload: unknown,
): payload is { canvasId: string; revision: number } {
  if (typeof payload !== "object" || payload === null) return false;
  return (
    "canvasId" in payload &&
    typeof payload.canvasId === "string" &&
    "revision" in payload &&
    typeof payload.revision === "number"
  );
}

function canvasSubPath(canvasId: string): string {
  return `canvas/${encodeURIComponent(canvasId)}`;
}

function parseCanvasId(subPath: string): string | null {
  if (!subPath.startsWith("canvas/")) return null;
  const encoded = subPath.slice("canvas/".length);
  if (!encoded || encoded.includes("/")) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function formatRelativeTime(timestamp: number, now: number): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}

function cardStateLabel(card: CardDto): string {
  switch (card.state) {
    case "ready":
      return "Ready";
    case "queued":
      return "Queued";
    case "interpreting":
      return "Interpreting";
    case "realizing":
      return "Realizing";
    case "complete":
      return "Complete";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return "Failed";
  }
}

function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function useDisclosure(): {
  acknowledged: boolean | null;
  acknowledge: () => Promise<void>;
  error: string | null;
} {
  const rpc = useRpc<typeof rpcContract>();
  const [acknowledged, setAcknowledged] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void rpc.call("listCanvases").then(
      (result) => {
        if (active) setAcknowledged(result.disclosureAcknowledged);
      },
      (reason: unknown) => {
        if (active) setError(errorMessage(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [rpc]);
  const acknowledge = useCallback(async () => {
    setError(null);
    try {
      await rpc.call("acknowledgeDisclosure");
      setAcknowledged(true);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [rpc]);
  return { acknowledged, acknowledge, error };
}

function Disclosure({
  acknowledged,
  error,
  onAcknowledge,
}: {
  acknowledged: boolean | null;
  error: string | null;
  onAcknowledge: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  if (acknowledged !== false) return null;
  return (
    <section
      className="sceneseed-disclosure"
      aria-labelledby="sceneseed-disclosure-title"
    >
      <div>
        <p className="sceneseed-eyebrow">Before the first seed</p>
        <h2 id="sceneseed-disclosure-title">
          Know what the interpreter can access
        </h2>
      </div>
      <p>
        SceneSeed sends the prompt, placement, and nearby scene summaries to a
        hidden bb agent in the personal project. Hidden means absent from normal
        navigation, not secret or ephemeral.
      </p>
      <p>
        It is still a normal bb agent session and may have core, provider, and
        plugin tools, shared skills and instructions, filesystem access, and
        network access. Prompts and transcripts follow your provider and bb
        retention settings.
      </p>
      <p>
        Uninstalling SceneSeed does not delete its canvas database or hidden
        threads. “Delete all canvas data” clears the plugin database and
        archives those threads.
      </p>
      <div className="sceneseed-disclosure-actions">
        <UrlLink href="/settings/providers" className="sceneseed-text-link">
          Review provider settings
        </UrlLink>
        <Button
          type="button"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void onAcknowledge().finally(() => setSaving(false));
          }}
        >
          {saving ? "Saving…" : "I understand"}
        </Button>
      </div>
      {error ? (
        <p className="sceneseed-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function LibraryPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const connection = useRealtimeConnectionState();
  const [canvases, setCanvases] = useState<CanvasSummaryDto[] | null>(null);
  const [newName, setNewName] = useState("Untitled canvas");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useClock(false);
  const disclosure = useDisclosure();

  const refresh = useCallback(() => {
    void rpc.call("listCanvases").then(
      (result) => {
        setCanvases(result.canvases);
        setError(null);
      },
      (reason: unknown) => setError(errorMessage(reason)),
    );
  }, [rpc]);

  useEffect(refresh, [refresh]);
  useRealtime("library-changed", refresh);
  useEffect(() => {
    if (connection === "connected") refresh();
  }, [connection, refresh]);

  const create = async () => {
    const name = newName.trim();
    if (!name || creating || connection !== "connected") return;
    setCreating(true);
    setError(null);
    try {
      const result = await rpc.call("createCanvas", { name });
      navigate.toPluginPanel(PANEL_PATH, {
        subPath: canvasSubPath(result.snapshot.canvas.id),
      });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="sceneseed-library">
      <div className="sceneseed-library-intro">
        <div>
          <p className="sceneseed-eyebrow">Prompt → seed → scene</p>
          <h1>Grow an idea into a tiny world.</h1>
          <p>
            Drop a short phrase onto the canvas and see how the SceneSeed
            interpreter draws it in three dimensions.
          </p>
        </div>
        <form
          className="sceneseed-new-canvas"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label htmlFor="sceneseed-new-name">New canvas</label>
          <div>
            <Input
              id="sceneseed-new-name"
              value={newName}
              maxLength={80}
              onChange={(event) => setNewName(event.currentTarget.value)}
              disabled={connection !== "connected"}
            />
            <Button
              type="submit"
              disabled={
                !newName.trim() || creating || connection !== "connected"
              }
            >
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </div>

      <Disclosure
        acknowledged={disclosure.acknowledged}
        error={disclosure.error}
        onAcknowledge={disclosure.acknowledge}
      />

      {connection !== "connected" ? (
        <p className="sceneseed-connection" role="status">
          Reconnecting — saved canvases remain available, but changes are
          paused.
        </p>
      ) : null}
      {error ? (
        <p className="sceneseed-error" role="alert">
          {error}
        </p>
      ) : null}

      <section aria-labelledby="sceneseed-canvases-heading">
        <div className="sceneseed-section-heading">
          <div>
            <p className="sceneseed-eyebrow">Your work</p>
            <h2 id="sceneseed-canvases-heading">Canvases</h2>
          </div>
          <span>{canvases?.length ?? 0}</span>
        </div>
        {canvases === null ? (
          <div className="sceneseed-library-grid" aria-label="Loading canvases">
            <Skeleton className="h-36 rounded-xl" />
            <Skeleton className="h-36 rounded-xl" />
          </div>
        ) : canvases.length === 0 ? (
          <div className="sceneseed-empty-library">
            <div className="sceneseed-seed-mark" aria-hidden="true" />
            <h3>Your first canvas is waiting.</h3>
            <p>
              Create one above, then add a phrase you can picture—or one you
              cannot.
            </p>
          </div>
        ) : (
          <div className="sceneseed-library-grid">
            {canvases.map((canvas) => (
              <button
                key={canvas.id}
                type="button"
                className="sceneseed-canvas-card"
                onClick={() =>
                  navigate.toPluginPanel(PANEL_PATH, {
                    subPath: canvasSubPath(canvas.id),
                  })
                }
              >
                <span
                  className="sceneseed-canvas-card-mark"
                  aria-hidden="true"
                />
                <span className="sceneseed-canvas-card-name">
                  {canvas.name}
                </span>
                <span className="sceneseed-canvas-card-meta">
                  {canvas.objectCount}{" "}
                  {canvas.objectCount === 1 ? "object" : "objects"}
                  <span aria-hidden="true"> · </span>
                  {canvas.activeCost}/100 units
                </span>
                <span className="sceneseed-canvas-card-time">
                  Edited {formatRelativeTime(canvas.updatedAt, now)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

class RendererBoundary extends Component<
  { resetKey: number; children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidUpdate(previous: Readonly<{ resetKey: number }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {}

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function RendererUnavailable({ onReload }: { onReload: () => void }) {
  return (
    <div className="sceneseed-renderer-fallback" role="status">
      <div className="sceneseed-seed-mark" aria-hidden="true" />
      <h3>The 3D canvas is resting.</h3>
      <p>
        WebGL is unavailable or its context was lost. Your prompts and objects
        are still saved.
      </p>
      <Button type="button" variant="outline" onClick={onReload}>
        Reload renderer
      </Button>
    </div>
  );
}

function activeJobForCard(
  snapshot: CanvasSnapshotDto,
  card: CardDto,
): JobDto | null {
  if (!card.activeJobId) return null;
  return snapshot.jobs.find((job) => job.id === card.activeJobId) ?? null;
}

function objectForCard(
  snapshot: CanvasSnapshotDto,
  cardId: string,
): ObjectDto | null {
  return (
    snapshot.objects.find(
      (object) => object.sourceCardId === cardId && object.removedAt === null,
    ) ?? null
  );
}

function buildRenderObjects(
  snapshot: CanvasSnapshotDto,
  revealingObjectIds: ReadonlySet<string>,
  realizationAttemptIds: ReadonlyMap<string, string> = new Map(),
): SceneRenderObject[] {
  const objects: SceneRenderObject[] = [];
  for (const object of snapshot.objects) {
    if (object.removedAt !== null) continue;
    const active = snapshot.candidates.find(
      (candidate) => candidate.id === object.activeSceneId,
    );
    if (active?.normalizedScene) {
      objects.push({
        scene: active.normalizedScene,
        position: object.transform.position,
        rotation: object.transform.rotation,
        scale: object.transform.scale,
        revisionKey: active.id,
        reveal: revealingObjectIds.has(object.id),
      });
    }
    const currentJob = object.activeJobId
      ? snapshot.jobs.find((job) => job.id === object.activeJobId)
      : null;
    if (currentJob?.state !== "realizing") continue;
    const pending = snapshot.candidates.find(
      (candidate) =>
        candidate.jobId === currentJob.id &&
        candidate.state === "pending" &&
        candidate.normalizedScene !== null,
    );
    if (!pending?.normalizedScene) continue;
    const attemptId = realizationAttemptIds.get(pending.id);
    if (!attemptId) continue;
    objects.push({
      scene: pending.normalizedScene,
      position: object.transform.position,
      rotation: object.transform.rotation,
      scale: object.transform.scale,
      revisionKey: `${pending.id}:${attemptId}`,
      reveal: true,
      probeOnly: true,
    });
  }
  return objects;
}

function PromptCard({
  card,
  snapshot,
  readOnly,
  selected,
  now,
  setRef,
  onSelect,
  onPlace,
  onCancel,
  onDragStart,
}: {
  card: CardDto;
  snapshot: CanvasSnapshotDto;
  readOnly: boolean;
  selected: boolean;
  now: number;
  setRef: (element: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onPlace: () => void;
  onCancel: (jobId: string) => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
}) {
  const job = activeJobForCard(snapshot, card);
  const placeable =
    card.state === "ready" ||
    card.state === "cancelled" ||
    card.state === "failed";
  const cancellable = card.state === "queued" || card.state === "interpreting";
  const object = objectForCard(snapshot, card.id);
  const startedAt = job?.startedAt ?? job?.createdAt ?? card.updatedAt;
  return (
    <article
      className="sceneseed-prompt-card"
      data-state={card.state}
      data-selected={selected ? "true" : "false"}
      draggable={placeable && !readOnly}
      onDragStart={onDragStart}
    >
      <button
        ref={setRef}
        type="button"
        className="sceneseed-card-prompt"
        onClick={onSelect}
        disabled={object === null}
        aria-pressed={selected}
      >
        {card.prompt}
      </button>
      <div className="sceneseed-card-footer">
        <span className="sceneseed-status" data-state={card.state}>
          <span aria-hidden="true" />
          {cardStateLabel(card)}
        </span>
        {(card.state === "interpreting" || card.state === "realizing") &&
        job ? (
          <span>{Math.max(1, Math.floor((now - startedAt) / 1_000))}s</span>
        ) : null}
        {placeable ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={readOnly}
            onClick={onPlace}
          >
            {card.state === "ready" ? "Place" : "Retry"}
          </Button>
        ) : null}
        {cancellable && job ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={readOnly}
            onClick={() => onCancel(job.id)}
          >
            Cancel
          </Button>
        ) : null}
      </div>
      {card.state === "failed" && job?.errorMessage ? (
        <p className="sceneseed-card-error">{job.errorMessage}</p>
      ) : null}
    </article>
  );
}

function DraftPromptCard({
  draft,
  readOnly,
  atCapacity,
  setRef,
  onChange,
  onPlace,
  onDragStart,
}: {
  draft: DraftCard;
  readOnly: boolean;
  atCapacity: boolean;
  setRef: (element: HTMLTextAreaElement | null) => void;
  onChange: (value: string) => void;
  onPlace: () => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
}) {
  const valid = draft.prompt.trim().length > 0;
  return (
    <article
      className="sceneseed-prompt-card sceneseed-draft-card"
      draggable={valid && !readOnly && !atCapacity}
      onDragStart={onDragStart}
    >
      <label className="sceneseed-sr-only" htmlFor={`draft-${draft.id}`}>
        Prompt for a new SceneSeed object
      </label>
      <Textarea
        ref={setRef}
        id={`draft-${draft.id}`}
        value={draft.prompt}
        maxLength={500}
        rows={3}
        placeholder="Write a prompt…"
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key === "Enter" &&
            valid
          ) {
            event.preventDefault();
            onPlace();
          }
        }}
      />
      <div className="sceneseed-card-footer">
        <span>{draft.prompt.length}/500</span>
        {readOnly && valid ? (
          <span className="sceneseed-unsaved">Unsaved</span>
        ) : null}
        {atCapacity ? <span>12 in flight</span> : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!valid || readOnly || atCapacity}
          onClick={onPlace}
        >
          Place on canvas
        </Button>
      </div>
    </article>
  );
}

function PlacementLayer({
  cursor,
  prompt,
  stageRef,
  onMove,
  onCommit,
  onCancel,
}: {
  cursor: Placement;
  prompt: string;
  stageRef: React.RefObject<HTMLDivElement | null>;
  onMove: (placement: Placement) => void;
  onCommit: (placement: Placement) => void;
  onCancel: () => void;
}) {
  const pointFromPointer = (clientX: number, clientY: number): Placement => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return cursor;
    return {
      x: Math.max(
        -8,
        Math.min(8, ((clientX - rect.left) / rect.width - 0.5) * 16),
      ),
      y: Math.max(
        -6,
        Math.min(6, (0.5 - (clientY - rect.top) / rect.height) * 12),
      ),
    };
  };
  const keyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 1 : 0.5;
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onCommit(cursor);
      return;
    }
    const delta: Placement | null =
      event.key === "ArrowLeft"
        ? { x: -step, y: 0 }
        : event.key === "ArrowRight"
          ? { x: step, y: 0 }
          : event.key === "ArrowUp"
            ? { x: 0, y: step }
            : event.key === "ArrowDown"
              ? { x: 0, y: -step }
              : null;
    if (!delta) return;
    event.preventDefault();
    onMove({
      x: Math.max(-8, Math.min(8, cursor.x + delta.x)),
      y: Math.max(-6, Math.min(6, cursor.y + delta.y)),
    });
  };
  return (
    <div
      className="sceneseed-placement-layer"
      role="button"
      tabIndex={0}
      aria-label={`Place “${prompt}”. Move with arrow keys, press Enter to place, or Escape to cancel.`}
      onPointerMove={(event) =>
        onMove(pointFromPointer(event.clientX, event.clientY))
      }
      onClick={(event) =>
        onCommit(pointFromPointer(event.clientX, event.clientY))
      }
      onKeyDown={keyboard}
    >
      <span
        className="sceneseed-placement-cursor"
        style={{
          left: `${((cursor.x + 8) / 16) * 100}%`,
          top: `${((6 - cursor.y) / 12) * 100}%`,
        }}
      >
        <span aria-hidden="true" />
        <strong>Plant here</strong>
      </span>
      <button
        type="button"
        className="sceneseed-placement-cancel"
        onClick={(event) => {
          event.stopPropagation();
          onCancel();
        }}
      >
        Cancel placement
      </button>
    </div>
  );
}

function ObjectControls({
  object,
  card,
  readOnly,
  actionRef,
  onTransform,
  onRemix,
  onDuplicate,
  onRemove,
}: {
  object: ObjectDto;
  card: CardDto;
  readOnly: boolean;
  actionRef: (element: HTMLButtonElement | null) => void;
  onTransform: (transform: Transform3D) => void;
  onRemix: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const transform = object.transform;
  const move = (x: number, z: number) =>
    onTransform({
      ...transform,
      position: [
        transform.position[0] + x,
        transform.position[1],
        transform.position[2] + z,
      ],
    });
  const rotate = (delta: number) =>
    onTransform({
      ...transform,
      rotation: [
        transform.rotation[0],
        transform.rotation[1] + delta,
        transform.rotation[2],
      ],
    });
  const scale = (factor: number) =>
    onTransform({
      ...transform,
      scale: transform.scale.map((value) =>
        Math.max(0.1, Math.min(10, value * factor)),
      ) as [number, number, number],
    });
  return (
    <section
      className="sceneseed-object-controls"
      aria-labelledby="sceneseed-selected-heading"
    >
      <div className="sceneseed-selected-copy">
        <p className="sceneseed-eyebrow">Selected object</p>
        <h3 id="sceneseed-selected-heading">{card.prompt}</h3>
      </div>
      <div className="sceneseed-transform-groups">
        <div className="sceneseed-control-group" aria-label="Move object">
          <span>Move</span>
          <Button
            ref={actionRef}
            type="button"
            size="sm"
            variant="outline"
            disabled={readOnly}
            aria-label="Move object left"
            onClick={() => move(-0.5, 0)}
          >
            ←
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={readOnly}
            aria-label="Move object forward"
            onClick={() => move(0, -0.5)}
          >
            ↑
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={readOnly}
            aria-label="Move object back"
            onClick={() => move(0, 0.5)}
          >
            ↓
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={readOnly}
            aria-label="Move object right"
            onClick={() => move(0.5, 0)}
          >
            →
          </Button>
        </div>
        <div className="sceneseed-control-group" aria-label="Rotate object">
          <span>Rotate</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={readOnly}
            aria-label="Rotate object counterclockwise"
            onClick={() => rotate(-Math.PI / 12)}
          >
            ↶
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={readOnly}
            aria-label="Rotate object clockwise"
            onClick={() => rotate(Math.PI / 12)}
          >
            ↷
          </Button>
        </div>
        <div className="sceneseed-control-group" aria-label="Scale object">
          <span>Scale</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={readOnly}
            aria-label="Make object smaller"
            onClick={() => scale(0.9)}
          >
            −
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={readOnly}
            aria-label="Make object larger"
            onClick={() => scale(1.1)}
          >
            +
          </Button>
        </div>
      </div>
      <div className="sceneseed-object-actions">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={readOnly}
          onClick={onRemix}
        >
          Remix
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={readOnly}
          onClick={onDuplicate}
        >
          Duplicate
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={readOnly}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
    </section>
  );
}

function CanvasWorkspace({
  snapshot,
  connection,
  disclosureAcknowledged,
  actions,
  renderObjects,
  fixture = false,
  error,
  onRenderProbe,
  onRevealComplete,
}: {
  snapshot: CanvasSnapshotDto;
  connection: ConnectionState;
  disclosureAcknowledged: boolean;
  actions: WorkspaceActions;
  renderObjects: SceneRenderObject[];
  fixture?: boolean;
  error: string | null;
  onRenderProbe?: (event: SceneRenderProbeEvent) => void;
  onRevealComplete?: (objectId: string) => void;
}) {
  const navigate = useBbNavigate();
  const readOnly = connection !== "connected" || !disclosureAcknowledged;
  const [drafts, setDrafts] = useState<DraftCard[]>(() => [
    { id: nextClientId("draft"), prompt: "" },
  ]);
  const [placementSource, setPlacementSource] =
    useState<PlacementSource | null>(null);
  const [placementCursor, setPlacementCursor] = useState<Placement>({
    x: 0,
    y: 0,
  });
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(
    snapshot.objects.find((object) => object.removedAt === null)?.id ?? null,
  );
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(snapshot.canvas.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rendererReset, setRendererReset] = useState(0);
  const [rendererLost, setRendererLost] = useState(false);
  const [announcement, setAnnouncement] = useState("Canvas restored.");
  const [busy, setBusy] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const objectActionRefs = useRef(new Map<string, HTMLButtonElement>());
  const draftRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const hasLiveStatus = snapshot.cards.some(
    (card) => card.state === "interpreting" || card.state === "realizing",
  );
  const now = useClock(hasLiveStatus);
  const inFlightCount = snapshot.cards.filter((card) =>
    ACTIVE_CARD_STATES.has(card.state),
  ).length;

  useEffect(() => setRenameValue(snapshot.canvas.name), [snapshot.canvas.name]);
  useEffect(() => {
    if (
      selectedObjectId &&
      !snapshot.objects.some(
        (object) => object.id === selectedObjectId && object.removedAt === null,
      )
    ) {
      setSelectedObjectId(null);
    }
  }, [selectedObjectId, snapshot.objects]);

  const updateDraft = (id: string, prompt: string) => {
    setDrafts((current) => {
      let next = current.map((draft) =>
        draft.id === id ? { ...draft, prompt } : draft,
      );
      next = next.filter(
        (draft, index) => draft.prompt.trim() || index === next.length - 1,
      );
      if (next.at(-1)?.prompt.trim())
        next = [...next, { id: nextClientId("draft"), prompt: "" }];
      return next;
    });
  };

  const startPlacement = (source: PlacementSource) => {
    if (readOnly || busy) return;
    setPlacementSource(source);
    setPlacementCursor({ x: 0, y: 0 });
    window.requestAnimationFrame(() =>
      stageRef.current
        ?.querySelector<HTMLElement>(".sceneseed-placement-layer")
        ?.focus(),
    );
    setAnnouncement(`Placement active for ${source.prompt}.`);
  };

  const commitPlacement = async (
    source: PlacementSource,
    placement: Placement,
  ) => {
    if (readOnly || busy) return;
    setBusy(true);
    try {
      await actions.place(source, placement);
      if (source.kind === "draft") {
        setDrafts((current) => {
          const next = current.filter((draft) => draft.id !== source.id);
          return next.some((draft) => !draft.prompt.trim())
            ? next
            : [...next, { id: nextClientId("draft"), prompt: "" }];
        });
      }
      setPlacementSource(null);
      setAnnouncement(`${source.prompt} is queued.`);
    } catch {
      setAnnouncement("Placement failed. Your prompt is still here.");
    } finally {
      setBusy(false);
    }
  };

  const selectFromCard = (cardId: string) => {
    const object = objectForCard(snapshot, cardId);
    if (!object) return;
    setSelectedObjectId(object.id);
    setAnnouncement(
      `${snapshot.cards.find((card) => card.id === cardId)?.prompt ?? "Object"} selected.`,
    );
    window.requestAnimationFrame(() =>
      objectActionRefs.current.get(object.id)?.focus(),
    );
  };

  const selectFromRenderer = (objectId: string | null) => {
    setSelectedObjectId(objectId);
    if (!objectId) return;
    const object = snapshot.objects.find((entry) => entry.id === objectId);
    if (!object) return;
    window.requestAnimationFrame(() =>
      cardRefs.current.get(object.sourceCardId)?.focus(),
    );
  };

  const selectedObject = selectedObjectId
    ? (snapshot.objects.find(
        (object) => object.id === selectedObjectId && object.removedAt === null,
      ) ?? null)
    : null;
  const selectedCard = selectedObject
    ? (snapshot.cards.find((card) => card.id === selectedObject.sourceCardId) ??
      null)
    : null;

  const runAction = async (message: string, action: () => Promise<void>) => {
    if (readOnly || busy) return;
    setBusy(true);
    try {
      await action();
      setAnnouncement(message);
    } catch {
      setAnnouncement("Action failed. The canvas was reconciled.");
    } finally {
      setBusy(false);
    }
  };

  const dragSource = (
    event: React.DragEvent<HTMLDivElement>,
    source: PlacementSource,
  ) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "application/x-sceneseed-card",
      `${source.kind}|${source.id}`,
    );
  };

  const sourceFromDrop = (
    event: React.DragEvent<HTMLDivElement>,
  ): PlacementSource | null => {
    const [kind, id] = event.dataTransfer
      .getData("application/x-sceneseed-card")
      .split("|");
    if (kind === "draft") {
      const draft = drafts.find((entry) => entry.id === id);
      return draft?.prompt.trim()
        ? { kind: "draft", id: draft.id, prompt: draft.prompt.trim() }
        : null;
    }
    if (kind === "card") {
      const card = snapshot.cards.find((entry) => entry.id === id);
      return card ? { kind: "card", id: card.id, prompt: card.prompt } : null;
    }
    return null;
  };

  const pointFromDrop = (event: React.DragEvent<HTMLDivElement>): Placement => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: Math.max(
        -8,
        Math.min(8, ((event.clientX - rect.left) / rect.width - 0.5) * 16),
      ),
      y: Math.max(
        -6,
        Math.min(6, (0.5 - (event.clientY - rect.top) / rect.height) * 12),
      ),
    };
  };

  return (
    <main className="sceneseed-editor">
      <header className="sceneseed-editor-header">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => navigate.toPluginPanel(PANEL_PATH)}
        >
          ← Canvases
        </Button>
        {renaming ? (
          <form
            className="sceneseed-rename"
            onSubmit={(event) => {
              event.preventDefault();
              const name = renameValue.trim();
              if (!name) return;
              void runAction("Canvas renamed.", async () => {
                await actions.rename(name);
                setRenaming(false);
              });
            }}
          >
            <Input
              aria-label="Canvas name"
              value={renameValue}
              maxLength={80}
              onChange={(event) => setRenameValue(event.currentTarget.value)}
            />
            <Button
              type="submit"
              size="sm"
              disabled={readOnly || !renameValue.trim()}
            >
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setRenaming(false)}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <div className="sceneseed-editor-title">
            <h1>{snapshot.canvas.name}</h1>
            {fixture ? (
              <Badge variant="secondary">Visual QA fixture</Badge>
            ) : null}
          </div>
        )}
        <details className="sceneseed-canvas-menu">
          <summary aria-label="Canvas options">•••</summary>
          <div>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => setRenaming(true)}
            >
              Rename
            </button>
            {confirmDelete ? (
              <>
                <p>Delete this canvas and archive its hidden thread?</p>
                <button
                  type="button"
                  className="sceneseed-danger-action"
                  disabled={readOnly}
                  onClick={() =>
                    void runAction("Canvas deleted.", actions.deleteCanvas)
                  }
                >
                  Delete canvas
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)}>
                  Keep canvas
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={readOnly}
                onClick={() => setConfirmDelete(true)}
              >
                Delete canvas…
              </button>
            )}
          </div>
        </details>
      </header>

      {connection !== "connected" ? (
        <div className="sceneseed-offline-banner" role="status">
          Reconnecting — this canvas is read-only. Draft text is unsaved and may
          be lost.
        </div>
      ) : null}
      {error ? (
        <div className="sceneseed-editor-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="sceneseed-workspace">
        <aside className="sceneseed-card-rail" aria-label="Prompt cards">
          <div className="sceneseed-rail-heading">
            <div>
              <p className="sceneseed-eyebrow">Prompt cards</p>
              <h2>Plant an idea</h2>
            </div>
            <span>{inFlightCount}/12 in flight</span>
          </div>
          <p className="sceneseed-rail-instruction">
            Drag a ready card onto the stage, or choose Place for a click and
            keyboard path.
          </p>
          <div className="sceneseed-card-stack">
            {snapshot.cards.map((card) => {
              const object = objectForCard(snapshot, card.id);
              return (
                <PromptCard
                  key={card.id}
                  card={card}
                  snapshot={snapshot}
                  readOnly={readOnly || busy}
                  selected={object?.id === selectedObjectId}
                  now={now}
                  setRef={(element) => {
                    if (element) cardRefs.current.set(card.id, element);
                    else cardRefs.current.delete(card.id);
                  }}
                  onSelect={() => selectFromCard(card.id)}
                  onPlace={() =>
                    startPlacement({
                      kind: "card",
                      id: card.id,
                      prompt: card.prompt,
                    })
                  }
                  onCancel={(jobId) =>
                    void runAction(
                      "Generation cancelled. The prompt is ready to retry.",
                      () => actions.cancel(jobId),
                    )
                  }
                  onDragStart={(event) =>
                    dragSource(event, {
                      kind: "card",
                      id: card.id,
                      prompt: card.prompt,
                    })
                  }
                />
              );
            })}
            {drafts.map((draft) => (
              <DraftPromptCard
                key={draft.id}
                draft={draft}
                readOnly={
                  connection !== "connected" || busy || !disclosureAcknowledged
                }
                atCapacity={inFlightCount >= 12}
                setRef={(element) => {
                  if (element) draftRefs.current.set(draft.id, element);
                  else draftRefs.current.delete(draft.id);
                }}
                onChange={(value) => updateDraft(draft.id, value)}
                onPlace={() =>
                  startPlacement({
                    kind: "draft",
                    id: draft.id,
                    prompt: draft.prompt.trim(),
                  })
                }
                onDragStart={(event) =>
                  dragSource(event, {
                    kind: "draft",
                    id: draft.id,
                    prompt: draft.prompt.trim(),
                  })
                }
              />
            ))}
          </div>
        </aside>

        <section className="sceneseed-stage-column" aria-label="Scene canvas">
          <div
            ref={stageRef}
            className="sceneseed-stage"
            onDragOver={(event) => {
              if (!readOnly) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              const source = sourceFromDrop(event);
              if (source) void commitPlacement(source, pointFromDrop(event));
            }}
          >
            <RendererBoundary
              resetKey={rendererReset}
              fallback={
                <RendererUnavailable
                  onReload={() => {
                    setRendererLost(false);
                    setRendererReset((value) => value + 1);
                  }}
                />
              }
            >
              {rendererLost ? (
                <RendererUnavailable
                  onReload={() => {
                    setRendererLost(false);
                    setRendererReset((value) => value + 1);
                  }}
                />
              ) : (
                <SceneRenderer
                  key={rendererReset}
                  className="sceneseed-webgl"
                  objects={renderObjects}
                  selectedObjectId={selectedObjectId}
                  onSelectObject={selectFromRenderer}
                  onRenderProbe={onRenderProbe}
                  onRevealComplete={(objectId) => {
                    setAnnouncement("Interpretation complete.");
                    onRevealComplete?.(objectId);
                    window.requestAnimationFrame(() =>
                      objectActionRefs.current.get(objectId)?.focus(),
                    );
                  }}
                  onContextLost={() => setRendererLost(true)}
                  onContextRestored={() => setRendererLost(false)}
                  fallback={
                    <RendererUnavailable
                      onReload={() => setRendererReset((value) => value + 1)}
                    />
                  }
                />
              )}
            </RendererBoundary>
            {snapshot.objects
              .filter(
                (object) =>
                  object.activeSceneId === null && object.removedAt === null,
              )
              .map((object) => {
                const card = snapshot.cards.find(
                  (entry) => entry.id === object.sourceCardId,
                );
                if (!card?.placement) return null;
                return (
                  <div
                    key={object.id}
                    className="sceneseed-stage-seed"
                    data-state={card.state}
                    style={{
                      left: `${((card.placement.x + 8) / 16) * 100}%`,
                      top: `${((6 - card.placement.y) / 12) * 100}%`,
                    }}
                    aria-label={`${cardStateLabel(card)} seed for ${card.prompt}`}
                  >
                    <span aria-hidden="true" />
                    <small>{cardStateLabel(card)}</small>
                  </div>
                );
              })}
            {placementSource ? (
              <PlacementLayer
                cursor={placementCursor}
                prompt={placementSource.prompt}
                stageRef={stageRef}
                onMove={setPlacementCursor}
                onCommit={(placement) =>
                  void commitPlacement(placementSource, placement)
                }
                onCancel={() => {
                  setPlacementSource(null);
                  setAnnouncement("Placement cancelled.");
                }}
              />
            ) : null}
            {renderObjects.length === 0 &&
            snapshot.objects.every(
              (object) =>
                object.activeSceneId === null || object.removedAt !== null,
            ) ? (
              <div className="sceneseed-stage-empty">
                <div className="sceneseed-seed-mark" aria-hidden="true" />
                <strong>Drop a prompt here.</strong>
                <span>Its interpretation will take root at that point.</span>
              </div>
            ) : null}
          </div>

          {selectedObject && selectedCard ? (
            <ObjectControls
              object={selectedObject}
              card={selectedCard}
              readOnly={readOnly || busy}
              actionRef={(element) => {
                if (element)
                  objectActionRefs.current.set(selectedObject.id, element);
                else objectActionRefs.current.delete(selectedObject.id);
              }}
              onTransform={(transform) =>
                void runAction("Object moved.", () =>
                  actions.transform(selectedObject, transform),
                )
              }
              onRemix={() =>
                void runAction(
                  "Remix queued. The current object stays until the new one renders.",
                  () => actions.remix(selectedObject.id),
                )
              }
              onDuplicate={() =>
                void runAction("Object duplicated.", () =>
                  actions.duplicate(selectedObject),
                )
              }
              onRemove={() =>
                void runAction(
                  "Object removed. Its prompt remains in the card stack.",
                  async () => {
                    await actions.remove(selectedObject);
                    window.requestAnimationFrame(() =>
                      cardRefs.current
                        .get(selectedObject.sourceCardId)
                        ?.focus(),
                    );
                  },
                )
              }
            />
          ) : (
            <div className="sceneseed-no-selection">
              Select a completed prompt card or object to arrange it.
            </div>
          )}

          <section
            className="sceneseed-object-list"
            aria-labelledby="sceneseed-object-list-heading"
          >
            <div>
              <p className="sceneseed-eyebrow">Accessible scene</p>
              <h2 id="sceneseed-object-list-heading">Objects</h2>
            </div>
            {snapshot.objects.filter((object) => object.removedAt === null)
              .length === 0 ? (
              <p>No objects yet.</p>
            ) : (
              <ol>
                {snapshot.objects
                  .filter((object) => object.removedAt === null)
                  .map((object) => {
                    const card = snapshot.cards.find(
                      (entry) => entry.id === object.sourceCardId,
                    );
                    const scene = snapshot.candidates.find(
                      (candidate) => candidate.id === object.activeSceneId,
                    )?.normalizedScene;
                    if (!card) return null;
                    return (
                      <li
                        key={object.id}
                        data-selected={
                          selectedObjectId === object.id ? "true" : "false"
                        }
                      >
                        <button
                          type="button"
                          onClick={() => selectFromRenderer(object.id)}
                        >
                          <strong>
                            {scene?.name ?? "Pending interpretation"}
                          </strong>
                          <span>{card.prompt}</span>
                          <small>{cardStateLabel(card)}</small>
                        </button>
                      </li>
                    );
                  })}
              </ol>
            )}
          </section>
        </section>
      </div>
      <div className="sceneseed-sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </main>
  );
}

function LoadingCanvas() {
  return (
    <main className="sceneseed-editor" aria-label="Restoring canvas">
      <header className="sceneseed-editor-header">
        <Skeleton className="h-8 w-48" />
      </header>
      <div className="sceneseed-workspace">
        <aside className="sceneseed-card-rail">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </aside>
        <section className="sceneseed-stage-column">
          <Skeleton className="sceneseed-stage" />
        </section>
      </div>
    </main>
  );
}

function CanvasEditor({ canvasId }: { canvasId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const connection = useRealtimeConnectionState();
  const disclosure = useDisclosure();
  const [snapshot, setSnapshot] = useState<CanvasSnapshotDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealing, setRevealing] = useState<Set<string>>(() => new Set());
  const latestSnapshot = useRef<CanvasSnapshotDto | null>(null);
  const realizationStarts = useRef(new Set<string>());
  const realizationAttempts = useRef(new Map<string, string>());
  const acknowledgementInFlight = useRef(new Set<string>());
  const realizationRetryTimers = useRef(new Map<string, number>());
  const [realizationRetryNonce, setRealizationRetryNonce] = useState(0);
  const hasConnected = useRef(false);

  const applySnapshot = useCallback((next: CanvasSnapshotDto) => {
    latestSnapshot.current = next;
    setSnapshot(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await rpc.call("getCanvas", { canvasId });
      if (result.snapshot === null) {
        setError("This canvas no longer exists.");
        setSnapshot(null);
        return;
      }
      applySnapshot(result.snapshot);
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [applySnapshot, canvasId, rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () => () => {
      for (const timer of realizationRetryTimers.current.values()) {
        window.clearTimeout(timer);
      }
      realizationRetryTimers.current.clear();
    },
    [],
  );

  useRealtime(
    "canvas-changed",
    useCallback(
      (payload: unknown) => {
        if (!isCanvasSignal(payload) || payload.canvasId === canvasId)
          void refresh();
      },
      [canvasId, refresh],
    ),
  );

  useEffect(() => {
    if (connection !== "connected") return;
    if (hasConnected.current) void refresh();
    hasConnected.current = true;
  }, [connection, refresh]);

  useEffect(() => {
    if (!snapshot || connection !== "connected") return;
    const candidate = snapshot.candidates.find((entry) => {
      if (entry.state !== "pending" || entry.normalizedScene === null)
        return false;
      const job = snapshot.jobs.find((item) => item.id === entry.jobId);
      return (
        (job?.state === "candidate_ready" || job?.state === "realizing") &&
        !realizationStarts.current.has(entry.id) &&
        !realizationAttempts.current.has(entry.id) &&
        !realizationRetryTimers.current.has(entry.id)
      );
    });
    if (!candidate) return;
    const job = snapshot.jobs.find((entry) => entry.id === candidate.jobId);
    if (!job) return;
    const attemptId = nextClientId("realization");
    realizationStarts.current.add(candidate.id);
    void rpc
      .call("beginRealization", {
        candidateId: candidate.id,
        attemptId,
        jobId: job.id,
        generation: job.generation,
        expectedCanvasRevision: snapshot.canvas.revision,
      })
      .then(
        (result) => {
          realizationStarts.current.delete(candidate.id);
          applySnapshot(result.snapshot);
          realizationAttempts.current.set(candidate.id, attemptId);
          setError(null);
        },
        (reason: unknown) => {
          realizationStarts.current.delete(candidate.id);
          const message = errorMessage(reason);
          if (message.includes("already realizing")) {
            setError(
              "Another client is realizing this interpretation. SceneSeed will retry if its lease expires.",
            );
            const existingTimer = realizationRetryTimers.current.get(
              candidate.id,
            );
            if (existingTimer !== undefined) window.clearTimeout(existingTimer);
            const timer = window.setTimeout(() => {
              realizationRetryTimers.current.delete(candidate.id);
              setRealizationRetryNonce((value) => value + 1);
            }, 30_500);
            realizationRetryTimers.current.set(candidate.id, timer);
            return;
          }
          setError(message);
          void refresh();
        },
      );
  }, [
    applySnapshot,
    connection,
    realizationRetryNonce,
    refresh,
    rpc,
    snapshot,
  ]);

  const onRenderProbe = useCallback(
    (event: SceneRenderProbeEvent) => {
      const current = latestSnapshot.current;
      if (!current) return;
      const candidate = current.candidates.find(
        (entry) => entry.jobId === event.jobId && entry.state === "pending",
      );
      if (!candidate) return;
      const attemptId = realizationAttempts.current.get(candidate.id);
      const job = current.jobs.find((entry) => entry.id === candidate.jobId);
      if (
        !attemptId ||
        !job ||
        acknowledgementInFlight.current.has(candidate.id)
      )
        return;
      acknowledgementInFlight.current.add(candidate.id);
      void rpc
        .call("acknowledgeRealization", {
          candidateId: candidate.id,
          attemptId,
          jobId: job.id,
          generation: job.generation,
          expectedCanvasRevision: current.canvas.revision,
          outcome: event.status === "ready" ? "success" : "failure",
          ...(event.status === "failed"
            ? { errorMessage: event.diagnostic.slice(0, 1_000) }
            : {}),
        })
        .then(
          (result) => {
            realizationAttempts.current.delete(candidate.id);
            acknowledgementInFlight.current.delete(candidate.id);
            const retryTimer = realizationRetryTimers.current.get(candidate.id);
            if (retryTimer !== undefined) {
              window.clearTimeout(retryTimer);
              realizationRetryTimers.current.delete(candidate.id);
            }
            if (result.outcome === "complete") {
              setRevealing((ids) => new Set(ids).add(candidate.objectId));
            }
            applySnapshot(result.snapshot);
            setError(null);
          },
          (reason: unknown) => {
            realizationAttempts.current.delete(candidate.id);
            acknowledgementInFlight.current.delete(candidate.id);
            setError(errorMessage(reason));
            void refresh();
          },
        );
    },
    [applySnapshot, refresh, rpc],
  );

  const mutate = useCallback(
    async <Result extends { snapshot: CanvasSnapshotDto }>(
      promise: Promise<Result>,
    ) => {
      setError(null);
      try {
        const result = await promise;
        applySnapshot(result.snapshot);
      } catch (reason) {
        setError(errorMessage(reason));
        await refresh();
        throw reason;
      }
    },
    [applySnapshot, refresh],
  );

  if (snapshot === null) {
    return error ? (
      <main className="sceneseed-missing">
        <div className="sceneseed-seed-mark" aria-hidden="true" />
        <h1>Canvas unavailable</h1>
        <p>{error}</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate.toPluginPanel(PANEL_PATH)}
        >
          Back to canvases
        </Button>
      </main>
    ) : (
      <LoadingCanvas />
    );
  }

  if (disclosure.acknowledged === false) {
    return (
      <main className="sceneseed-library sceneseed-disclosure-screen">
        <Disclosure
          acknowledged={disclosure.acknowledged}
          error={disclosure.error}
          onAcknowledge={disclosure.acknowledge}
        />
        <div className="sceneseed-disclosure-back">
          <BackToLibrary />
        </div>
      </main>
    );
  }

  const actions: WorkspaceActions = {
    rename: async (name) =>
      mutate(
        rpc.call("renameCanvas", {
          canvasId,
          name,
          expectedRevision: latestSnapshot.current!.canvas.revision,
        }),
      ),
    deleteCanvas: async () => {
      const current = latestSnapshot.current!;
      setError(null);
      try {
        const result = await rpc.call("deleteCanvas", {
          canvasId,
          expectedRevision: current.canvas.revision,
        });
        if (result.threadCleanupFailed)
          setError(
            "Canvas data was deleted, but its hidden thread could not be archived. Check plugin logs.",
          );
        navigate.toPluginPanel(PANEL_PATH);
      } catch (reason) {
        setError(errorMessage(reason));
        throw reason;
      }
    },
    place: async (source, placement) => {
      let current = latestSnapshot.current!;
      let cardId = source.id;
      if (source.kind === "draft") {
        const created = await rpc.call("createCard", {
          canvasId,
          prompt: source.prompt,
          expectedRevision: current.canvas.revision,
        });
        applySnapshot(created.snapshot);
        current = created.snapshot;
        cardId = created.cardId;
      }
      await mutate(
        rpc.call("placeCard", {
          canvasId,
          cardId,
          placement,
          expectedRevision: current.canvas.revision,
        }),
      );
    },
    cancel: async (jobId) => mutate(rpc.call("cancelJob", { jobId })),
    transform: async (object, transform) =>
      mutate(
        rpc.call("updateObjectTransform", {
          canvasId,
          objectId: object.id,
          transform,
          expectedCanvasRevision: latestSnapshot.current!.canvas.revision,
        }),
      ),
    remix: async (objectId) =>
      mutate(
        rpc.call("remixObject", {
          canvasId,
          objectId,
          expectedRevision: latestSnapshot.current!.canvas.revision,
        }),
      ),
    duplicate: async (object) =>
      mutate(
        rpc.call("duplicateObject", {
          canvasId,
          sourceObjectId: object.id,
          expectedCanvasRevision: latestSnapshot.current!.canvas.revision,
          transform: {
            ...object.transform,
            position: [
              object.transform.position[0] + 1,
              object.transform.position[1],
              object.transform.position[2] + 1,
            ],
          },
        }),
      ),
    remove: async (object) =>
      mutate(
        rpc.call("removeObject", {
          canvasId,
          objectId: object.id,
          expectedCanvasRevision: latestSnapshot.current!.canvas.revision,
        }),
      ),
  };

  return (
    <CanvasWorkspace
      snapshot={snapshot}
      connection={connection}
      disclosureAcknowledged={disclosure.acknowledged === true}
      actions={actions}
      renderObjects={buildRenderObjects(
        snapshot,
        revealing,
        realizationAttempts.current,
      )}
      error={error}
      onRenderProbe={onRenderProbe}
      onRevealComplete={(objectId) =>
        setRevealing((current) => {
          const next = new Set(current);
          next.delete(objectId);
          return next;
        })
      }
    />
  );
}

function FixtureCanvasEditor() {
  const navigate = useBbNavigate();
  const connection = useRealtimeConnectionState();
  const [snapshot, setSnapshot] = useState(createSceneSeedUiFixture);
  const [revealing, setRevealing] = useState<Set<string>>(() => new Set());
  const update = (
    change: (current: CanvasSnapshotDto) => CanvasSnapshotDto,
  ) => {
    setSnapshot((current) => {
      const next = change(current);
      return {
        ...next,
        canvas: {
          ...next.canvas,
          revision: next.canvas.revision + 1,
          updatedAt: Date.now(),
        },
      };
    });
  };
  const actions: WorkspaceActions = {
    rename: async (name) =>
      update((current) => ({
        ...current,
        canvas: { ...current.canvas, name },
      })),
    deleteCanvas: async () => navigate.toPluginPanel(PANEL_PATH),
    place: async (source, placement) =>
      update((current) => ({
        ...current,
        cards: [
          ...current.cards,
          {
            id: source.id,
            canvasId: current.canvas.id,
            prompt: source.prompt,
            state: "queued",
            order: current.cards.length,
            placement,
            activeJobId: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      })),
    cancel: async (jobId) =>
      update((current) => ({
        ...current,
        cards: current.cards.map((card) =>
          card.activeJobId === jobId ? { ...card, state: "ready" } : card,
        ),
      })),
    transform: async (object, transform) =>
      update((current) => ({
        ...current,
        objects: current.objects.map((entry) =>
          entry.id === object.id ? { ...entry, transform } : entry,
        ),
      })),
    remix: async (objectId) => setRevealing(new Set([objectId])),
    duplicate: async (object) =>
      update((current) => {
        const sourceCard = current.cards.find(
          (card) => card.id === object.sourceCardId,
        );
        const sourceCandidate = current.candidates.find(
          (candidate) => candidate.id === object.activeSceneId,
        );
        if (!sourceCard || !sourceCandidate?.normalizedScene) return current;
        const id = nextClientId("fixture_object");
        const cardId = nextClientId("fixture_card");
        const jobId = nextClientId("fixture_job");
        const sceneId = nextClientId("fixture_scene");
        const scene = {
          ...sourceCandidate.normalizedScene,
          objectId: id,
          jobId,
        };
        return {
          ...current,
          cards: [
            ...current.cards,
            {
              ...sourceCard,
              id: cardId,
              order: current.cards.length,
              activeJobId: jobId,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
          objects: [
            ...current.objects,
            {
              ...object,
              id,
              sourceCardId: cardId,
              activeSceneId: sceneId,
              activeJobId: jobId,
              order: current.objects.length,
              transform: {
                ...object.transform,
                position: [
                  object.transform.position[0] + 1,
                  object.transform.position[1],
                  object.transform.position[2] + 1,
                ],
              },
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
          candidates: [
            ...current.candidates,
            {
              ...sourceCandidate,
              id: sceneId,
              jobId,
              objectId: id,
              originalScene: scene,
              normalizedScene: scene,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        };
      }),
    remove: async (object) =>
      update((current) => ({
        ...current,
        objects: current.objects.map((entry) =>
          entry.id === object.id ? { ...entry, removedAt: Date.now() } : entry,
        ),
      })),
  };
  return (
    <CanvasWorkspace
      snapshot={snapshot}
      connection={connection}
      disclosureAcknowledged
      actions={actions}
      renderObjects={buildRenderObjects(snapshot, revealing)}
      fixture
      error={null}
      onRevealComplete={(objectId) =>
        setRevealing((current) => {
          const next = new Set(current);
          next.delete(objectId);
          return next;
        })
      }
    />
  );
}

function SceneSeedPanel({ subPath }: PluginNavPanelProps) {
  if (subPath === "" || subPath === "library") return <LibraryPanel />;
  if (subPath === SCENESEED_QA_SUBPATH) return <FixtureCanvasEditor />;
  const canvasId = parseCanvasId(subPath);
  if (canvasId) return <CanvasEditor canvasId={canvasId} />;
  return (
    <main className="sceneseed-missing">
      <div className="sceneseed-seed-mark" aria-hidden="true" />
      <h1>That SceneSeed path did not grow.</h1>
      <p>Return to the canvas library and choose a saved canvas.</p>
      <BackToLibrary />
    </main>
  );
}

function BackToLibrary() {
  const navigate = useBbNavigate();
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => navigate.toPluginPanel(PANEL_PATH)}
    >
      Back to canvases
    </Button>
  );
}

function SceneSeedSettings(_props: PluginSettingsSectionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const clearAll = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await rpc.call("clearAllCanvasData");
      setMessage(
        result.failedThreadIds.length === 0
          ? `Deleted ${result.deletedCanvasCount} ${result.deletedCanvasCount === 1 ? "canvas" : "canvases"} and archived their hidden threads.`
          : `Deleted ${result.deletedCanvasCount} canvases. ${result.failedThreadIds.length} hidden threads could not be archived; check plugin logs.`,
      );
      setConfirming(false);
    } catch (reason) {
      setMessage(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="sceneseed-settings">
      <h3>Stored canvas data</h3>
      <p>
        SceneSeed stores prompts, scene graphs, transforms, and job state in its
        plugin database. Hidden interpreter transcripts follow bb’s thread
        retention behavior.
      </p>
      <p>
        Disabling or uninstalling SceneSeed does not delete that database or its
        hidden threads.
      </p>
      {confirming ? (
        <div
          className="sceneseed-clear-confirmation"
          role="group"
          aria-label="Confirm deleting all SceneSeed canvas data"
        >
          <strong>Delete every SceneSeed canvas?</strong>
          <p>
            This clears the plugin database and archives every canvas
            interpreter thread. This cannot be undone.
          </p>
          <div>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || connection !== "connected"}
              onClick={() => void clearAll()}
            >
              {busy ? "Deleting…" : "Delete all canvas data"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="destructive"
          disabled={connection !== "connected"}
          onClick={() => setConfirming(true)}
        >
          Delete all canvas data…
        </Button>
      )}
      {connection !== "connected" ? (
        <p role="status">Reconnect to delete stored data.</p>
      ) : null}
      {message ? (
        <p className="sceneseed-settings-result" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "sceneseed",
    title: "SceneSeed",
    icon: "Sparkles",
    path: PANEL_PATH,
    component: SceneSeedPanel,
  });
  app.slots.settingsSection({
    id: "storage",
    title: "SceneSeed data",
    description: "Understand retention and permanently clear saved canvases.",
    component: SceneSeedSettings,
  });
});
