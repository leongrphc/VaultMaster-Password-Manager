"use client";

import { useEffect } from "react";
import { initWebSentry } from "@/lib/sentry";

export default function SentryInit() {
  useEffect(() => {
    initWebSentry();
  }, []);

  return null;
}
