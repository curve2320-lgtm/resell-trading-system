import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  AdminAccessError,
  requireAdmin,
} from "../admin-auth.ts";
import { readAdminDashboardData } from "../admin-api.ts";
import { createCollectionRepository } from "../collection/repository.ts";
import { chatGPTSignInPath } from "../chatgpt-auth.ts";
import { AdminDashboard } from "./admin-dashboard.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Release administration",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAccessError) {
      if (error.status === 401) {
        redirect(chatGPTSignInPath("/admin"));
      }
      if (error.status === 403) {
        notFound();
      }
    }
    throw new Error("Administration is temporarily unavailable.");
  }

  const initialData = await readAdminDashboardData(
    createCollectionRepository(),
  );
  return (
    <AdminDashboard
      initialData={initialData}
      now={new Date().toISOString()}
    />
  );
}
