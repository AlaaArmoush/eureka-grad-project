import type { SceneDefinition } from "@eureka/contracts";
import type { CameraView } from "../lab/coordinates.js";
import type { PreviewBall } from "../lab/demonstration-preview.js";

export interface PreviewSetup {
  readonly key: "A" | "B";
  readonly scene: SceneDefinition;
  // Present only after the setup has been run; before that the picture shows the starting scene.
  readonly balls?: readonly PreviewBall[] | undefined;
}

const CANVAS_WIDTH = 960;
// Every picture has the same shape; a tall or narrow flight is shown by zooming out, never by a taller picture.
const CANVAS_HEIGHT = 300;
const GRID_STEPS = [1, 2, 5, 10, 20, 50];

// Pick a grid spacing that gives roughly eight lines across the picture.
function gridStep(widthMeters: number): number {
  return GRID_STEPS.find((step) => widthMeters / step <= 9) ?? 100;
}

// Setup A's balls are filled and setup B's are rings of the same size, so two balls at one spot both stay visible.
function ballClass(key: "A" | "B"): string {
  return key === "A" ? "preview-ball series-a" : "preview-ball is-ring series-b";
}

// A ring sits just outside the ball it may share a spot with.
const RING_GAP = 2.5;

// Prefer a label just above its point; when that would leave the picture, put it below instead.
function labelY(pointY: number, gap: number, row: number, rowHeight: number): number {
  const above = pointY - gap - row * rowHeight;
  return above >= 14 ? above : pointY + gap + 8 + row * rowHeight;
}

// Keep a label inside the picture: near an edge it grows inward instead of being cut off.
function labelAnchor(x: number): { readonly x: number; readonly textAnchor: "start" | "middle" | "end" } {
  if (x > CANVAS_WIDTH - 120) {
    return { x: Math.min(x, CANVAS_WIDTH - 6), textAnchor: "end" };
  }

  if (x < 120) {
    return { x: Math.max(x, 6), textAnchor: "start" };
  }

  return { x, textAnchor: "middle" };
}

