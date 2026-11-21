// Owns pigment, exact hit geometry and upright captions for one scene object.
import type { Body, TargetTrigger, Vector2 } from "@eureka/contracts";
import { Circle, Container, Graphics, Polygon } from "pixi.js";
import { notebookLabel } from "./sketchbook.js";
import { ballPigment, paintEntity, pencilEllipse, sceneColors, zoneColors, type PaintBounds } from "./materials.js";
import type { ChallengeZoneView } from "./store.js";

// ballIndex is this ball's place among the scene's balls; it picks the ball's colour.
export function createEntityVisual(entity: Body | TargetTrigger, ballIndex = 0) {
  const pigment = ballPigment(ballIndex);
  const graphic = new Container({ eventMode: "static", cursor: "pointer" });
  const geometry = new Graphics({ eventMode: "none" });
  const selection = new Graphics({ eventMode: "none" });
  const isGround = entity.id.toLowerCase().includes("ground");
  const isRamp = entity.id.toLowerCase().includes("ramp");
  const name = entity.kind === "target" ? "Target zone" : entity.kind === "dynamic" ? "Projectile" : isGround ? "Ground" : isRamp ? "Inclined plane" : "Platform";
  const color = entity.kind === "target" ? sceneColors.target : entity.kind === "dynamic" ? pigment.edge : isGround ? sceneColors.ground : isRamp ? sceneColors.ramp : sceneColors.platform;
  const caption = notebookLabel(name, color);
  graphic.addChild(selection, geometry, caption);
  let paintKey = "";
  let lastCaptionColor: number = color;

  // For a target used as a challenge zone, `entry` is the zone and its state; otherwise it says whether a ball has entered it this run.
  function update(scale: number, angle: number, selected: boolean, entry: boolean | ChallengeZoneView, labels: boolean, position: Vector2, viewportWidth: number, viewportHeight: number, moveMode: boolean): void {
    const shape = entity.shape;
    let visible: PaintBounds | undefined;
    if (shape.kind === "box") {
      // Rotate the padded viewport back into the body's local drawing coordinates.
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const dx = viewportWidth / 2 - position.x;
      const dy = viewportHeight / 2 - position.y;
      const centerX = cosine * dx - sine * dy;
      const centerY = sine * dx + cosine * dy;
      const halfWidth = Math.abs(cosine) * (viewportWidth / 2 + 24) + Math.abs(sine) * (viewportHeight / 2 + 24);
      const halfHeight = Math.abs(sine) * (viewportWidth / 2 + 24) + Math.abs(cosine) * (viewportHeight / 2 + 24);
      visible = {
        left: Math.max(-shape.widthMeters * scale / 2, centerX - halfWidth),
        right: Math.min(shape.widthMeters * scale / 2, centerX + halfWidth),
        top: Math.max(-shape.heightMeters * scale / 2, centerY - halfHeight),
        bottom: Math.min(shape.heightMeters * scale / 2, centerY + halfHeight),
      };
    }
    const zone = typeof entry === "boolean" ? undefined : entry;
    const entered = zone === undefined ? entry === true : zone.state === "reached";
    // A lab target turns from red to green when a ball enters it, like a challenge zone.
    const targetPaint = zone !== undefined ? zoneColors[zone.state] : entered ? zoneColors.reached : zoneColors.waiting;
    const key = [scale, selected, entered, zone?.state, moveMode, visible?.left, visible?.right, visible?.top, visible?.bottom].join(":");
    const selectionColor = moveMode ? sceneColors.velocity : color;
    const selectionWash = selectionColor;
    if (key !== paintKey) {
      paintKey = key;
      paintEntity(geometry, entity, scale, entered, visible, targetPaint, pigment);
      selection.clear();
      if (selected && shape.kind === "circle") {
        const radius = shape.radiusMeters * scale + 8;
        selection.circle(0, 0, radius).stroke({ color: selectionWash, width: 6, alpha: .2 });
        pencilEllipse(selection, 0, 0, radius, radius - 1, selectionColor, 1);
      } else if (selected && shape.kind === "box") {
        const x = shape.widthMeters * scale / 2 + 5;
        const y = shape.heightMeters * scale / 2 + 5;
        selection.rect(-x, -y, x * 2, y * 2).stroke({ color: selectionWash, width: 5, alpha: .18 });
        selection.rect(-x, -y, x * 2, y * 2).stroke({ color: moveMode ? selectionColor : sceneColors.ink, width: 1, alpha: .85 });
      }
    }
    // Only the geometry rotates. Labels and their pixel offsets remain upright.
    geometry.rotation = selection.rotation = -angle;
    graphic.position.set(position.x, position.y);
    if (shape.kind === "circle") {
      graphic.hitArea = new Circle(0, 0, shape.radiusMeters * scale);
    } else {
      const x = shape.widthMeters * scale / 2;
      const y = shape.heightMeters * scale / 2;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      graphic.hitArea = new Polygon([
        -x * cosine - y * sine, x * sine - y * cosine,
        x * cosine - y * sine, -x * sine - y * cosine,
        x * cosine + y * sine, -x * sine + y * cosine,
        -x * cosine + y * sine, x * sine + y * cosine,
      ]);
    }
    caption.text = zone !== undefined ? zone.zone.label + (entered ? " ✓" : "") : name;
    const captionColor = entity.kind === "target" ? targetPaint.ink : color;

    // Restyle only on a change, so the caption is not re-rendered every frame.
    if (captionColor !== lastCaptionColor) {
      lastCaptionColor = captionColor;
      caption.style.fill = captionColor;
    }
    const compact = viewportWidth < 520;
    caption.style.fontSize = compact ? 15 : 17;
    caption.visible = labels && (!compact || selected || entity.kind === "target");
    let x = entity.kind === "target" ? 22 : -48;
    let y = shape.kind === "circle" ? -shape.radiusMeters * scale - 30 : -38;
    if (shape.kind === "box") {
      const halfHeight = scale * (Math.abs(Math.sin(angle)) * shape.widthMeters + Math.abs(Math.cos(angle)) * shape.heightMeters) / 2;
      x = -Math.min(shape.widthMeters * scale / 2, 55);
      y = isGround || isRamp ? -halfHeight - 40 : halfHeight + 10;
      if (isGround) {
        x = 22 - position.x;
        y = -halfHeight - 64;
      }
    }
    caption.position.set(Math.max(12 - position.x, Math.min(viewportWidth - caption.width - 12 - position.x, x)), y);
  }

  return { graphic, update };
}
