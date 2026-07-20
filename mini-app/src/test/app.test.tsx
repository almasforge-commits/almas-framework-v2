import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { mockApi } from "../api/mockApi";
import { mapThemeToCssVariables } from "../theme/telegramTheme";
import { PRIMARY_TABS } from "../app/navigation";
import type { TelegramWebApp } from "../telegram/telegramTypes";

afterEach(() => {
  cleanup();
  delete window.Telegram;
  mockApi.__resetTasksForTests();
  window.history.pushState({}, "", "/");
});

function installTelegram(partial?: Partial<TelegramWebApp>) {
  const ready = vi.fn();
  const expand = vi.fn();
  const webApp: TelegramWebApp = {
    ready,
    expand,
    colorScheme: "light",
    themeParams: {
      bg_color: "#112233",
      text_color: "#eeeeee",
      button_color: "#334455",
      button_text_color: "#ffffff",
      hint_color: "#99aabb",
      link_color: "#66aaff",
      secondary_bg_color: "#223344",
    },
    initDataUnsafe: {
      user: {
        id: 42,
        first_name: "Алмас",
        username: "almas",
      },
    },
    ...partial,
  };
  window.Telegram = { WebApp: webApp };
  return { ready, expand, webApp };
}

describe("ALMAS Mini App foundation", () => {
  it("works without Telegram global", async () => {
    render(<App />);
    expect(await screen.findByTestId("dashboard-greeting")).toHaveTextContent(
      /Гость|Доброе|Добрый|Доброй/
    );
    expect(screen.getByTestId("browser-preview")).toBeInTheDocument();
  });

  it("calls Telegram ready() and expand() when available", async () => {
    const { ready, expand } = installTelegram();
    render(<App />);
    await waitFor(() => {
      expect(ready).toHaveBeenCalled();
      expect(expand).toHaveBeenCalled();
    });
  });

  it("shows Telegram first name in greeting", async () => {
    installTelegram();
    render(<App />);
    expect(await screen.findByTestId("dashboard-greeting")).toHaveTextContent(
      "Алмас"
    );
  });

  it("shows fallback user in browser mode", async () => {
    render(<App />);
    expect(await screen.findByTestId("dashboard-greeting")).toHaveTextContent(
      "Гость"
    );
  });

  it("bottom navigation contains exactly five primary tabs", async () => {
    render(<App />);
    const nav = await screen.findByRole("navigation", {
      name: "Основная навигация",
    });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(PRIMARY_TABS).toHaveLength(5);
  });

  it("changing tabs renders the correct page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("dashboard-greeting");
    await user.click(screen.getByRole("link", { name: "Inbox" }));
    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Финансы" }));
    expect(await screen.findByRole("heading", { name: "Финансы" })).toBeInTheDocument();
  });

  it("unknown route returns to Home", async () => {
    window.history.pushState({}, "", "/not-a-real-route");
    render(<App />);
    expect(await screen.findByTestId("home-dashboard")).toBeInTheDocument();
  });

  it("maps Telegram theme values to CSS variables", () => {
    const vars = mapThemeToCssVariables(
      { bg_color: "#112233", text_color: "#abcdef" },
      "light"
    );
    expect(vars["--tg-bg"]).toBe("#112233");
    expect(vars["--tg-text"]).toBe("#abcdef");
    expect(vars["--tg-button"]).toBeTruthy();
  });

  it("Inbox filters work", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Inbox" }));
    await screen.findByText(/заплатил 500 долларов/i);
    await user.click(screen.getByRole("tab", { name: "Идеи" }));
    expect(await screen.findByText(/семейный финансовый кабинет/i)).toBeInTheDocument();
    expect(screen.queryByText(/заплатил 500 долларов/i)).not.toBeInTheDocument();
  });

  it("Knowledge local search works", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Ещё" }));
    await user.click(await screen.findByRole("link", { name: /Знания/i }));
    const input = await screen.findByPlaceholderText("Поиск…");
    await user.type(input, "Inbox");
    expect(await screen.findByText(/архитектуре Inbox/i)).toBeInTheDocument();
    expect(screen.queryByText(/Монетизация Telegram-ботов/i)).not.toBeInTheDocument();
  });

  it("task local completion changes local state only", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(mockApi, "patchTask");
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Задачи" }));
    const checkbox = await screen.findByRole("checkbox", {
      name: /Купить батарейки/i,
    });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    await waitFor(() => expect(checkbox).toBeChecked());
    expect(spy).toHaveBeenCalledWith("t1", { completed: true });
    spy.mockRestore();
  });

  it("mockApi respects TypeScript contracts", async () => {
    const dashboard = await mockApi.getDashboard("Test");
    expect(dashboard.summary.inboxToday).toEqual(expect.any(Number));
    const inbox = await mockApi.getInbox();
    expect(inbox[0].status).toEqual(expect.any(String));
    const finance = await mockApi.getFinanceSummary("month");
    expect(finance.demo).toBe(true);
  });

  it("loading state renders", () => {
    render(<LoadingState label="Загрузка теста" />);
    expect(screen.getByTestId("loading-state")).toHaveTextContent("Загрузка теста");
  });

  it("error state renders", () => {
    render(<ErrorState description="boom" />);
    expect(screen.getByTestId("error-state")).toHaveTextContent("boom");
  });

  it("empty state renders", () => {
    render(<EmptyState title="Пусто" description="нет данных" />);
    expect(screen.getByTestId("empty-state")).toHaveTextContent("Пусто");
  });
});
