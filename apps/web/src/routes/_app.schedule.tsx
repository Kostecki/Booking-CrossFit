import {
	ActionIcon,
	Button,
	Card,
	Chip,
	Divider,
	Drawer,
	Group,
	List,
	Loader,
	Select,
	Stack,
	Switch,
	Text,
	ThemeIcon,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	IconAlertTriangle,
	IconBolt,
	IconPlayerPause,
	IconPlus,
	IconX,
} from "@tabler/icons-react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Fragment, useMemo, useState } from "react";

import { notifyError } from "#/components/notify.ts";
import {
	getTimetable,
	type SlotOption,
	setPaused,
	setSlot,
} from "#/server/schedule.functions.ts";

export const Route = createFileRoute("/_app/schedule")({
	loader: () => getTimetable(),
	pendingComponent: () => <Loader m="xl" />,
	component: Schedule,
});

const WEEKDAYS = [
	"Søndag",
	"Mandag",
	"Tirsdag",
	"Onsdag",
	"Torsdag",
	"Fredag",
	"Lørdag",
];
const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (o: SlotOption) => `${pad(o.hour)}:${pad(o.minute)}`;
const keyOf = (o: SlotOption) =>
	`${o.classTitle}|${o.weekday}|${o.hour}|${o.minute}`;

function Schedule() {
	const { user } = Route.useRouteContext();
	const router = useRouter();
	const saveSlot = useServerFn(setSlot);
	const savePaused = useServerFn(setPaused);
	const [drawerOpened, drawer] = useDisclosure(false);

	// Toggles are applied locally so the timetable isn't refetched from BookingBoard each time.
	// The loader returns options Monday first, then by time.
	const initial = Route.useLoaderData();
	const [options, setOptions] = useState(initial);
	const selected = options.filter((o) => o.selected);

	async function toggle(option: SlotOption, value: boolean) {
		const update = (to: boolean) =>
			setOptions((all) =>
				all.map((o) =>
					keyOf(o) === keyOf(option) ? { ...o, selected: to } : o,
				),
			);
		update(value);
		try {
			const { classTitle, weekday, hour, minute } = option;
			await saveSlot({
				data: { classTitle, weekday, hour, minute, selected: value },
			});
		} catch (error) {
			update(!value);
			notifyError(error);
		}
	}

	return (
		<Stack>
			<AutoBookingStatus
				status={user.status}
				hasClasses={selected.length > 0}
				onToggle={async (active) => {
					try {
						await savePaused({ data: { paused: !active } });
						await router.invalidate();
					} catch (error) {
						notifyError(error);
					}
				}}
			/>

			<Title order={4}>Mine faste hold</Title>
			{selected.length === 0 ? (
				<Text c="dimmed">Du har ikke valgt nogen hold endnu.</Text>
			) : (
				<Card withBorder padding={0}>
					{selected.map((option, index) => (
						<Fragment key={keyOf(option)}>
							{index > 0 && <Divider />}
							<Group justify="space-between" wrap="nowrap" px="md" py="sm">
								<Stack gap={0}>
									<Text>
										{WEEKDAYS[option.weekday]} · {timeOf(option)} ·{" "}
										{option.classTitle}
									</Text>
									{!option.offered && (
										<Text size="xs" c="dimmed">
											Udbydes ikke længere
										</Text>
									)}
								</Stack>
								<ActionIcon
									variant="subtle"
									color="gray"
									aria-label="Fjern"
									onClick={() => toggle(option, false)}
								>
									<IconX size={18} />
								</ActionIcon>
							</Group>
						</Fragment>
					))}
				</Card>
			)}
			<Button leftSection={<IconPlus size={16} />} onClick={drawer.open}>
				Tilføj hold
			</Button>

			<Stack gap={4} mt="md">
				<Text size="sm" fw={500} c="dimmed">
					Sådan virker det
				</Text>
				<List size="sm" c="dimmed" spacing={2}>
					<List.Item>
						Der bookes op til 5 hold ad gangen – det maksimale CrossFit Roskilde
						tillader.
					</List.Item>
					<List.Item>De tidligste hold bookes først.</List.Item>
					<List.Item>Er et hold fuldt, kommer du på venteliste.</List.Item>
					<List.Item>
						Hold du selv melder fra eller springer over, bookes ikke igen
						automatisk.
					</List.Item>
				</List>
			</Stack>

			<AddClassesDrawer
				opened={drawerOpened}
				onClose={drawer.close}
				options={options}
				onToggle={toggle}
			/>
		</Stack>
	);
}

