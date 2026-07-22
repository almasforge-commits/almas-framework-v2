import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StatsGrid } from "../components/dashboard/StatsGrid";
import { DashboardSkeleton } from "../components/dashboard/DashboardSkeleton";
import { DashboardEmpty } from "../components/dashboard/DashboardEmpty";
import { WhatsNew } from "../components/dashboard/WhatsNew";
import {
  buildGreetingLine,
  getDaypartGreeting,
} from "../components/dashboard/greeting";
import type { DashboardSummary } from "../api/apiTypes";

const summary: DashboardSummary = {
  greetingName: "Almas",
  inboxToday: 4,
  expensesToday: 186000,
  expensesTodayCurrency: "VND",
  baseCurrency: "VND",
  fxStatus: "ok",
  activeTasks: 3,
  newKnowledge: 2,
  statusLabel: "Демо-режим",
};

describe("dashboard UI helpers", () => {
  it("builds daypart greeting with name", () => {
    const morning = new Date("2026-07-20T08:00:00");
    expect(getDaypartGreeting(morning)).toBe("Доброе утро");
    expect(buildGreetingLine("Алмас", morning)).toBe("Доброе утро, Алмас");
    expect(buildGreetingLine(null, morning)).toBe("Доброе утро");
  });

  it("renders stats from summary only", () => {
    render(
      <MemoryRouter>
        <StatsGrid summary={summary} />
      </MemoryRouter>
    );
    expect(screen.getByTestId("dashboard-stats")).toBeInTheDocument();
    expect(screen.getByText("Расходы в VND")).toBeInTheDocument();
    expect(screen.getByText("Активные задачи")).toBeInTheDocument();
    expect(screen.getByText("Знания")).toBeInTheDocument();
    expect(screen.getByText("Идеи")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders whats-new from backend summary fields", () => {
    render(<WhatsNew summary={summary} />);
    expect(screen.getByText("4 новых объектов сегодня")).toBeInTheDocument();
    expect(screen.getByText("3 активных задач")).toBeInTheDocument();
    expect(screen.getByText("2 новых знаний")).toBeInTheDocument();
  });

  it("renders skeleton and empty states", () => {
    const { unmount } = render(<DashboardSkeleton />);
    expect(screen.getByTestId("dashboard-skeleton")).toBeInTheDocument();
    unmount();
    render(<DashboardEmpty />);
    expect(screen.getByTestId("dashboard-empty")).toBeInTheDocument();
  });
});
