import { getTimePartsInZone } from "@booking/core/automation";
import { Anchor, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { NotificationsGroup } from "#/components/NotificationsGroup.tsx";
import { SettingsGroup, SettingsRow } from "#/components/Settings.tsx";
import { deleteAccount, logout } from "#/server/auth.functions.ts";
import { getPushConfig } from "#/server/push.functions.ts";

export const Route = createFileRoute("/_app/settings")({
	loader: () => getPushConfig(),
	component: Settings,
});

function Settings() {
	const router = useRouter();
	const doLogout = useServerFn(logout);
	const doDelete = useServerFn(deleteAccount);
	const { publicKey } = Route.useLoaderData();
	const [confirmOpened, confirm] = useDisclosure(false);
	const [deleting, setDeleting] = useState(false);

	return (
		<Stack gap="lg">
			<NotificationsGroup publicKey={publicKey} />

			<SettingsGroup
				label="Konto"
				footer="Sletter du kontoen, stopper auto-booking, og dine faste hold, din historik og dit gemte login slettes. Intet ændres i BookingBoard – heller ikke dine bookinger."
			>
				<SettingsRow
					label="Log ud"
					onClick={async () => {
						await doLogout();
						await router.invalidate();
					}}
				/>
				<SettingsRow
					label="Slet konto"
					tint="destructive"
					onClick={confirm.open}
				/>
			</SettingsGroup>

			<Version />

			<Modal
				opened={confirmOpened}
				onClose={confirm.close}
				title="Slet konto"
				centered
			>
				<Text size="sm">
					Er du sikker? Der bookes ikke længere automatisk for dig.
				</Text>
				<Group justify="flex-end" mt="lg">
					<Button variant="default" onClick={confirm.close}>
						Annuller
					</Button>
					<Button
						color="red"
						loading={deleting}
						onClick={async () => {
							setDeleting(true);
							try {
								await doDelete();
								await router.invalidate();
							} finally {
								setDeleting(false);
							}
						}}
					>
						Slet
					</Button>
				</Group>
			</Modal>
		</Stack>
	);
}

// Built by hand, so server and browser render the same text (see danishDateLabel).
const BUILT = (() => {
	const { year, month, day, hour, minute } = getTimePartsInZone(
		Date.parse(__BUILD_TIME__),
		"Europe/Copenhagen",
	);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${day}/${month}/${year} ${pad(hour)}:${pad(minute)}`;
})();

function Version() {
	const short = __COMMIT_SHA__.slice(0, 7);
	return (
		<Text size="xs" c="dimmed" ta="center">
			Version{" "}
			{__COMMIT_SHA__ === "dev" ? (
				"dev"
			) : (
				<Anchor
					href={`https://github.com/Kostecki/Booking-CrossFit/commit/${__COMMIT_SHA__}`}
					target="_blank"
					inherit
				>
					{short}
				</Anchor>
			)}{" "}
			· bygget {BUILT}
		</Text>
	);
}
