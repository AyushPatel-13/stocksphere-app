type Props = {
  children: React.ReactNode;
};

export default function WatchlistGrid({
  children,
}: Props) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fill,minmax(340px,1fr))",
        gap: "20px",
        marginTop: "25px",
      }}
    >
      {children}
    </div>
  );
}