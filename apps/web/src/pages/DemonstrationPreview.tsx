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
const GRID_STEPS = [1, 2, 5, 10, 20, 50];

// Pick a grid spacing that gives roughly eight lines across the picture.
function gridStep(widthMeters: number): number {
  return GRID_STEPS.find((step) => widthMeters / step <= 9) ?? 100;
}

// Draw the starting scene, launch arrows and, once run, each ball's path with its landing distance.
export function DemonstrationPreview({ setups, view, label, runId }: {
  readonly setups: readonly PreviewSetup[];
  readonly view: CameraView;
  readonly label: string;
  // Changing this restarts the path animation.
  readonly runId: string;
}) {
  const scale = CANVAS_WIDTH / view.widthMeters;
  const height = view.heightMeters * scale;
  const xMin = view.centerWorldMeters.x - view.widthMeters / 2;
  const yMax = view.centerWorldMeters.y + view.heightMeters / 2;
  const toX = (x: number): number => (x - xMin) * scale;
  const toY = (y: number): number => (yMax - y) * scale;
  const step = gridStep(view.widthMeters);
  const firstScene = setups[0]?.scene;
  const verticalLines = Array.from({ length: Math.floor(view.widthMeters / step) + 1 }, (_, index) => Math.ceil(xMin / step) * step + index * step)
    .filter((x) => x <= xMin + view.widthMeters);
  const horizontalLines = Array.from({ length: Math.floor(view.heightMeters / step) + 1 }, (_, index) => Math.ceil((yMax - view.heightMeters) / step) * step + index * step)
    .filter((y) => y <= yMax);

  return (
    <svg className="demo-preview" viewBox={`0 0 ${CANVAS_WIDTH} ${height}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
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
      {[...setups].reverse().map((setup) => setup.scene.bodies.map((body) => {
        if (body.kind !== "dynamic" || body.shape.kind !== "circle") return null;

        const cx = toX(body.pose.positionMeters.x);
        const cy = toY(body.pose.positionMeters.y);
        const radius = body.shape.radiusMeters * scale;
        const velocity = body.velocity.linearMetersPerSecond;
        const speed = Math.hypot(velocity.x, velocity.y);
        const arrowLength = Math.min(Math.max(speed * 0.35, 2.5 * body.shape.radiusMeters), view.widthMeters * 0.16) * scale;
        const tipX = cx + velocity.x / speed * arrowLength;
        const tipY = cy - velocity.y / speed * arrowLength;
        const angle = Math.atan2(cy - tipY, tipX - cx);
        const barb = 11;
        const series = setup.key === "A" ? "series-a" : "series-b";

        return (
          <g key={`${setup.key}-${body.id}`} className={series}>
            <line className="preview-arrow" x1={cx} y1={cy} x2={tipX} y2={tipY} />
            <polygon
              className="preview-arrow-head"
              points={[
                [tipX, tipY],
                [tipX - barb * Math.cos(angle - 0.45), tipY + barb * Math.sin(angle - 0.45)],
                [tipX - barb * Math.cos(angle + 0.45), tipY + barb * Math.sin(angle + 0.45)],
              ].map(([px, py]) => `${px},${py}`).join(" ")}
            />
            <circle className="preview-ball" cx={cx} cy={cy} r={setup.key === "A" ? radius * 0.62 : radius} />
          </g>
        );
      }))}
      {setups.map((setup, setupIndex) => setup.balls?.map((ball, ballIndex) => {
        const points = ball.trail.map((point) => `${toX(point.x)},${toY(point.y)}`);
        const last = ball.trail[ball.trail.length - 1];

        if (points.length < 2 || last === undefined) return null;

        const duration = Math.min(Math.max(ball.flightTimeSeconds, 0.6), 8);
        const series = setup.key === "A" ? "series-a" : "series-b";
        const labelRow = setupIndex * (setup.balls?.length ?? 1) + ballIndex;

        return (
          <g key={`${runId}-${setup.key}-${ball.id}`} className={series}>
            <path className="preview-trail" d={`M${points.join("L")}`} pathLength={1} style={{ animationDuration: `${duration}s` }} />
            <g className="preview-landing" style={{ animationDelay: `${duration}s` }}>
              <circle cx={toX(last.x)} cy={toY(last.y)} r={5} />
              <text x={toX(last.x)} y={toY(last.y) - 14 - labelRow * 17} textAnchor="middle">{setup.key} · {ball.rangeMeters.toFixed(1)} m</text>
            </g>
          </g>
        );
      }))}
    </svg>
  );
}
