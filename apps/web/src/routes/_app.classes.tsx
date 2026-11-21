import {
	Button,
	Card,
	Group,
	Loader,
	Modal,
	Radio,
	ScrollArea,
	Stack,
	Text,
	Title,
	UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { takeFreshRequest } from "#/components/freshness.ts";
import { notifyError } from "#/components/notify.ts";
import { classBadge, StatusBadge } from "#/components/StatusBadge.tsx";
import {
	bookOneOff,
	type ClassOption,
	getClassList,
} from "#/server/classes.functions.ts";

export const Route = createFileRoute("/_app/classes")({
	loader: () => getClassList({ data: { fresh: takeFreshRequest() } }),
	pendingComponent: () => <Loader m="xl" />,
	component: Classes,
});

function Classes() {
	const { days, held, limit } = Route.useLoaderData();
	const [dayKey, setDayKey] = useState(days[0]?.key);
	const [booking, setBooking] = useState<ClassOption>();
	const day = days.find((d) => d.key === dayKey) ?? days[0];

	return (
		<Stack gap="xs">
			<Stack gap={0} mb="xs">
				<Title order={4}>Hold</Title>
				<Text size="xs" c="dimmed">
					Book et ekstra hold. Du har {held.length} af {limit} bookinger.
				</Text>
			</Stack>
			{days.length === 0 ? (
				<Text c="dimmed">Ingen kommende hold.</Text>
			) : (
				<>
					<DayStrip days={days} selected={day?.key} onSelect={setDayKey} />
					{day?.classes.map((cls) => (
						<ClassCard
							key={cls.classId}
							cls={cls}
							onBook={() => setBooking(cls)}
						/>
					))}
				</>
			)}
			<BookModal
				cls={booking}
				held={held}
				limit={limit}
				onClose={() => setBooking(undefined)}
			/>
		</Stack>
	);
}

// "Fredag 27. November" -> { weekday: "Fre", day: "27" }
function shortDay(dateLabel: string) {
	const [weekday = "", day = ""] = dateLabel.split(" ");
	return { weekday: weekday.slice(0, 3), day: day.replace(".", "") };
}

function DayStrip({
	days,
	selected,
	onSelect,
}: {
	days: { key: string; dateLabel: string }[];
	selected?: string;
	onSelect: (key: string) => void;
}) {
	return (
		<ScrollArea type="never" mb={4}>
			<Group gap={6} wrap="nowrap">
				{days.map(({ key, dateLabel }) => {
					const { weekday, day } = shortDay(dateLabel);
					const active = key === selected;
					return (
						<UnstyledButton
							key={key}
							onClick={() => onSelect(key)}
							aria-pressed={active}
							aria-label={dateLabel}
							w={48}
							py={6}
							style={{
								flexShrink: 0,
								borderRadius: 12,
								textAlign: "center",
								color: active ? "var(--mantine-color-green-9)" : undefined,
								backgroundColor: active
									? "rgba(97, 169, 40, 0.14)"
									: "var(--mantine-color-default)",
								border: "1px solid var(--mantine-color-default-border)",
							}}
						>
							<Text fz={11} fw={500} c={active ? "inherit" : "dimmed"}>
								{weekday}
							</Text>
							<Text fw={600} c="inherit">
								{day}
							</Text>
						</UnstyledButton>
					);
				})}
			</Group>
		</ScrollArea>
	);
}

function ClassCard({ cls, onBook }: { cls: ClassOption; onBook: () => void }) {
	const badge = classBadge({ ...cls, state: cls.myState });
	// Held, planned or queued classes are handled on Bookinger; the rest can be booked.
	const bookable =
		!cls.skipped &&
		(cls.myState === undefined ||
			(cls.myState === "cancelled" && !cls.rebookPending));
	return (
		<Card withBorder padding="sm">
			<Group justify="space-between" wrap="nowrap">
				<Stack gap={2} miw={0}>
					<Text fw={500}>
						{cls.time} · {cls.title}
					</Text>
					<Group gap="xs">
						{cls.occupancy && (
							<Text size="sm" c="dimmed">
								{cls.occupancy}
								{cls.full ? " - fuldt" : ""}
							</Text>
						)}
						{badge && <StatusBadge label={badge.label} color={badge.color} />}
					</Group>
				</Stack>
				{bookable && (
					<Button
						size="xs"
						variant="light"
						onClick={onBook}
						style={{ flexShrink: 0 }}
					>
						Book
					</Button>
				)}
			</Group>
		</Card>
	);
}

const classLabel = (cls: ClassOption) =>
	`${cls.title} ${cls.dateLabel} kl. ${cls.time}`;

function BookModal({
	cls,
	held,
	limit,
	onClose,
}: {
	cls?: ClassOption;
	held: ClassOption[];
	limit: number;
	onClose: () => void;
}) {
	const router = useRouter();
	const book = useServerFn(bookOneOff);
	const [busy, setBusy] = useState(false);
	// The furthest-out booking is suggested: it's the one the extra class displaces.
	const latest = held.at(-1);
	const [cancelId, setCancelId] = useState<string>();
	const atLimit = held.length >= limit;
	const selectedCancel = cancelId ?? (latest && String(latest.classId));

	function close() {
		setCancelId(undefined);
		onClose();
	}

	async function onConfirm() {
		if (!cls) return;
		setBusy(true);
		try {
			const { waitingList } = await book({
				data: {
					classId: cls.classId,
					cancelClassId: atLimit ? Number(selectedCancel) : undefined,
				},
			});
			notifications.show({
				color: waitingList ? "yellow" : "green",
				message: waitingList
					? `Du er på venteliste til ${classLabel(cls)}.`
					: `${classLabel(cls)} er booket.`,
			});
			close();
			await router.invalidate({ sync: true });
		} catch (error) {
			notifyError(error);
		} finally {
			setBusy(false);
		}
	}

	return (
		<Modal
			opened={!!cls}
			onClose={close}
			title={atLimit ? "Byt en booking" : "Book hold"}
			centered
		>
			{cls && (
				<Stack gap="sm">
					{atLimit ? (
						<>
							<Text size="sm">
								Du har allerede {held.length} bookinger. For at booke{" "}
								{classLabel(cls)} afmeldes:
							</Text>
							<Radio.Group value={selectedCancel} onChange={setCancelId}>
								<Stack gap="xs">
									{held.map((h) => (
										<Radio
											key={h.classId}
											value={String(h.classId)}
											label={`${h.dateLabel} kl. ${h.time} · ${h.title}${h.myState === "waitlist" ? " (venteliste)" : ""}`}
										/>
									))}
								</Stack>
							</Radio.Group>
							<Text size="sm" c="dimmed">
								Det afmeldte hold genbookes automatisk, når der er plads igen.
							</Text>
						</>
					) : (
						<Text size="sm">Book {classLabel(cls)}?</Text>
					)}
					{cls.full && (
						<Text size="sm" c="dimmed">
							Holdet er fuldt, så du kommer på venteliste.
						</Text>
					)}
					<Group justify="flex-end" mt="xs">
						<Button variant="default" onClick={close}>
							Annuller
						</Button>
						<Button
							loading={busy}
							disabled={atLimit && !selectedCancel}
							onClick={onConfirm}
						>
							{atLimit ? "Afmeld og book" : "Book"}
						</Button>
					</Group>
				</Stack>
			)}
		</Modal>
	);
}
