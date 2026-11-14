import type { Body, TargetTrigger } from "@eureka/contracts";
import { Graphics, Texture } from "pixi.js";

// Pencil and pigment belong to the renderer; collision geometry stays exact.
export const sceneColors = {
  paper: 0xe8e0cd,
  ink: 0x555449,
  muted: 0x6c6b5c,
  projectile: 0xd87149,
  target: 0x3b8066,
  reference: 0xc26a45,
  velocity: 0x357ea0,
  normal: 0x8f639a,
} as const;

// One repeatable paper tile per mounted renderer, never regenerated on pan/zoom.
// This private visual seed has no connection to the engine's random sequence.
export function createPaperTexture(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("The sketchbook paper could not be created.");
  let seed = 271828;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pixels = context.createImageData(512, 512);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const index = (y * 512 + x) * 4;
      const grain = (random() - .5) * 8;
      const pulp = Math.sin(x * Math.PI / 64) * Math.sin(y * Math.PI / 128) * 1.6;
      pixels.data[index] = 232 + grain + pulp;
      pixels.data[index + 1] = 224 + grain + pulp;
      pixels.data[index + 2] = 205 + grain + pulp;
      pixels.data[index + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  // Short fibers soften the grain without a conspicuous repeating illustration.
  for (let index = 0; index < 900; index++) {
    const x = random() * 512;
    const y = random() * 512;
    context.strokeStyle = index % 3 === 0 ? "rgba(113, 94, 65, .075)" : "rgba(255, 251, 229, .20)";
    context.lineWidth = .5;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + 1 + random() * 3, y + random() - .5);
    context.stroke();
  }
  return Texture.from(canvas, true);
}

export function paintPaper(g: Graphics, width: number, height: number): void {
  // A quiet page gutter. The actual paper texture lives beneath the grid.
  for (let index = 0; index < 16; index++) {
    g.rect(index, 0, 1, height).fill({ color: 0x7a684e, alpha: .055 * (1 - index / 16) });
  }
  g.rect(.5, .5, width - 1, height - 1).stroke({ color: 0xa99c81, width: 1, alpha: .25 });
}

// Small, fixed irregularities suggest pencil pressure without animation or drift.
// Endpoints are exact, including arrow tips and the top of a collision surface.
export function pencilLine(g: Graphics, x1: number, y1: number, x2: number, y2: number, color: number, width = 1.2, alpha = .85): void {
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length < .01) return;
  const normalX = -(y2 - y1) / length;
  const normalY = (x2 - x1) / length;
  g.moveTo(x1, y1).lineTo(x2, y2).stroke({ color, width: width + 1.6, alpha: alpha * .12, cap: "round" });
  const segments = Math.max(2, Math.ceil(length / 18));
  g.moveTo(x1, y1);
  for (let index = 1; index <= segments; index++) {
    const amount = index / segments;
    const pressure = index === segments ? 0 : Math.sin(index * 2.17) * .38;
    g.lineTo(x1 + (x2 - x1) * amount + normalX * pressure, y1 + (y2 - y1) * amount + normalY * pressure);
  }
  g.stroke({ color, width, alpha, cap: "round", join: "round" });
}

