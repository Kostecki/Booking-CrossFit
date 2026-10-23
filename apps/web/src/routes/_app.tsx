import {
	Alert,
	AppShell,
	Avatar,
	Group,
	Stack,
	Text,
	Title,
	UnstyledButton,
} from "@mantine/core";
import {
	IconCalendarEvent,
	IconHistory,
	IconListCheck,
	IconSettings,
} from "@tabler/icons-react";
import {
	createFileRoute,
	Link,
	Outlet,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";

import { requestFreshData } from "#/components/freshness.ts";

// Everything under this layout requires a logged-in user.
export const Route = createFileRoute("/_app")({
	beforeLoad: ({ context }) => {
		if (!context.user) throw redirect({ to: "/login" });
		return { user: context.user };
	},
	component: Layout,
});

// Leave room for the floating dock and the iPhone home-indicator area.
const TAB_BAR_HEIGHT = "calc(76px + env(safe-area-inset-bottom))";

const tabs = [
	{ to: "/", label: "Bookinger", icon: IconCalendarEvent },
	{ to: "/schedule", label: "Auto-booking", icon: IconListCheck },
	{ to: "/history", label: "Historik", icon: IconHistory },
	{ to: "/settings", label: "Indstillinger", icon: IconSettings },
] as const;

// Reload the current page when the app comes back to the foreground, e.g. after
// booking in the BookingBoard app, and skip the server's cached bookings for it.
function useRefreshOnResume() {
	const router = useRouter();
	useEffect(() => {
		const onVisibilityChange = () => {
			if (document.visibilityState !== "visible") return;
			requestFreshData();
			router.invalidate();
		};
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () =>
			document.removeEventListener("visibilitychange", onVisibilityChange);
	}, [router]);
}

function Layout() {
	const { user } = Route.useRouteContext();
	useRefreshOnResume();
	return (
		<AppShell
			header={{ height: 52 }}
			footer={{ height: TAB_BAR_HEIGHT }}
			padding="md"
		>
			<AppShell.Header
				px="md"
				style={{ paddingTop: "env(safe-area-inset-top)" }}
			>
				<Group h={52} justify="space-between" wrap="nowrap">
					<Title order={4} style={{ flexShrink: 0 }}>
						Auto CFR
					</Title>
					<UnstyledButton
						component={Link}
						to="/settings"
						miw={0}
						aria-label="Indstillinger"
					>
						<Group gap="xs" wrap="nowrap">
							<Text size="sm" fw={500} truncate>
								{user.fullName}
							</Text>
							{/* Without a picture, Avatar shows the name's initials. */}
							<Avatar
								src={user.profileImageUrl}
								name={user.fullName}
								alt=""
								size={32}
								color="initials"
							/>
						</Group>
					</UnstyledButton>
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
			<AppShell.Footer
				style={{
					padding: "8px 12px calc(8px + env(safe-area-inset-bottom))",
					background: "transparent",
					border: 0,
				}}
			>
				<Group
					component="nav"
					aria-label="Hovednavigation"
					h={60}
					p={5}
					gap={4}
					wrap="nowrap"
					style={{
						width: "100%",
						maxWidth: 420,
						marginInline: "auto",
						borderRadius: 20,
						border: "1px solid rgba(22, 28, 36, 0.08)",
						backgroundColor: "rgba(255, 255, 255, 0.78)",
						backdropFilter: "blur(20px) saturate(180%)",
						WebkitBackdropFilter: "blur(20px) saturate(180%)",
						boxShadow: "0 4px 20px rgba(22, 28, 36, 0.12)",
					}}
				>
					{tabs.map(({ to, label, icon: Icon }) => (
						<UnstyledButton
							key={to}
							component={Link}
							to={to}
							activeOptions={{ exact: true }}
							h="100%"
							style={{
								flex: 1,
								minWidth: 0,
								borderRadius: 15,
								color: "var(--mantine-color-ink-4)",
								transition: "background-color 160ms ease, color 160ms ease",
							}}
							activeProps={{
								style: {
									color: "var(--mantine-color-green-9)",
									backgroundColor: "rgba(97, 169, 40, 0.14)",
								},
							}}
						>
							<Stack gap={2} align="center" justify="center" h="100%">
								<Icon size={22} stroke={1.75} />
								<Text fz={11} fw={500} lh={1.2} c="inherit">
									{label}
								</Text>
							</Stack>
						</UnstyledButton>
					))}
				</Group>
			</AppShell.Footer>
		</AppShell>
	);
}
