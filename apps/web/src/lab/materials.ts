import type { Body, TargetTrigger } from "@eureka/contracts";
import { BufferImageSource, Graphics, Texture } from "pixi.js";

// Visible screen area expressed in the object's own drawing coordinates.
export interface PaintBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

// Pencil and pigment belong to the renderer; collision geometry stays exact.
export const sceneColors = {
  paper: 0xfff3d7,
  ink: 0x354b53,
  muted: 0x61747a,
  grid: 0x70a6b8,
  fineGrid: 0x8db6c0,
  axisX: 0xc44f36,
  axisY: 0x2264b0,
  projectile: 0xf36b3f,
  target: 0x087c56,
  reference: 0xc1402c,
  velocity: 0x2466da,
  trail: 0x7751b5,
  ground: 0x207949,
  ramp: 0x965d06,
  platform: 0x08758d,
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
      const grain = (random() - .5) * 6;
      const pulp = Math.sin(x * Math.PI / 128) * Math.sin(y * Math.PI / 128) * 1.2;
      pixels.data[index] = (sceneColors.paper >> 16 & 255) + grain + pulp;
      pixels.data[index + 1] = (sceneColors.paper >> 8 & 255) + grain + pulp;
      pixels.data[index + 2] = (sceneColors.paper & 255) + grain + pulp;
      pixels.data[index + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  // Short fibers soften the grain without a conspicuous repeating illustration.
  for (let index = 0; index < 800; index++) {
    const x = random() * 512;
    const y = random() * 512;
    context.strokeStyle = index % 3 === 0 ? "rgba(116, 96, 64, .07)" : "rgba(255, 254, 248, .22)";
    context.lineWidth = .5;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + 1 + random() * 5, y + random() - .5);
    context.stroke();
  }
  // Hand Pixi the finished bytes, never the canvas: Firefox may keep a 2D canvas on the GPU in blue-first order, and
  // uploading that canvas straight to WebGL swapped red and blue, so the paper turned blue.
  const { data } = context.getImageData(0, 0, 512, 512);
  return new Texture({ source: new BufferImageSource({ resource: new Uint8Array(data.buffer), width: 512, height: 512, format: "rgba8unorm" }) });
}

