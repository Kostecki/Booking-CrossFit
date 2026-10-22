import { Button, Card, Stack, Text, Title } from "@mantine/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ConfirmButton } from "#/components/ConfirmButton.tsx";
import { NotificationsCard } from "#/components/NotificationsCard.tsx";
import { deleteAccount, logout } from "#/server/auth.functions.ts";
import { getPushConfig } from "#/server/push.functions.ts";

export const Route = createFileRoute("/_app/indstillinger")({
	loader: () => getPushConfig(),
	component: Settings,
});

function Settings() {
	const { user } = Route.useRouteContext();
	const router = useRouter();
	const doLogout = useServerFn(logout);
	const doDelete = useServerFn(deleteAccount);
	const { publicKey } = Route.useLoaderData();

	return (
		<Stack>
			<NotificationsCard publicKey={publicKey} />

			<Card withBorder>
				<Stack gap="xs">
					<Title order={5}>Konto</Title>
					<Text size="sm">{user.fullName}</Text>
					<Text size="sm" c="dimmed">
						{user.email}
					</Text>
					<Button
						variant="default"
						onClick={async () => {
							await doLogout();
							await router.invalidate();
						}}
					>
						Log ud
					</Button>
				</Stack>
			</Card>

			<Card withBorder>
				<Stack gap="xs">
					<Title order={5}>Slet konto</Title>
					<Text size="sm" c="dimmed">
						Sletter dit skema, din historik og din gemte adgangskode. Dine eksisterende
						bookinger i BookingBoard bliver ikke rørt.
					</Text>
					<ConfirmButton
						color="red"
						variant="light"
						title="Slet konto"
						message="Er du sikker? Der bookes ikke længere automatisk for dig."
						confirmLabel="Slet"
						onConfirm={async () => {
							await doDelete();
							await router.invalidate();
						}}
					>
						Slet konto
					</ConfirmButton>
				</Stack>
			</Card>
		</Stack>
	);
}
