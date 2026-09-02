import { expect } from "vitest";

interface PerfPhaseEvent {
  at: number;
  name: string;
}

export function createPerfPhaseLog() {
  const events: PerfPhaseEvent[] = [];

  return {
    mark(name: string) {
      events.push({ at: performance.now(), name });
    },
    names(): string[] {
      return events.map((event) => event.name);
    },
    expectBefore(earlier: string, later: string) {
      const earlierEvent = events.find((event) => event.name === earlier);
      const laterEvent = events.find((event) => event.name === later);
      expect(earlierEvent, `missing phase "${earlier}"`).toEqual(
        expect.objectContaining({ name: earlier }),
      );
      expect(laterEvent, `missing phase "${later}"`).toEqual(
        expect.objectContaining({ name: later }),
      );
      expect(
        earlierEvent!.at,
        `expected "${earlier}" before "${later}"`,
      ).toBeLessThan(laterEvent!.at);
    },
  };
}
