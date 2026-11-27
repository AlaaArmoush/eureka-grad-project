// Use the existing server-rendering approach to check actual browser content without adding DOM tooling.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CurriculumPage, InvestigationPanel, ProjectilesBrowser } from "../../src/pages/CurriculumPage.js";
import { initialState } from "../../src/pages/investigation-state.js";
import { readDemonstrations } from "../../src/lab/demonstrations.js";

// The Topic 1 questions as stored in the seed files, read through the same check the browser uses on the server's answer.
const TOPIC_ONE_DEMONSTRATIONS = readDemonstrations(Object.values(import.meta.glob("../../../server/prisma/demonstrations/*.json", { eager: true, import: "default" })), (message) => {
  throw new Error(message);
});

const noop = () => {};
const browserHtml = renderToStaticMarkup(createElement(ProjectilesBrowser, { demonstrations: TOPIC_ONE_DEMONSTRATIONS, onOpen: noop }));

// The student sees a list of every question and one focused investigation, not a wall of cards.
it("lists five questions and opens the first as a focused investigation", () => {
  expect([...browserHtml.matchAll(/class="rail-question/g)]).toHaveLength(5);
  expect([...browserHtml.matchAll(/<article\b/g)]).toHaveLength(1);

  for (const definition of TOPIC_ONE_DEMONSTRATIONS) {
    expect(browserHtml).toContain(definition.title);
  }

  expect(browserHtml).toContain("Question 1 of 5");
  expect(browserHtml).toContain(TOPIC_ONE_DEMONSTRATIONS[0]?.question.replace("?", "?"));
});

// A picture must carry the explanation: a drawn scene, a prediction to make and the way to run it.
it("shows a picture of both setups, a prediction and a Run button before anything has run", () => {
  expect(browserHtml).toMatch(/<svg[^>]*class="demo-preview"[^>]*role="img"/);
  expect(browserHtml).toContain('aria-label="Setup A Mass"');
  expect(browserHtml).toContain('aria-label="Setup B Mass"');
  expect([...browserHtml.matchAll(/type="radio"/g)]).toHaveLength(3);
  expect(browserHtml).toContain("Run both");
  expect(browserHtml).toContain("Open in lab");
  // Answers stay hidden until the experiment has run.
  expect(browserHtml).not.toContain("preview-landing");
  expect(browserHtml).not.toContain("preview-trail");
});

// Shared settings apply to both setups and must be offered where the question has any.
it("offers the shared settings of the question", () => {
  expect(browserHtml).toContain("Same for both setups");
  expect(browserHtml).toContain('aria-label="Launch speed (both setups)"');
  expect(browserHtml).toContain('aria-label="Gravity (both setups)"');
});

// After a run the picture shows paths with each ball's landing distance, time and peak, and whether the prediction was right.
it.each(TOPIC_ONE_DEMONSTRATIONS)("shows paths, a results table and feedback after running $id", (definition) => {
  const right = { ...initialState(definition), choice: definition.prediction.answerIndex, runCount: 1 };
  const wrong = { ...right, choice: (definition.prediction.answerIndex + 1) % definition.prediction.choices.length };
  const render = (state: typeof right) => renderToStaticMarkup(createElement(InvestigationPanel, {
    definition, state, index: 0, total: 5, onChange: noop, onOpen: noop, onPrevious: null, onNext: noop,
  }));
  const html = render(right);

  expect(html).toContain("preview-trail");
  expect(html).toContain("Your prediction was right.");
  expect(render(wrong)).toContain("Not quite.");
  expect(html).toContain("What to look for.");
  // One landing result per simulated ball in each setup; the pair question launches two balls per setup.
  const expectedRows = definition.id === "complementary-angles" ? 4 : 2;
  expect([...html.matchAll(/class="preview-landing"/g)]).toHaveLength(expectedRows);
});

// Identical setups give nothing to compare, so the lab opens only one and the page says so.
it("explains and disables comparison when both setups are identical", () => {
  const definition = TOPIC_ONE_DEMONSTRATIONS[0];
  if (definition === undefined) throw new Error("The first question must exist.");
  const html = renderToStaticMarkup(createElement(InvestigationPanel, {
    definition, state: { ...initialState(definition), comparison: definition.reference }, index: 0, total: 5,
    onChange: noop, onOpen: noop, onPrevious: null, onNext: noop,
  }));
  expect(html).toContain("Both setups are identical");
  expect(html).toContain("Opens the one setup in the lab");
});

// The topic overview must show a real flight and lead into the questions.
it("presents Projectiles as a topic card with a drawn flight", () => {
  const html = renderToStaticMarkup(createElement(CurriculumPage, {
    visible: true, topicOpen: false, catalogue: { status: "ready", demonstrations: TOPIC_ONE_DEMONSTRATIONS }, onRetry: noop, error: null, onOpen: noop, onRestoreDemonstration: null,
    onReturnToLab: noop, onOpenProjectiles: noop, onShowTopics: noop,
  }));
  expect(html).toContain("Projectiles");
  expect(html).toContain("5 questions");
  expect(html).toContain("preview-trail");
});

// Discovery must not offer a dead challenge navigation action before the shared player exists.
it("explains challenge availability without linking to an unimplemented player", () => {
  expect(browserHtml).toContain("Related challenges are not available yet.");
  expect(browserHtml).not.toContain('href="/challenges');
  expect(browserHtml).not.toContain('href="#challenges');
});
