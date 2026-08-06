type CardProps = {
  children: React.ReactNode;
  style?: React.CSSProperties;
};

export default function Card({
  children,
  style,
}: CardProps) {
  return (
    <div
      style={{
        background: "#111",
        border: "1px solid #222",
        borderRadius: "16px",
        padding: "20px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}