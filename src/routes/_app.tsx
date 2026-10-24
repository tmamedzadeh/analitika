import { Outlet, createFileRoute } from "@tanstack/react-router";

import { ShellLayout } from "@/components/Shell";
import { DocumentImageUploadProvider } from "@/components/DocumentImageUploads";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  return (
    <ShellLayout>
      <DocumentImageUploadProvider>
        <Outlet />
      </DocumentImageUploadProvider>
    </ShellLayout>
  );
}
