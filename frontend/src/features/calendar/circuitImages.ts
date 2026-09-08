/** Circuit api_id → track-layout image for the hover MetaCard. Curated map
 *  over src/assets/circuits/circuit-images (same convention as flags/team colors — a DB
 *  image column would win once one exists). Unmapped circuits fall back to
 *  the dashed "Track Layout" placeholder. */
import australian from "@/assets/circuits/circuit-images/australian_circuit.avif";
import baku from "@/assets/circuits/circuit-images/azerbaijan_baku_circuit.avif";
import bahrain from "@/assets/circuits/circuit-images/bahrain_circuit.avif";
import belgium from "@/assets/circuits/circuit-images/belgium_circuit.avif";
import brazilian from "@/assets/circuits/circuit-images/brazilian_circuit.avif";
import canada from "@/assets/circuits/circuit-images/canada_circuit.avif";
import china from "@/assets/circuits/circuit-images/china_circuit.avif";
import dutch from "@/assets/circuits/circuit-images/dutch_circuit.avif";
import hungarian from "@/assets/circuits/circuit-images/hungarian_circuit.avif";
import imola from "@/assets/circuits/circuit-images/italian_emilia_romagna_circuit.avif";
import monza from "@/assets/circuits/circuit-images/italian_monza_circuit.avif";
import jeddah from "@/assets/circuits/circuit-images/jeddah_circuit.avif";
import lasVegas from "@/assets/circuits/circuit-images/las_vegas_circuit.avif";
import mexico from "@/assets/circuits/circuit-images/mexico_circuit.avif";
import miami from "@/assets/circuits/circuit-images/miami_circuit.avif";
import monaco from "@/assets/circuits/circuit-images/monoco_circuit.avif";
import qatar from "@/assets/circuits/circuit-images/qatar_circuit.png";
import redBullRing from "@/assets/circuits/circuit-images/red_bull_ring.avif";
import silverstone from "@/assets/circuits/circuit-images/silverstone_circuit.avif";
import singapore from "@/assets/circuits/circuit-images/singapore_circuit.avif";
import spain from "@/assets/circuits/circuit-images/spain_circuit.avif";
import suzuka from "@/assets/circuits/circuit-images/suzaka_circuit.avif";
import austin from "@/assets/circuits/circuit-images/usa_austin_circuit.avif";
import yasMarina from "@/assets/circuits/circuit-images/yas_marina_circuit.avif";

const CIRCUIT_IMAGES: Record<string, string> = {
  albert_park: australian,
  baku,
  bahrain,
  spa: belgium,
  interlagos: brazilian,
  villeneuve: canada,
  shanghai: china,
  zandvoort: dutch,
  hungaroring: hungarian,
  imola,
  monza,
  jeddah,
  vegas: lasVegas,
  rodriguez: mexico,
  miami,
  monaco,
  losail: qatar,
  red_bull_ring: redBullRing,
  silverstone,
  marina_bay: singapore,
  catalunya: spain,
  suzuka,
  americas: austin,
  yas_marina: yasMarina,
};

export function circuitImage(apiId: string | null | undefined): string | null {
  return (apiId && CIRCUIT_IMAGES[apiId]) || null;
}
