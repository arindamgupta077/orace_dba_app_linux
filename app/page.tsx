import { redirect } from "next/navigation";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await requireAuthenticatedSession();
  redirect(session?.user.role === "dba_admin" ? "/dba-console/shift-management" : "/dashboard");
}
