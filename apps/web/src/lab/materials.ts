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
      const grain = (random() - .5) * 13;
      const pulp = Math.sin(x * Math.PI / 128) * Math.sin(y * Math.PI / 128) * 3;
      pixels.data[index] = 232 + grain + pulp;
      pixels.data[index + 1] = 224 + grain + pulp;
      pixels.data[index + 2] = 205 + grain + pulp;
      pixels.data[index + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  // Short fibers soften the grain without a conspicuous repeating illustration.
  for (let index = 0; index < 1300; index++) {
    const x = random() * 512;
    const y = random() * 512;
    context.strokeStyle = index % 3 === 0 ? "rgba(113, 94, 65, .11)" : "rgba(255, 251, 229, .27)";
    context.lineWidth = .5;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + 1 + random() * 5, y + random() - .5);
    context.stroke();
  }
  return Texture.from(canvas, true);
}

export function paintPaper(g: Graphics, width: number, height: number): void {
  // Page details stay in screen space; the calibrated grid moves with the camera.
  for (let index = 0; index < 28; index++) {
    g.rect(index, 0, 1, height).fill({ color: 0x7a684e, alpha: .11 * (1 - index / 28) });
  }
  g.moveTo(37, 0).lineTo(37, height).stroke({ color: 0xb56e65, width: 1, alpha: .28 });
  g.moveTo(40, 0).lineTo(40, height).stroke({ color: 0xb56e65, width: .6, alpha: .12 });
  for (let y = 102; y < height - 36; y += 112) {
    g.ellipse(12, y + 1, 3.5, 4).fill({ color: 0x8d7e67, alpha: .2 });
    g.ellipse(12, y, 2.5, 3).fill({ color: 0xd6cbb5, alpha: .8 });
  }
  g.rect(.5, .5, width - 1, height - 1).stroke({ color: 0xa99c81, width: 1, alpha: .25 });
  g.poly([width - 19, height, width, height - 19, width, height]).fill({ color: 0xb3a489, alpha: .18 });
  g.moveTo(width - 19, height).lineTo(width - 17, height - 18).lineTo(width, height - 19)
    .stroke({ color: 0xa99c81, width: .8, alpha: .35 });
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
  // Soft ink follows the exact ellipse without a second, uneven perimeter.
  g.ellipse(x, y, radiusX, radiusY).stroke({ color, width: width + 1.2, alpha: .10 });
  g.ellipse(x, y, radiusX, radiusY).stroke({ color, width, alpha: .78 });
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
  g.stroke({ color, width: .75, alpha: .24, cap: "round" });
}

// Ground and static bodies share uneven pigment deposits within their exact rectangle.
function paintPigmentGrain(g: Graphics, width: number, height: number, color: number): void {
  if (width < 6 || height < 5) {
    return;
  }
  for (let index = 0; index < 9; index++) {
    const fraction = (index + .5) / 9;
    const y = -height / 2 + 2 + fraction * (height - 4);
    const inset = 1 + (Math.sin(index * 2.4) + 1) * Math.min(6, width * .035);
    const thickness = Math.min(2.5, Math.max(.5, height / 28));
    const lift = Math.min(thickness, height / 2 - 1 - y);
    g.poly([
      -width / 2 + inset, y,
      -width * .18, y - thickness * .4,
      width * .21, y + thickness * .25,
      width / 2 - inset, y - thickness * .2,
      width / 2 - inset, y + lift,
      -width / 2 + inset, y + lift,
    ]).fill({ color: index % 3 === 0 ? 0xfff4cf : color, alpha: index % 3 === 0 ? .12 : .045 });
  }
}

function paintTarget(g: Graphics, radius: number, entered: boolean): void {
  const green = sceneColors.target;
  // A translucent watercolor ring keeps the projectile visible inside the sensor.
  g.circle(0, 0, radius).fill({ color: 0x79a991, alpha: .18 });
  g.circle(0, 0, radius * .7).fill({ color: 0xa6c2a3, alpha: .10 });
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
  g.ellipse(1, radius + 2, radius * 1.05, Math.max(1, radius * .22)).fill({ color: 0x7b6550, alpha: .06 });
  g.circle(0, 0, radius).fill(sceneColors.projectile);
  // A quiet shaded rim and upper-left wash give the pigment some depth.
  g.moveTo(0, -radius).arc(0, 0, radius, -Math.PI / 2, Math.PI / 2)
    .quadraticCurveTo(radius * .65, 0, 0, -radius).closePath().fill({ color: 0x874e3c, alpha: .16 });
  g.ellipse(-radius * .18, -radius * .20, radius * .62, radius * .66).fill({ color: 0xf3bd88, alpha: .40 });
  // Colored-pencil strokes stay inside the mathematically circular body.
  for (let index = 0; index < 6; index++) {
    const y = radius * (-.15 + index * .17);
    const extent = Math.sqrt(Math.max(0, radius * radius - y * y)) * .82;
    pencilLine(g, -.05 * radius, y, extent, y - .16 * radius, sceneColors.reference, .65, .28);
  }
  pencilEllipse(g, 0, 0, radius, radius, 0x9b553b, 1.1);
  g.arc(-radius * .03, -radius * .03, radius * .7, Math.PI * 1.04, Math.PI * 1.48).stroke({ color: 0xffdfae, width: 1.2, alpha: .7, cap: "round" });
}

function paintGround(g: Graphics, width: number, height: number): void {
  g.rect(-width / 2, -height / 2 + 3, width, height).fill({ color: 0x74654a, alpha: .04 });
  g.rect(-width / 2, -height / 2, width, height).fill({ color: 0xafbd91, alpha: .92 });
  g.rect(-width / 2, -height / 2 + 2, width, height * .24).fill({ color: 0xe5ddb3, alpha: .38 });
  paintPigmentGrain(g, width, height, 0x736e51);
  hatchRect(g, width, height, 0x736e51, 10);
  g.rect(-width / 2, -height / 2, width, height).stroke({ color: 0x72775b, width: 1, alpha: .8 });
  g.moveTo(-width / 2, -height / 2).lineTo(width / 2, -height / 2).stroke({ color: 0x636b50, width: 1.6, alpha: .9 });
}

function paintSurface(g: Graphics, width: number, height: number, ramp: boolean): void {
  const edge = ramp ? 0x957040 : 0x4e7a87;
  const pigment = ramp ? 0xdbb568 : 0x83adba;
  g.rect(-width / 2 + 1, -height / 2 + 2, width, height).fill({ color: 0x6d6251, alpha: .05 });
  g.rect(-width / 2, -height / 2, width, height).fill({ color: pigment, alpha: .92 });
  if (width > 2 && height > 2) {
    g.rect(-width / 2 + 1, -height / 2 + 1, width - 2, Math.min(height - 2, Math.max(1, height * .25))).fill({ color: ramp ? 0xffdf9c : 0xc7dedc, alpha: .4 });
  }
  paintPigmentGrain(g, width, height, edge);
  hatchRect(g, width, height, edge, 8);
  g.rect(-width / 2, -height / 2, width, height).stroke({ color: edge, width: 1.1, alpha: .85 });
  g.moveTo(-width / 2, -height / 2).lineTo(width / 2, -height / 2).stroke({ color: edge, width: 1.4, alpha: .9 });
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
