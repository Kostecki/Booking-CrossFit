import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

// Everything under this layout requires a logged-in user.
export const Route = createFileRoute("/_app")({
	beforeLoad: ({ context }) => {
		if (!context.user) throw redirect({ to: "/login" });
		return { user: context.user };
	},
	component: Outlet,
});
