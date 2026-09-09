import type { FullConfig, FullResult, Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Wall-clock timings remain real even when a test controls the page's clock. */
export default class TimingReporter implements Reporter {
  private output = '';
  private actions = new Map<string, { action: string; durationMs: number }[]>();
  private tests: { title: string; project: string; durationMs: number; status: string; actions: unknown[] }[] = [];
  onBegin(config: FullConfig) { this.output = config.projects[0].outputDir; }
  onStepEnd(test: TestCase, _result: TestResult, step: TestStep) {
    if (step.category !== 'pw:api') return;
    const actions = this.actions.get(test.id) ?? [];
    actions.push({ action: step.title, durationMs: step.duration });
    this.actions.set(test.id, actions);
  }
  onTestEnd(test: TestCase, result: TestResult) {
    this.tests.push({ title: test.title, project: test.parent.project()!.name, durationMs: result.duration,
      status: result.status, actions: this.actions.get(test.id) ?? [] });
    this.actions.delete(test.id);
  }
  onEnd(result: FullResult) {
    mkdirSync(this.output, { recursive: true });
    writeFileSync(join(this.output, 'timings.json'), JSON.stringify({ durationMs: result.duration, tests: this.tests }, null, 2));
  }
}
