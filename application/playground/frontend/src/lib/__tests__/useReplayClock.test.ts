// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { replayPosition, useReplayClock } from "../useReplayClock";

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("saved replay clock", () => {
  it("reveals an ordered prefix in equal time slots, including one-event traces", () => {
    expect([0, 2499, 2500, 5000, 7500, 10_000].map((elapsed) => replayPosition(elapsed, 10_000, 4).revealedCount))
      .toEqual([1, 1, 2, 3, 4, 4]);
    expect(replayPosition(0, 10_000, 1).revealedCount).toBe(1);
    expect(replayPosition(9999, 10_000, 1).revealedCount).toBe(1);
    expect(replayPosition(0, 10_000, 0).revealedCount).toBe(0);
  });

  it("finishes once at the selected deadline", () => {
    const complete = vi.fn();
    const { result } = renderHook(() => useReplayClock(true, 10, 4, complete));
    act(() => vi.advanceTimersByTime(9999));
    expect(result.current.revealedCount).toBe(4);
    expect(complete).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.progress).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(100_000));
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("uses monotonic elapsed time when a callback is delayed", () => {
    const complete = vi.fn();
    const { result } = renderHook(() => useReplayClock(true, 60, 4, complete));
    const monotonic = vi.spyOn(performance, "now").mockReturnValue(70_000);
    act(() => vi.advanceTimersByTime(50));
    expect(result.current.progress).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
    monotonic.mockRestore();
  });

  it("restarts the deadline when duration changes and uses the current callback", () => {
    const complete = vi.fn();
    const nextComplete = vi.fn();
    const { result, rerender } = renderHook(({ duration, done }) => useReplayClock(true, duration, 1, done), {
      initialProps: { duration: 10, done: complete },
    });
    act(() => vi.advanceTimersByTime(5000));
    rerender({ duration: 20, done: nextComplete });
    expect(result.current.elapsedMs).toBe(0);
    act(() => vi.advanceTimersByTime(19_999));
    expect(nextComplete).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(nextComplete).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
  });

  it("cancels callbacks on early exit and unmount", () => {
    const complete = vi.fn();
    const { rerender, unmount } = renderHook(({ running }) => useReplayClock(running, 10, 2, complete), { initialProps: { running: true } });
    act(() => vi.advanceTimersByTime(1000));
    rerender({ running: false });
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(20_000));
    expect(complete).not.toHaveBeenCalled();
    rerender({ running: true });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
