import { createFileRoute, redirect } from "@tanstack/react-router";

// Kommende moved to "/"; keeps links in notifications sent before that working.
export const Route = createFileRoute("/_app/kommende")({
	beforeLoad: () => {
		throw redirect({ to: "/" });
	},
});