function AddClassesDrawer({
	opened,
	onClose,
	options,
	onToggle,
}: {
	opened: boolean;
	onClose: () => void;
	options: SlotOption[];
	onToggle: (option: SlotOption, selected: boolean) => void;
}) {
	const titles = useMemo(
		() =>
			[...new Set(options.map((o) => o.classTitle))].sort((a, b) =>
				a.localeCompare(b, "da"),
			),
		[options],
	);
	// Start on the type the user picks most, else WOD.
	const [title, setTitle] = useState(() => {
		const counts = new Map<string, number>();
		for (const o of options)
			if (o.selected)
				counts.set(o.classTitle, (counts.get(o.classTitle) ?? 0) + 1);
		const mostUsed = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
		return mostUsed ?? (titles.includes("WOD") ? "WOD" : titles[0]);
	});

	const byWeekday = new Map<number, SlotOption[]>();
	for (const o of options) {
		if (o.classTitle === title && o.offered) {
			byWeekday.set(o.weekday, [...(byWeekday.get(o.weekday) ?? []), o]);
		}
	}

	return (
		<Drawer
			opened={opened}
			onClose={onClose}
			position="bottom"
			size="auto"
			title="Tilføj hold"
		>
			<Stack>
				<Select
					label="Holdtype"
					data={titles}
					value={title}
					onChange={(value) => value && setTitle(value)}
					allowDeselect={false}
					searchable
				/>
				<Stack gap="sm">
					{[...byWeekday.entries()].map(([weekday, slots]) => (
						<Group key={weekday} wrap="nowrap" align="flex-start">
							<Text size="sm" w={70} pt={4} style={{ flexShrink: 0 }}>
								{WEEKDAYS[weekday]}
							</Text>
							<Group gap="xs">
								{slots.map((option) => (
									<Chip
										key={keyOf(option)}
										size="sm"
										checked={option.selected}
										onChange={(checked) => onToggle(option, checked)}
									>
										{timeOf(option)}
									</Chip>
								))}
							</Group>
						</Group>
					))}
					{byWeekday.size === 0 && (
						<Text c="dimmed">Ingen tider for {title} lige nu.</Text>
					)}
				</Stack>
				<Button onClick={onClose}>Færdig</Button>
			</Stack>
		</Drawer>
	);
}

// The page's headline: whether auto-booking runs, and when it next books.
function AutoBookingStatus({
	status,
	hasClasses,
	onToggle,
}: {
	status: "active" | "paused" | "needs_reauth";
	hasClasses: boolean;
	onToggle: (active: boolean) => void;
}) {
	const look = {
		active: {
			color: "green",
			icon: <IconBolt size={20} />,
			title: "Auto-booking er aktiv",
			text: hasClasses
				? `Næste booking: ${nextRunLabel()}`
				: "Vælg hold nedenfor, så bookes de automatisk.",
		},
		paused: {
			color: "gray",
			icon: <IconPlayerPause size={20} />,
			title: "Auto-booking er sat på pause",
			text: "Der bookes ikke automatisk, før det aktiveres igen.",
		},
		needs_reauth: {
			color: "red",
			icon: <IconAlertTriangle size={20} />,
			title: "Auto-booking er stoppet",
			text: "Log ind igen for at fortsætte.",
		},
	}[status];

	return (
		<Card
			withBorder
			// Paused stays neutral but white, so it stands out from the grey page.
			bg={status === "paused" ? "white" : `${look.color}.0`}
			style={{
				borderColor: `var(--mantine-color-${look.color}-${status === "paused" ? 3 : 2})`,
			}}
		>
			<Group wrap="nowrap" gap="sm">
				<ThemeIcon variant="light" color={look.color} radius="xl" size={36}>
					{look.icon}
				</ThemeIcon>
				<Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
					<Text fw={600}>{look.title}</Text>
					<Text size="sm" c="dimmed">
						{look.text}
					</Text>
				</Stack>
				<Switch
					aria-label="Automatisk booking"
					checked={status === "active"}
					disabled={status === "needs_reauth"}
					onChange={(event) => onToggle(event.currentTarget.checked)}
				/>
			</Group>
		</Card>
	);
}

// The daily run starts at 19:00 Copenhagen time.
function nextRunLabel(): string {
	const hour = Number(
		new Intl.DateTimeFormat("en-GB", {
			timeZone: "Europe/Copenhagen",
			hour: "numeric",
			hourCycle: "h23",
		}).format(new Date()),
	);
	return hour < 19 ? "i aften kl. 19" : "i morgen kl. 19";
}
