type ButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;

  variant?:
    | "primary"
    | "success"
    | "danger"
    | "secondary";
};

export default function Button({
  children,
  onClick,
  variant = "primary",
}: ButtonProps) {
  const colors = {
    primary: "#2563eb",
    success: "#16a34a",
    danger: "#dc2626",
    secondary: "#374151",
  };

  return (
    <button
      onClick={onClick}
      style={{
        background: colors[variant],
        color: "white",
        border: "none",
        padding: "12px 22px",
        borderRadius: "10px",
        cursor: "pointer",
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}