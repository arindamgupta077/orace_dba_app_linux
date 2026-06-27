import { Suspense } from "react";

import { FirstLoginResetClient } from "@/app/first-login-reset/first-login-reset-client";

export default function FirstLoginResetPage() {
  return (
    <Suspense fallback={null}>
      <FirstLoginResetClient />
    </Suspense>
  );
}
