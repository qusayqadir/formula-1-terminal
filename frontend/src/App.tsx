import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { APIProvider } from "@vis.gl/react-google-maps";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { FiltersProvider } from "@/state/filters";
import { ChatSessionsProvider } from "@/state/chatSessions";
import { ThemeProvider } from "@/state/theme";
import { HistoricalDashboard } from "@/features/dashboard/HistoricalDashboard";
import { PredictionMarketsPage } from "@/features/prediction-markets/PredictionMarketsPage";
import { RaceReplayPage } from "@/features/race-replay/RaceReplayPage";
import { LiveDashboardPage } from "@/features/live/LiveDashboardPage";
import { ChatPage } from "@/pages/Chat";

// three.js is heavy — split the calendar out of the main bundle
const CalendarPage = lazy(() =>
  import("@/features/calendar/CalendarPage").then((m) => ({ default: m.CalendarPage })),
);
import { ComingSoon } from "@/pages/ComingSoon";
import { Creator } from "@/pages/Creator";
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

// Both the Team Profiles factory map and the Live Dashboard's track basemap
// use @vis.gl/react-google-maps — its APIProvider loads the Maps JS SDK via
// a <script> tag it doesn't clean up on unmount, so mounting one per-widget
// (as each used to) injects a fresh duplicate script every time you
// navigate to that page. Google's SDK becomes unstable once multiple
// copies are loaded on the same page (maps render as a blank canvas with
// no console error) — mounting a single provider here, once, for the
// app's lifetime avoids the whole class of bug.
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

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
      { path: "/live", element: <LiveDashboardPage /> },
      { path: "/docs/architecture", element: <DocsArchitecture /> },
      { path: "/creator", element: <Creator /> },
      { path: "*", element: stub("Not found", "That route doesn’t exist. Use the sidebar to get back on track.") },
    ],
  },
]);

export default function App() {
  const router_ = (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  );
  // no key -> skip the provider entirely rather than mounting it with an
  // empty apiKey; FactoryMap/TrackMap each already show their own
  // "set VITE_GOOGLE_MAPS_API_KEY" error state when there's no provider
  return GOOGLE_MAPS_API_KEY ? <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>{router_}</APIProvider> : router_;
}
