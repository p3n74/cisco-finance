import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    // Redirect to home page where login form now lives
    redirect({
      to: "/",
      throw: true,
    });
  },
  component: () => null,
});
