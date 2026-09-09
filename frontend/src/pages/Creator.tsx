/** Creator — a single line pointing to the creator's LinkedIn profile. */
export function Creator() {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className="text-sm text-sub">
        Built by Qusay Qadir —{" "}
        <a
          href="https://www.linkedin.com/in/qusay-qadir/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline underline-offset-4 hover:text-ink"
        >
          linkedin.com/in/qusay-qadir
        </a>
      </p>
    </div>
  );
}
