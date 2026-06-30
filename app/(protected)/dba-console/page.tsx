import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DbaConsolePage() {
  redirect("/dba-console/shift-management");
}
