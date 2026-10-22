import {
	ActionIcon,
	Button,
	Card,
	Chip,
	Divider,
	Drawer,
	Group,
	Loader,
	Select,
	Stack,
	Switch,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconPlus, IconX } from "@tabler/icons-react";
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

export const Route = createFileRoute("/_app/skema")({
	loader: () => getTimetable(),
	pendingComponent: () => <Loader m="xl" />,
	component: Schedule,
});

const WEEKDAYS = ["Søndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"];
const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (o: SlotOption) => `${pad(o.hour)}:${pad(o.minute)}`;
const keyOf = (o: SlotOption) => `${o.classTitle}|${o.weekday}|${o.hour}|${o.minute}`;

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
			setOptions((all) => all.map((o) => (keyOf(o) === keyOf(option) ? { ...o, selected: to } : o)));
		update(value);
		try {
			const { classTitle, weekday, hour, minute } = option;
			await saveSlot({ data: { classTitle, weekday, hour, minute, selected: value } });
		} catch (error) {
			update(!value);
			notifyError(error);
		}
	}

	return (
		<Stack>
			<Card withBorder>
				<Stack gap="xs">
					<Switch
						label="Automatisk booking"
						checked={user.status === "active"}
						disabled={user.status === "needs_reauth"}
						onChange={async (event) => {
							try {
								await savePaused({ data: { paused: !event.currentTarget.checked } });
								await router.invalidate();
							} catch (error) {
								notifyError(error);
							}
						}}
					/>
					<Text size="sm" c="dimmed">
						Hver aften kl. 19 booker vi de næste hold fra dit skema, indtil du har 5 bookinger.
					</Text>
				</Stack>
			</Card>

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
										{WEEKDAYS[option.weekday]} · {timeOf(option)} · {option.classTitle}
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
			<Button leftSection={<IconPlus size={16} />} variant="light" onClick={drawer.open}>
				Tilføj hold
			</Button>

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
		() => [...new Set(options.map((o) => o.classTitle))].sort((a, b) => a.localeCompare(b, "da")),
		[options],
	);
	// Start on the type the user picks most, else WOD.
	const [title, setTitle] = useState(() => {
		const counts = new Map<string, number>();
		for (const o of options) if (o.selected) counts.set(o.classTitle, (counts.get(o.classTitle) ?? 0) + 1);
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
		<Drawer opened={opened} onClose={onClose} position="bottom" size="auto" title="Tilføj hold">
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
					{byWeekday.size === 0 && <Text c="dimmed">Ingen tider for {title} lige nu.</Text>}
				</Stack>
				<Button onClick={onClose}>Færdig</Button>
			</Stack>
		</Drawer>
	);
}
