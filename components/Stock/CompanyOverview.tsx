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
        border: "1px solid #222",
        borderRadius: "16px",
        padding: "24px",
        marginTop: "30px",
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: "22px",
          fontWeight: 700,
          letterSpacing: "-0.01em",
        }}
      >
        Company Overview
      </h2>

      {company.description ? (
        <p
          style={{
            color: "#aaa",
            fontSize: "15px",
            lineHeight: 1.7,
            marginTop: "14px",
            marginBottom: 0,
          }}
        >
          {company.description}
        </p>
      ) : (
        // Upstox is an instrument master, not a fundamentals provider, so an
        // Indian profile arrives with an empty description by design
        // (lib/adapters/company.ts). The card used to render that as a blank
        // paragraph under the heading, which reads as a broken section rather
        // than as "the provider does not carry this". Nothing is invented here:
        // the absence is stated in the page's own N/A idiom.
        <p
          style={{
            color: "#888",
            fontSize: "14px",
            marginTop: "14px",
            marginBottom: 0,
          }}
        >
          No company description available from the data provider.
        </p>
      )}
    </div>
  );
}