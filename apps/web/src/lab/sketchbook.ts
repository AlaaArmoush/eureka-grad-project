// Camera-calibrated paper markings; never reads or advances engine state.
import { Container, Graphics, Text } from "pixi.js";
import { worldToScreen, type ViewportTransform } from "./coordinates.js";
import { paintPaper, pencilLine, sceneColors } from "./materials.js";

export function notebookLabel(text: string, color: number = sceneColors.ink, size = 17): Text {
  return new Text({
    text,
    eventMode: "none",
    style: {
      fontFamily: "Kalam, cursive",
      fontSize: size,
      fill: color,
      stroke: { color: sceneColors.paper, width: 3 },
    },
  });
}

// Reuse text objects and redraw the page only when camera, size or visibility changes.
export function createNotebookGrid() {
  const root = new Container({ eventMode: "none" });
  const lines = new Graphics();
  const labels: Text[] = [];
  root.addChild(lines);
  let previousKey = "";

  function update(viewport: ViewportTransform, visible: boolean): void {
    const { widthPixels: width, heightPixels: height, pixelsPerMeter: scale, centerWorldMeters: center } = viewport;
    const key = [width, height, scale, center.x, center.y, visible].join(":");
    if (key === previousKey) return;
    previousKey = key;
    lines.clear();
    paintPaper(lines, width, height);
    let used = 0;
    const label = (text: string, x: number, y: number, color: number = sceneColors.ink, size = 13) => {
      let item = labels[used];
      if (item === undefined) {
        item = notebookLabel(text, color, size);
        labels.push(item);
        root.addChild(item);
      }
      used += 1;
      item.text = text;
      item.style.fill = color;
      item.style.fontSize = size;
      item.position.set(x, y);
      item.visible = true;
    };
    const line = (x1: number, y1: number, x2: number, y2: number, color: number, weight = 1, alpha = 1) => {
      lines.moveTo(x1, y1).lineTo(x2, y2).stroke({ color, width: weight, alpha });
    };
    const desired = 60 / scale;
    const magnitude = 10 ** Math.floor(Math.log10(desired));
    const ratio = desired / magnitude;
    const step = (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * magnitude;
    const left = center.x - width / (2 * scale);
    const bottom = center.y - height / (2 * scale);
    const origin = worldToScreen({ x: 0, y: 0 }, viewport);
    const xAxisVisible = origin.y > 80 && origin.y < height - 50;
    const yAxisVisible = origin.x > 36 && origin.x < width - 60;
    const format = (value: number) => String(Number(value.toPrecision(6)));

    if (visible) {
      // Integer indices avoid accumulating floating-point error along the grid.
      const halfStep = step / 2;
      const firstX = Math.ceil(left / halfStep);
      const firstY = Math.ceil(bottom / halfStep);
      const columns = Math.ceil(width / (scale * halfStep));
      const rows = Math.ceil(height / (scale * halfStep));
      for (let index = firstX; index <= firstX + columns; index++) {
        const value = index * halfStep;
        const x = worldToScreen({ x: value, y: 0 }, viewport).x;
        const major = index % 2 === 0;
        if (major) {
          pencilLine(lines, x, 0, x, height, sceneColors.grid, .85, .38);
        } else {
          line(x, 0, x, height, sceneColors.fineGrid, .55, .2);
        }
        if (major && x > 24 && x < width - 92) {
          label(format(value), x + 4, xAxisVisible ? origin.y - 23 : height - 54);
          if (xAxisVisible) line(x, origin.y - 3, x, origin.y + 3, sceneColors.ink);
        }
      }
      for (let index = firstY; index <= firstY + rows; index++) {
        const value = index * halfStep;
        const y = worldToScreen({ x: 0, y: value }, viewport).y;
        const major = index % 2 === 0;
        if (major) {
          pencilLine(lines, 0, y, width, y, sceneColors.grid, .85, .38);
        } else {
          line(0, y, width, y, sceneColors.fineGrid, .55, .2);
        }
        if (major && index !== 0 && y > 100 && y < height - 70) {
          label(format(value), yAxisVisible ? origin.x - 29 : 10, y - 9);
          if (yAxisVisible) line(origin.x - 3, y, origin.x + 3, y, sceneColors.ink);
        }
      }
      if (origin.y >= 0 && origin.y <= height) {
        pencilLine(lines, 0, origin.y, width, origin.y, sceneColors.axisX, 1.4, .9);
        line(width - 24, origin.y - 4, width - 16, origin.y, sceneColors.axisX);
        line(width - 24, origin.y + 4, width - 16, origin.y, sceneColors.axisX);
      }
      if (origin.x >= 0 && origin.x <= width) {
        pencilLine(lines, origin.x, 0, origin.x, height, sceneColors.axisY, 1.4, .9);
        line(origin.x - 4, 88, origin.x, 80, sceneColors.axisY);
        line(origin.x + 4, 88, origin.x, 80, sceneColors.axisY);
      }
      label("x (m)", width - 58, xAxisVisible ? origin.y - 25 : height - 54, sceneColors.axisX, 15);
      label("y (m)", yAxisVisible ? origin.x + 9 : 10, 76, sceneColors.axisY, 15);
    }
    const rulerLength = step * scale;
    const rulerX = width - rulerLength - 24;
    const rulerY = height - 23;
    pencilLine(lines, rulerX, rulerY, rulerX + rulerLength, rulerY, sceneColors.muted, 1);
    for (let index = 0; index <= 4; index++) {
      const x = rulerX + rulerLength * index / 4;
      const tick = index === 0 || index === 4 ? 4 : 2;
      line(x, rulerY - tick, x, rulerY + tick, sceneColors.muted, .8);
    }
    label(`${format(step)} m`, rulerX + rulerLength / 2 - 10, rulerY - 20, sceneColors.muted, 12);
    for (let index = used; index < labels.length; index++) {
      const item = labels[index];
      if (item !== undefined) item.visible = false;
    }
  }

  return { root, update };
}
