/** Barre d'avancement d'un morceau, style lecteur mobile : piste fine, partie jouée épaisse, curseur rond. */
export function TrackBar({
  ratio,
  compact,
  onSeek,
}: {
  ratio: number;
  compact?: boolean;
  /** Clic sur la barre : position demandée entre 0 et 1. */
  onSeek?: (ratio: number) => void;
}) {
  const pct = `${Math.min(1, Math.max(0, ratio)) * 100}%`;
  return (
    <div
      className={`trackbar${compact ? " compact" : ""}${onSeek ? " seekable" : ""}`}
      onClick={
        onSeek
          ? (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onSeek((e.clientX - r.left) / r.width);
            }
          : undefined
      }
      role={onSeek ? "slider" : undefined}
      aria-label={onSeek ? "Position dans le morceau" : undefined}
      aria-valuenow={onSeek ? Math.round(ratio * 100) : undefined}
      aria-hidden={onSeek ? undefined : true}
    >
      <span className="trackbar-bg" />
      <span className="trackbar-fill" style={{ width: pct }} />
      <span className="trackbar-thumb" style={{ left: pct }} />
    </div>
  );
}
