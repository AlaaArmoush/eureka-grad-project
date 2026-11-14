// Owns pigment, exact hit geometry and upright captions for one scene object.
import type { Body, TargetTrigger, Vector2 } from "@eureka/contracts";
import { Circle, Container, Graphics, Polygon } from "pixi.js";
import { notebookLabel } from "./sketchbook.js";
import { paintEntity, pencilEllipse, pencilLine, sceneColors } from "./materials.js";

export function createEntityVisual(entity: Body | TargetTrigger) {
  const graphic = new Container({ eventMode: "static", cursor: "pointer" });
  const geometry = new Graphics({ eventMode: "none" });
  const selection = new Graphics({ eventMode: "none" });
  const isGround = entity.id.toLowerCase().includes("ground");
  const isRamp = entity.id.toLowerCase().includes("ramp");
  const name = entity.kind === "target" ? "Target zone" : entity.kind === "dynamic" ? "Projectile" : isGround ? "Ground" : isRamp ? "Inclined plane" : "Platform";
  const color = entity.kind === "target" ? sceneColors.target : entity.kind === "dynamic" ? sceneColors.reference : sceneColors.ink;
  const caption = notebookLabel(name, color);
  graphic.addChild(selection, geometry, caption);
  let paintKey = "";

  function update(scale: number, angle: number, selected: boolean, entered: boolean, labels: boolean, position: Vector2, viewportWidth: number): void {
    const key = [scale, selected, entered].join(":");
    const shape = entity.shape;
    if (key !== paintKey) {
      paintKey = key;
      paintEntity(geometry, entity, scale, entered);
      selection.clear();
      if (selected && shape.kind === "circle") {
        const radius = shape.radiusMeters * scale + 8;
        selection.circle(0, 0, radius).stroke({ color: 0xc5a25f, width: 6, alpha: .2 });
        pencilEllipse(selection, 0, 0, radius, radius - 1, color, 1);
      } else if (selected && shape.kind === "box") {
        const x = shape.widthMeters * scale / 2 + 5;
        const y = shape.heightMeters * scale / 2 + 5;
        selection.rect(-x, -y, x * 2, y * 2).stroke({ color: 0xc5a25f, width: 5, alpha: .18 });
        for (const side of [-1, 1]) {
          pencilLine(selection, -x, side * y, x, side * y, sceneColors.ink, 1);
          pencilLine(selection, side * x, -y, side * x, y, sceneColors.ink, 1);
        }
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
    caption.text = entered && entity.kind === "target" ? "Target entered ✓" : name;
    const compact = viewportWidth < 520;
    caption.style.fontSize = compact ? 15 : 17;
    caption.visible = labels && (!compact || selected || entity.kind === "target");
    let x = entity.kind === "target" ? 22 : -48;
    let y = shape.kind === "circle" ? -shape.radiusMeters * scale - 30 : -38;
    if (shape.kind === "box") {
      const halfHeight = scale * (Math.abs(Math.sin(angle)) * shape.widthMeters + Math.abs(Math.cos(angle)) * shape.heightMeters) / 2;
      x = -Math.min(shape.widthMeters * scale / 2, 55);
      y = isGround || isRamp ? -halfHeight - 40 : halfHeight + 10;
      if (isGround) x = 22 - position.x;
    }
    caption.position.set(Math.max(12 - position.x, Math.min(viewportWidth - caption.width - 12 - position.x, x)), y);
  }

  return { graphic, update };
}
