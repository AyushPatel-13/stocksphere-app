type Props = {
  children: React.ReactNode;
};

/**
 * The card grid.
 *
 * The layout is still one row of auto-fill tracks with the same 20px gap. Two
 * things moved into WL_STYLES: the 340px track floor is now min(100%, 340px),
 * so a narrow viewport collapses to a full-width column instead of overflowing,
 * and the grid's own 25px top margin is gone — the header's 30px bottom margin
 * already separates them, and together they were 55px of space.
 */
export default function WatchlistGrid({
  children,
}: Props) {
  return <div className="wl-grid">{children}</div>;
}
