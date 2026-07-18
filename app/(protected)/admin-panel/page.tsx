import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AdminPanelPage() {
  redirect("/admin-panel/database-inventory");
}