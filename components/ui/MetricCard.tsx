import Card from "./Card";

type Props = {
  title: string;
  value: string | number;
};

export default function MetricCard({
  title,
  value,
}: Props) {
  return (
    <Card>
      <h3
        style={{
          color: "#888",
          marginBottom: "10px",
          fontSize: "15px",
        }}
      >
        {title}
      </h3>

      <h2>{value}</h2>
    </Card>
  );
}