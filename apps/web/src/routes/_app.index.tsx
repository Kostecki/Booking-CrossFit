import { Alert, Button, Container, Group, Stack, Text, Title } from "@mantine/core";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { logout } from "#/server/auth.functions.ts";

export const Route = createFileRoute("/_app/")({ component: Home });

// Placeholder until the schedule screen lands (Phase 2).
function Home() {
	const { user } = Route.useRouteContext();
	const router = useRouter();
	const doLogout = useServerFn(logout);

	return (
		<Container size="sm" py="xl">
			<Stack>
				<Group justify="space-between">
					<Title order={2}>Hej {user.fullName}</Title>
					<Button
						variant="subtle"
						onClick={async () => {
							await doLogout();
							await router.invalidate();
						}}
					>
						Log ud
					</Button>
				</Group>
				{user.status === "needs_reauth" && (
					<Alert color="red">Dit BookingBoard-login virker ikke længere. <Link to="/login">Log ind igen</Link>.</Alert>
				)}
				<Text c="dimmed">Du er logget ind som {user.email}.</Text>
			</Stack>
		</Container>
	);
}
