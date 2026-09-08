/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google Maps JS API key — powers the Team Profiles factory map and the
   *  Live Dashboard's satellite/street basemap under the track. */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  /** Optional Cloud Console Map ID with a POI/transit-hidden style attached
   *  — without one, Google's own business/landmark pins still render on
   *  the live track basemap (unstyled but non-clickable). See TrackMap.tsx. */
  readonly VITE_GOOGLE_MAPS_MAP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.avif" {
  const src: string;
  export default src;
}
