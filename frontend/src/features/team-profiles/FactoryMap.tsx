import { Map, Marker } from "@vis.gl/react-google-maps";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";

export interface FactoryLocation {
  lat: number;
  lng: number;
  label: string;
}

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

/** Zoomable Google Map of the team's factory. There's no factory-location
 *  data source yet (bronze schema has no such table) — `factory` is always
 *  undefined for now, so this renders the AnalyticsCard empty state. The map
 *  itself is fully wired and activates the moment a coordinate is supplied. */
export function FactoryMap(props: { factory?: FactoryLocation; className?: string }) {
  const missingKey = !API_KEY;

  return (
    <AnalyticsCard
      eyebrow="Team · Facility"
      title="Factory location"
      error={missingKey ? new Error("Set VITE_GOOGLE_MAPS_API_KEY to enable this map") : null}
      empty={!missingKey && !props.factory}
      emptyText="Factory location data not available yet."
      className={props.className}
      bodyClassName="p-0"
    >
      {props.factory && API_KEY && (
        <Map
          defaultCenter={{ lat: props.factory.lat, lng: props.factory.lng }}
          defaultZoom={13}
          gestureHandling="cooperative"
          disableDefaultUI={false}
          zoomControl
          mapId="team-factory-map"
          style={{ width: "100%", height: "100%" }}
        >
          <Marker position={{ lat: props.factory.lat, lng: props.factory.lng }} title={props.factory.label} />
        </Map>
      )}
    </AnalyticsCard>
  );
}