export function pencilEllipse(g: Graphics, x: number, y: number, radiusX: number, radiusY: number, color: number, width = 1.2): void {
  g.ellipse(x, y, radiusX, radiusY).stroke({ color, width, alpha: .78 });
  for (let index = 0; index <= 56; index++) {
    const angle = index / 56 * Math.PI * 2;
    const offset = Math.sin(angle * 3 + .6) * .45 + Math.cos(angle * 5) * .2;
    const px = x + Math.cos(angle) * (radiusX + offset + .7);
    const py = y + Math.sin(angle) * (radiusY + offset + .4);
    if (index === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath().stroke({ color, width: .65, alpha: .35 });
}

function hatchRect(g: Graphics, width: number, height: number, color: number, spacing = 9): void {
  const left = -width / 2 + 2;
  const right = width / 2 - 2;
  const top = -height / 2 + 2;
  const bottom = height / 2 - 2;
  if (right <= left || bottom <= top) return;
  for (let start = left - (bottom - top); start < right; start += spacing) {
    const from = Math.max(left, start);
    const to = Math.min(right, start + bottom - top);
    g.moveTo(from, bottom - (from - start)).lineTo(to, bottom - (to - start));
  }
  g.stroke({ color, width: .75, alpha: .3, cap: "round" });
}

function paintTarget(g: Graphics, radius: number, entered: boolean): void {
  const green = sceneColors.target;
  // A translucent watercolor ring keeps the projectile visible inside the sensor.
  g.circle(0, 0, radius).fill({ color: 0x85ad72, alpha: .24 });
  g.circle(0, 0, radius * .7).fill({ color: 0x85ad72, alpha: .12 });
  pencilEllipse(g, 0, 0, radius, radius, green, 1.3);
  g.circle(0, 0, radius * .46).stroke({ color: green, width: .9, alpha: .6 });
  for (let index = 0; index < 4; index++) {
    const angle = index * Math.PI / 2;
    pencilLine(g, Math.cos(angle) * (radius - 2), Math.sin(angle) * (radius - 2), Math.cos(angle) * (radius + 6), Math.sin(angle) * (radius + 6), green, 1);
  }
  if (entered) {
    const offset = radius + 6;
    g.roundRect(offset - 5, -offset - 5, 11, 11, 1.5).fill(0xd4dac0).stroke({ color: green, width: .9 });
    pencilLine(g, offset - 2.5, -offset, offset, -offset + 2.5, green, 1.4);
    pencilLine(g, offset, -offset + 2.5, offset + 4, -offset - 2.5, green, 1.4);
  }
}

function paintBall(g: Graphics, radius: number): void {
  g.ellipse(1.5, radius + 2, radius * 1.1, Math.max(1, radius * .25)).fill({ color: 0x7b6550, alpha: .10 });
  g.circle(0, 0, radius).fill(0xdd875d);
  g.ellipse(-radius * .18, -radius * .15, radius * .68, radius * .73).fill({ color: 0xf3bb7d, alpha: .65 });
  // Colored-pencil strokes stay inside the mathematically circular body.
  for (let index = 0; index < 6; index++) {
    const y = radius * (-.15 + index * .17);
    const extent = Math.sqrt(Math.max(0, radius * radius - y * y)) * .82;
    pencilLine(g, -.05 * radius, y, extent, y - .16 * radius, sceneColors.reference, .65, .42);
  }
  pencilEllipse(g, 0, 0, radius, radius, 0x9b553b, 1.1);
  g.arc(-radius * .03, -radius * .03, radius * .7, Math.PI * 1.04, Math.PI * 1.48).stroke({ color: 0xf4d4ac, width: 1.5, alpha: .8, cap: "round" });
}

function paintGround(g: Graphics, width: number, height: number): void {
  g.rect(-width / 2, -height / 2 + 3, width, height).fill({ color: 0x74654a, alpha: .06 });
  g.rect(-width / 2, -height / 2, width, height).fill({ color: 0xb8c28c, alpha: .9 });
  g.rect(-width / 2, -height / 2 + 2, width, height * .28).fill({ color: 0xd8d0ac, alpha: .65 });
  hatchRect(g, width, height, 0x736e51, 10);
  pencilLine(g, -width / 2, -height / 2, width / 2, -height / 2, 0x6f6c51, 1.8);
  pencilLine(g, -width / 2, height / 2, width / 2, height / 2, 0x7c7559, 1);
  pencilLine(g, -width / 2, -height / 2, -width / 2, height / 2, 0x7c7559, 1);
  pencilLine(g, width / 2, -height / 2, width / 2, height / 2, 0x7c7559, 1);
}

function paintSurface(g: Graphics, width: number, height: number, ramp: boolean): void {
  const edge = ramp ? 0x9b713b : 0x48798a;
  const pigment = ramp ? 0xe0b455 : 0x83b3c3;
  g.rect(-width / 2 + 1.5, -height / 2 + 3, width, height).fill({ color: 0x6d6251, alpha: .08 });
  g.rect(-width / 2, -height / 2, width, height).fill({ color: pigment, alpha: .88 });
  if (width > 2 && height > 2) {
    g.rect(-width / 2 + 1, -height / 2 + 1, width - 2, Math.min(height - 2, Math.max(1, height * .35))).fill({ color: ramp ? 0xf5d69a : 0xc0d8d1, alpha: .55 });
  }
  hatchRect(g, width, height, edge, 8);
  pencilLine(g, -width / 2, -height / 2, width / 2, -height / 2, edge, 1.6);
  pencilLine(g, -width / 2, height / 2, width / 2, height / 2, edge, 1.2);
  pencilLine(g, -width / 2, -height / 2, -width / 2, height / 2, edge, 1.2);
  pencilLine(g, width / 2, -height / 2, width / 2, height / 2, edge, 1.2);
  if (width > 38 && height > 9) {
    for (const x of [-width / 2 + 7, width / 2 - 7]) {
      g.circle(x, 0, 1.4).fill({ color: edge, alpha: .65 });
    }
  }
}

export function paintEntity(g: Graphics, entity: Body | TargetTrigger, pixelsPerMeter: number, targetEntered: boolean): void {
  g.clear();
  const shape = entity.shape;
  if (shape.kind === "circle") {
    const radius = shape.radiusMeters * pixelsPerMeter;
    if (entity.kind === "target") paintTarget(g, radius, targetEntered);
    else paintBall(g, radius);
    return;
  }
  const width = shape.widthMeters * pixelsPerMeter;
  const height = shape.heightMeters * pixelsPerMeter;
  if (entity.id.toLowerCase().includes("ground")) paintGround(g, width, height);
  else paintSurface(g, width, height, entity.id.toLowerCase().includes("ramp"));
}
