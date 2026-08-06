type Props = {
  company: any;
};

export default function CompanyOverview({
  company,
}: Props) {
  if (!company) return null;

  return (
    <div
      style={{
        background: "#111",
        borderRadius: "20px",
        padding: "25px",
        marginTop: "30px",
      }}
    >
      <h2>Company Overview</h2>

      <p
        style={{
          color: "#aaa",
          lineHeight: 1.7,
          marginTop: "15px",
        }}
      >
        {company.description}
      </p>
    </div>
  );
}