export function paintPaper(g: Graphics, width: number, height: number): void {
  // Binding and a small folded corner give the page depth without moving world markings.
  for (let index = 0; index < 18; index++) {
    g.rect(index, 0, 1, height).fill({ color: 0x756851, alpha: .065 * (1 - index / 18) });
  }
  for (let y = 114; y < height - 48; y += 144) {
    g.ellipse(7, y + 1, 2.6, 3.4).fill({ color: 0x897d65, alpha: .16 });
    g.ellipse(7, y, 1.7, 2.5).fill({ color: 0xdad2bd, alpha: .7 });
  }
  g.rect(.5, .5, width - 1, height - 1).stroke({ color: sceneColors.grid, width: 1, alpha: .2 });
  g.poly([width - 21, height, width, height - 21, width, height]).fill({ color: 0xbaa983, alpha: .2 });
  g.moveTo(width - 21, height).lineTo(width - 19, height - 19).lineTo(width, height - 21)
    .stroke({ color: 0xa69b82, width: .8, alpha: .4 });
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

function hatchRect(g: Graphics, width: number, height: number, color: number, spacing = 9, visible?: PaintBounds): void {
  const surfaceLeft = -width / 2 + 2;
  const surfaceTop = -height / 2 + 2;
  const left = Math.max(surfaceLeft, visible?.left ?? -Infinity);
  const right = Math.min(width / 2 - 2, visible?.right ?? Infinity);
  const top = Math.max(surfaceTop, visible?.top ?? -Infinity);
  const bottom = Math.min(height / 2 - 2, visible?.bottom ?? Infinity);
  if (right <= left || bottom <= top) return;

  // Keep the pencil pattern anchored to the body while drawing only visible lines.
  const origin = surfaceLeft + surfaceTop;
  const first = Math.ceil((left + top - origin) / spacing);
  const last = Math.floor((right + bottom - origin) / spacing);
  for (let index = first; index <= last; index++) {
    const intercept = origin + index * spacing;
    const from = Math.max(left, intercept - bottom);
    const to = Math.min(right, intercept - top);
    g.moveTo(from, intercept - from).lineTo(to, intercept - to);
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

// A challenge zone's target: red until reached, green once reached, amber when too close to call.
export const zoneColors = {
  waiting: { ink: 0xb3372b, wash: 0xe8705f, inner: 0xf3b0a3 },
  missed: { ink: 0xb3372b, wash: 0xe8705f, inner: 0xf3b0a3 },
  reached: { ink: sceneColors.target, wash: 0x2fc98d, inner: 0x91e6a8 },
  borderline: { ink: 0xa86d06, wash: 0xf0b443, inner: 0xf6d891 },
} as const;

export type TargetPaint = (typeof zoneColors)[keyof typeof zoneColors];

// The colour alone shows whether a ball has entered the target.
function paintTarget(g: Graphics, radius: number, paint: TargetPaint): void {
  const green = paint.ink;
  // A translucent watercolor ring keeps the projectile visible inside the sensor.
  g.circle(0, 0, radius).fill({ color: paint.wash, alpha: .28 });
  g.circle(0, 0, radius * .7).fill({ color: paint.inner, alpha: .2 });
  pencilEllipse(g, 0, 0, radius, radius, green, 1.6);
  g.circle(0, 0, radius * .46).stroke({ color: green, width: 1, alpha: .8 });
  for (let index = 0; index < 4; index++) {
    const angle = index * Math.PI / 2;
    pencilLine(g, Math.cos(angle) * (radius - 2), Math.sin(angle) * (radius - 2), Math.cos(angle) * (radius + 6), Math.sin(angle) * (radius + 6), green, 1);
  }
}

function paintBall(g: Graphics, radius: number): void {
  // Fine pencil texture cannot fit inside a sub-ten-pixel ball.
  if (radius < 5) {
    g.circle(0, 0, radius).fill(sceneColors.projectile)
      .stroke({ color: sceneColors.reference, width: Math.min(.8, radius * .4) });
    return;
  }
  g.ellipse(1, radius + 2, radius * 1.05, Math.max(1, radius * .22)).fill({ color: 0x7b6550, alpha: .06 });
  g.circle(0, 0, radius).fill(sceneColors.projectile);
  // A quiet shaded rim and upper-left wash give the pigment some depth.
  g.moveTo(0, -radius).arc(0, 0, radius, -Math.PI / 2, Math.PI / 2)
    .quadraticCurveTo(radius * .65, 0, 0, -radius).closePath().fill({ color: 0xb13b2b, alpha: .23 });
  g.ellipse(-radius * .18, -radius * .20, radius * .62, radius * .66).fill({ color: 0xffc76d, alpha: .55 });
  // Colored-pencil strokes stay inside the mathematically circular body.
  for (let index = 0; index < 6; index++) {
    const y = radius * (-.15 + index * .17);
    const extent = Math.sqrt(Math.max(0, radius * radius - y * y)) * .82;
    pencilLine(g, -.05 * radius, y, extent, y - .16 * radius, sceneColors.reference, .65, .28);
  }
  pencilEllipse(g, 0, 0, radius, radius, 0xbe432b, 1.3);
  g.arc(-radius * .03, -radius * .03, radius * .7, Math.PI * 1.04, Math.PI * 1.48).stroke({ color: 0xffdfae, width: 1.2, alpha: .7, cap: "round" });
}

function paintGround(g: Graphics, width: number, height: number, visible?: PaintBounds): void {
  g.rect(-width / 2, -height / 2 + 3, width, height).fill({ color: 0x74654a, alpha: .04 });
  g.rect(-width / 2, -height / 2, width, height).fill({ color: 0x66bd7d, alpha: .95 });
  g.rect(-width / 2, -height / 2 + 2, width, height * .24).fill({ color: 0xc4ed86, alpha: .5 });
  paintPigmentGrain(g, width, height, sceneColors.ground);
  hatchRect(g, width, height, sceneColors.ground, 10, visible);
  g.rect(-width / 2, -height / 2, width, height).stroke({ color: sceneColors.ground, width: 1, alpha: .9 });
  g.moveTo(-width / 2, -height / 2).lineTo(width / 2, -height / 2).stroke({ color: sceneColors.ground, width: 1.6, alpha: 1 });
}

function paintSurface(g: Graphics, width: number, height: number, ramp: boolean, visible?: PaintBounds): void {
  const edge = ramp ? sceneColors.ramp : sceneColors.platform;
  const pigment = ramp ? 0xf5b82f : 0x32b6c7;
  g.rect(-width / 2 + 1, -height / 2 + 2, width, height).fill({ color: 0x6d6251, alpha: .05 });
  g.rect(-width / 2, -height / 2, width, height).fill({ color: pigment, alpha: .92 });
  if (width > 2 && height > 2) {
    g.rect(-width / 2 + 1, -height / 2 + 1, width - 2, Math.min(height - 2, Math.max(1, height * .25))).fill({ color: ramp ? 0xffe77f : 0xa2f1e3, alpha: .55 });
  }
  paintPigmentGrain(g, width, height, edge);
  hatchRect(g, width, height, edge, 8, visible);
  g.rect(-width / 2, -height / 2, width, height).stroke({ color: edge, width: 1.1, alpha: .85 });
  g.moveTo(-width / 2, -height / 2).lineTo(width / 2, -height / 2).stroke({ color: edge, width: 1.4, alpha: .9 });
  if (width > 38 && height > 9) {
    for (const x of [-width / 2 + 7, width / 2 - 7]) {
      g.circle(x, 0, 1.4).fill({ color: edge, alpha: .65 });
    }
  }
}

export function paintEntity(g: Graphics, entity: Body | TargetTrigger, pixelsPerMeter: number, targetEntered: boolean, visible?: PaintBounds, targetPaint: TargetPaint = zoneColors.reached): void {
  g.clear();
  const shape = entity.shape;
  if (shape.kind === "circle") {
    const radius = shape.radiusMeters * pixelsPerMeter;
    if (entity.kind === "target") paintTarget(g, radius, targetPaint);
    else paintBall(g, radius);
    return;
  }
  const width = shape.widthMeters * pixelsPerMeter;
  const height = shape.heightMeters * pixelsPerMeter;
  if (entity.id.toLowerCase().includes("ground")) paintGround(g, width, height, visible);
  else paintSurface(g, width, height, entity.id.toLowerCase().includes("ramp"), visible);
}
