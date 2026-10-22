import { Alert, AppShell, Group, Text, Title, UnstyledButton } from "@mantine/core";
import {
	IconActivity,
	IconCalendarEvent,
	IconListCheck,
	IconSettings,
} from "@tabler/icons-react";
import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";

// Everything under this layout requires a logged-in user.
export const Route = createFileRoute("/_app")({
	beforeLoad: ({ context }) => {
		if (!context.user) throw redirect({ to: "/login" });
		return { user: context.user };
	},
	component: Layout,
});

const tabs = [
	{ to: "/", label: "Kommende", icon: IconCalendarEvent },
	{ to: "/skema", label: "Skema", icon: IconListCheck },
	{ to: "/aktivitet", label: "Aktivitet", icon: IconActivity },
	{ to: "/indstillinger", label: "Indstillinger", icon: IconSettings },
] as const;

function Layout() {
	const { user } = Route.useRouteContext();
	return (
		<AppShell header={{ height: 52 }} footer={{ height: 64 }} padding="md">
			<AppShell.Header px="md" style={{ paddingTop: "env(safe-area-inset-top)" }}>
				<Group h={52}>
					<Title order={4}>CrossFit Booking</Title>
				</Group>
			</AppShell.Header>
			<AppShell.Main maw={640} mx="auto">
				{user.status === "needs_reauth" && (
					<Alert color="red" title="Login virker ikke længere" mb="md">
						Dit BookingBoard-login blev afvist, så der bookes ikke.{" "}
						<Link to="/login">Log ind igen</Link>.
					</Alert>
				)}
				<Outlet />
			</AppShell.Main>
			<AppShell.Footer style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
				<Group grow h={64} gap={0}>
					{tabs.map(({ to, label, icon: Icon }) => (
						<UnstyledButton
							key={to}
							component={Link}
							to={to}
							activeOptions={{ exact: true }}
							style={{ textAlign: "center", color: "var(--mantine-color-dimmed)" }}
							// A darker shade of the brand green: #61a928 is too faint for small text on white.
							activeProps={{ style: { textAlign: "center", color: "var(--mantine-color-green-8)" } }}
						>
							<Icon size={22} style={{ display: "block", margin: "0 auto" }} />
							<Text size="xs" inherit c="inherit">
								{label}
							</Text>
						</UnstyledButton>
					))}
				</Group>
			</AppShell.Footer>
		</AppShell>
	);
}
