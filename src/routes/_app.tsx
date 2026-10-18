import { Outlet, createFileRoute } from "@tanstack/react-router";

import { ShellLayout } from "@/components/Shell";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  return (
    <ShellLayout>
      <Outlet />
    </ShellLayout>
  );
}
