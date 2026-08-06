type RecentActivityProps = {
  activities: any[];
};

export default function RecentActivity({
  activities,
}: RecentActivityProps) {
  return (
    <div style={{ marginTop: "40px" }}>
      <h2>🕒 Recent Activity</h2>

      {activities.length === 0 ? (
        <p>No activity yet.</p>
      ) : (
        activities.map((activity) => (
          <div
            key={activity.id}
            style={{
              background: "#111",
              padding: "15px",
              borderRadius: "8px",
              marginTop: "10px",
            }}
          >
            <p>{activity.action}</p>

            <small>
              {new Date(
                activity.created_at
              ).toLocaleString()}
            </small>
          </div>
        ))
      )}
    </div>
  );
}