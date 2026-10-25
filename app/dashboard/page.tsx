import AuthGuard from "@/components/AuthGuard";
import PersonalDashboard from "@/components/Dashboard/PersonalDashboard";

export default function DashboardPage() {
  return (
    <AuthGuard>
      <PersonalDashboard />
    </AuthGuard>
  );
}
