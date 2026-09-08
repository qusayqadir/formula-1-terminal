import awsArchitecture from "@/assets/architecture/aws-architecture.png";
import chatGraph from "@/assets/architecture/chat-graph.png";
import databaseSchema from "@/assets/architecture/database-schema.png";

/** Architecture — annotated system diagrams. The AWS infrastructure diagram
 *  and the LangGraph chat/RAG graph, each with explanatory copy. */
export function DocsArchitecture() {
  return (
    <div className="mx-auto max-w-3xl px-5 pb-16 pt-8">
      <p className="eyebrow">Documentation / Architecture</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">System design</h1>
      <p className="mt-2 max-w-xl text-xs leading-relaxed text-sub">
        The end-to-end architecture of the platform — from cloud infrastructure
        to the chat routing graph.
      </p>

      {/* AWS infrastructure */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold tracking-tight text-ink">
          Cloud infrastructure
        </h2>
        <p className="mt-2 max-w-xl text-xs leading-relaxed text-sub">
          Placeholder text — a walkthrough of the AWS deployment: how live and
          historic F1 data is ingested, streamed, processed, and served through
          the terminal. Describe the ECR/Fargate producers, the MQTT/Kinesis
          streaming layer, storage, and the API tier here.
        </p>
        <figure className="mt-4 overflow-hidden rounded-xl border border-stroke bg-surface shadow-[var(--shadow-card)]">
          <img
            src={awsArchitecture}
            alt="AWS F1-Terminal Architecture"
            className="h-auto w-full"
          />
        </figure>
      </section>

      {/* Chat / RAG graph */}
      <section className="mt-10">
        <h2 className="text-sm font-semibold tracking-tight text-ink">
          Chat routing graph
        </h2>
        <p className="mt-2 max-w-xl text-xs leading-relaxed text-sub">
          Placeholder text — the LangGraph <code className="font-mono text-[11px] text-ink">terminal_chat</code> flow:
          a router classifies each question and dispatches it to the regulation
          RAG subgraph, the data-visualization (text-to-SQL) subgraph, or an
          out-of-scope response. Explain the nodes and edges shown below.
        </p>
        <figure className="mt-4 overflow-hidden rounded-xl border border-stroke bg-surface shadow-[var(--shadow-card)]">
          <img
            src={chatGraph}
            alt="Final chat graph"
            className="mx-auto h-auto w-full max-w-md"
          />
        </figure>
      </section>

      {/* Placeholder sections — swap each ImagePlaceholder for a real <img> once
          the corresponding diagram/screenshot exists. */}
      <section className="mt-10">
        <h2 className="text-sm font-semibold tracking-tight text-ink">
          LangSmith observability
        </h2>
        <p className="mt-2 max-w-xl text-xs leading-relaxed text-sub">
          Placeholder text — tracing and evaluation of the chat graph: per-run
          traces, latency and token accounting, and route-classifier eval scores
          captured in LangSmith.
        </p>
        <ImagePlaceholder label="LangSmith Observability" />
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold tracking-tight text-ink">
          AWS billing
        </h2>
        <p className="mt-2 max-w-xl text-xs leading-relaxed text-sub">
          Placeholder text — cost breakdown of the deployment: current spend by
          service alongside forecasted month-end cost.
        </p>
        <ImagePlaceholder label="AWS Billing (Cost / Predicted Cost)" />
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold tracking-tight text-ink">
          Database schema
        </h2>
        <p className="mt-2 max-w-xl text-xs leading-relaxed text-sub">
          Placeholder text — the Postgres data model: seasons, rounds, sessions,
          results, drivers, teams, and circuits, and how they relate.
        </p>
        {/* Schema render is very tall — scroll it inside a fixed-height frame
            rather than letting it dominate the page. */}
        <figure className="mt-4 max-h-[520px] overflow-auto rounded-xl border border-stroke bg-surface shadow-[var(--shadow-card)]">
          <img
            src={databaseSchema}
            alt="F1 Terminal database schema"
            className="h-auto w-full"
          />
        </figure>
      </section>
    </div>
  );
}

/** Dashed frame standing in for a diagram/screenshot that doesn't exist yet.
 *  Matches the AWS/chat figure chrome so the page reads as one system. */
function ImagePlaceholder({ label }: { label: string }) {
  return (
    <figure className="mt-4 grid min-h-[220px] place-items-center rounded-xl border border-dashed border-stroke-strong bg-surface p-8 text-center shadow-[var(--shadow-card)]">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-mut">
          {label}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-sub">Image coming soon</p>
      </div>
    </figure>
  );
}