// Whether the viewer asked for less motion; false when rendered on a server.
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Draw the starting scene and, once run, each ball travelling its engine-computed path, with its peak, landing distance and time.
export function DemonstrationPreview({ setups, view, label, runId }: {
  readonly setups: readonly PreviewSetup[];
  readonly view: CameraView;
  readonly label: string;
  // Changing this restarts the path animation.
  readonly runId: string;
}) {
  // Fit the requested view inside the fixed picture, keeping its left and bottom edges where they are.
  const scale = Math.min(CANVAS_WIDTH / view.widthMeters, CANVAS_HEIGHT / view.heightMeters);
  const height = CANVAS_HEIGHT;
  const xMin = view.centerWorldMeters.x - view.widthMeters / 2;
  const yMax = view.centerWorldMeters.y - view.heightMeters / 2 + CANVAS_HEIGHT / scale;
  const shown = { widthMeters: CANVAS_WIDTH / scale, heightMeters: CANVAS_HEIGHT / scale };
  const toX = (x: number): number => (x - xMin) * scale;
  const toY = (y: number): number => (yMax - y) * scale;
  const step = gridStep(shown.widthMeters);
  const firstScene = setups[0]?.scene;
  const reducedMotion = prefersReducedMotion();
  const verticalLines = Array.from({ length: Math.floor(shown.widthMeters / step) + 1 }, (_, index) => Math.ceil(xMin / step) * step + index * step)
    .filter((x) => x <= xMin + shown.widthMeters);
  const horizontalLines = Array.from({ length: Math.floor(shown.heightMeters / step) + 1 }, (_, index) => Math.ceil((yMax - shown.heightMeters) / step) * step + index * step)
    .filter((y) => y <= yMax);

  return (
    // A new run gets a new picture, so its animations start from the beginning of the new picture's own timeline.
    <svg key={runId} className="demo-preview" viewBox={`0 0 ${CANVAS_WIDTH} ${height}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      <rect className="preview-sky" width={CANVAS_WIDTH} height={height} />
      {verticalLines.map((x) => (
        <line key={`x${x}`} className="preview-grid" x1={toX(x)} x2={toX(x)} y1={0} y2={height} />
      ))}
      {horizontalLines.map((y) => (
        <line key={`y${y}`} className="preview-grid" x1={0} x2={CANVAS_WIDTH} y1={toY(y)} y2={toY(y)} />
      ))}
      {firstScene?.bodies.map((body) => body.kind === "static" && body.shape.kind === "box" ? (
        <g
          key={body.id}
          transform={`translate(${toX(body.pose.positionMeters.x)} ${toY(body.pose.positionMeters.y)}) rotate(${-body.pose.angleRadians * 180 / Math.PI})`}
        >
          <rect
            className={body.id === "default-ground" ? "preview-ground" : "preview-solid"}
            x={-body.shape.widthMeters * scale / 2}
            y={-body.shape.heightMeters * scale / 2}
            width={body.shape.widthMeters * scale}
            height={body.shape.heightMeters * scale}
          />
        </g>
      ) : null)}
      {/* Distance labels sit above the ground band, so a view that ends at the ground still shows them. */}
      {verticalLines.map((x) => (
        <text key={`t${x}`} className="preview-tick" x={toX(x) + 4} y={height - 6}>{x} m</text>
      ))}
      {/* Before a run each ball waits at its start; after a run it travels its engine-computed path instead. */}
      {[...setups].reverse().map((setup) => setup.balls === undefined ? setup.scene.bodies.map((body) => {
        if (body.kind !== "dynamic" || body.shape.kind !== "circle") return null;

        return (
          <circle
            key={`${setup.key}-${body.id}`}
            className={ballClass(setup.key)}
            cx={toX(body.pose.positionMeters.x)}
            cy={toY(body.pose.positionMeters.y)}
            r={body.shape.radiusMeters * scale + (setup.key === "B" ? RING_GAP : 0)}
          />
        );
      }) : null)}
      {/* B is drawn first and wider, A on top and narrower, so identical paths show both colours. */}
      {[...setups].reverse().map((setup) => setup.balls?.map((ball, ballIndex) => {
        const setupIndex = setups.indexOf(setup);
        const points = ball.trail.map((point) => ({ x: toX(point.x), y: toY(point.y) }));
        const last = ball.trail[ball.trail.length - 1];
        const first = points[0];

        if (points.length < 2 || last === undefined || first === undefined) return null;

        // The engine records one position per tick, so evenly spaced animation values keep the motion in real time.
        const duration = Math.min(Math.max(ball.flightTimeSeconds, 0.6), 8);
        const series = setup.key === "A" ? "series-a" : "series-b";
        const labelRow = setupIndex * (setup.balls?.length ?? 1) + ballIndex;
        const apexIndex = ball.trail.reduce((best, point, index) => point.y > (ball.trail[best]?.y ?? -Infinity) ? index : best, 0);
        const apex = points[apexIndex] ?? first;
        const body = setup.scene.bodies.find((candidate) => candidate.id === ball.id);
        const radius = (body?.shape.kind === "circle" ? body.shape.radiusMeters : 0.5) * scale;
        const lengths = points.reduce<number[]>((sum, point, index) => {
          const previous = points[index - 1];
          sum.push(previous === undefined ? 0 : (sum[index - 1] ?? 0) + Math.hypot(point.x - previous.x, point.y - previous.y));
          return sum;
        }, []);
        const total = lengths[lengths.length - 1] || 1;
        const dashValues = lengths.map((length) => (1 - length / total).toFixed(4)).join(";");
        const animate = !reducedMotion;
        const reveal = { animationDelay: animate ? `${duration}s` : "0s" };

        return (
          <g key={`${runId}-${setup.key}-${ball.id}`} className={series}>
            <path className={`preview-trail${setup.key === "B" ? " is-wide" : ""}`} d={`M${points.map((point) => `${point.x},${point.y}`).join("L")}`} pathLength={1} strokeDasharray="1" strokeDashoffset={animate ? 1 : 0}>
              {animate && <animate attributeName="stroke-dashoffset" values={dashValues} dur={`${duration}s`} fill="freeze" />}
            </path>
            <g className="preview-landing" style={reveal}>
              <circle className="preview-apex" cx={apex.x} cy={apex.y} r={3.5} />
              {ball.peakHeightMeters > 0.05 && <text className="preview-apex-label" {...labelAnchor(apex.x)} y={labelY(apex.y, 10, labelRow, 15)}>{setup.key}: peak {ball.peakHeightMeters.toFixed(1)} m</text>}
              <circle cx={toX(last.x)} cy={toY(last.y)} r={5} />
              <text {...labelAnchor(toX(last.x))} y={labelY(toY(last.y), 14, labelRow, 17)}>{setup.key}: {ball.rangeMeters.toFixed(1)} m {ball.landed ? `in ${ball.flightTimeSeconds.toFixed(2)} s` : "(still in flight)"}</text>
            </g>
            <circle className={ballClass(setup.key)} cx={animate ? first.x : toX(last.x)} cy={animate ? first.y : toY(last.y)} r={radius + (setup.key === "B" ? RING_GAP : 0)}>
              {animate && <animate attributeName="cx" values={points.map((point) => point.x.toFixed(1)).join(";")} dur={`${duration}s`} fill="freeze" />}
              {animate && <animate attributeName="cy" values={points.map((point) => point.y.toFixed(1)).join(";")} dur={`${duration}s`} fill="freeze" />}
            </circle>
          </g>
        );
      }))}
    </svg>
  );
}
