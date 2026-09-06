import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { FiltersProvider } from "@/state/filters";
import { ChatSessionsProvider } from "@/state/chatSessions";
import { ThemeProvider } from "@/state/theme";
import { HistoricalDashboard } from "@/features/dashboard/HistoricalDashboard";
import { PredictionMarketsPage } from "@/features/prediction-markets/PredictionMarketsPage";
import { RaceReplayPage } from "@/features/race-replay/RaceReplayPage";
import { ChatPage } from "@/pages/Chat";

// three.js is heavy — split the calendar out of the main bundle
const CalendarPage = lazy(() =>
  import("@/features/calendar/CalendarPage").then((m) => ({ default: m.CalendarPage })),
);
import { ComingSoon } from "@/pages/ComingSoon";
import { Creator } from "@/pages/Creator";
import { DocsApis } from "@/pages/DocsApis";
import { DocsArchitecture } from "@/pages/DocsArchitecture";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity, // historical data — refetches are key-driven
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const stub = (title: string, note: string) => <ComingSoon title={title} note={note} />;

const router = createBrowserRouter([
  {
    element: (
      <FiltersProvider>
        <ChatSessionsProvider>
          <AppShell />
        </ChatSessionsProvider>
      </FiltersProvider>
    ),
    children: [
      { path: "/", element: <HistoricalDashboard /> },
      { path: "/prediction-markets", element: <PredictionMarketsPage /> },
      { path: "/news", element: stub("News", "Paddock headlines and race weekend coverage will land here.") },
      { path: "/race-replay", element: <RaceReplayPage /> },
      {
        path: "/calendar",
        element: (
          <Suspense fallback={<div className="h-full" style={{ background: "#050608" }} />}>
            <CalendarPage />
          </Suspense>
        ),
      },
      { path: "/chat", element: <ChatPage /> },
      { path: "/live", element: stub("Live Dashboard", "Deferred — the platform is historical-only until a telemetry source is ingested.") },
      { path: "/docs/apis", element: <DocsApis /> },
      { path: "/docs/architecture", element: <DocsArchitecture /> },
      { path: "/creator", element: <Creator /> },
      { path: "*", element: stub("Not found", "That route doesn’t exist. Use the sidebar to get back on track.") },
    ],
  },
]);

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
