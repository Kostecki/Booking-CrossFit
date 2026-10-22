import {
	Alert,
	Button,
	Card,
	Chip,
	Group,
	Loader,
	Stack,
	Switch,
	Text,
	Title,
} from "@mantine/core";
import { IconPlayerPlay } from "@tabler/icons-react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { notifyError, notifyInfo } from "#/components/notify.ts";
import { requestRun } from "#/server/runs.functions.ts";
import {
	getTimetable,
	type SlotOption,
	setPaused,
	setSlot,
} from "#/server/schedule.functions.ts";

export const Route = createFileRoute("/_app/")({
	loader: () => getTimetable(),
	pendingComponent: () => <Loader m="xl" />,
	component: Schedule,
});

const WEEKDAYS = ["Søndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"];
const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (o: SlotOption) => `${o.classTitle}|${o.weekday}|${o.hour}|${o.minute}`;

function Schedule() {
	const { user } = Route.useRouteContext();
	const router = useRouter();
	const initial = Route.useLoaderData();
	const saveSlot = useServerFn(setSlot);
	const savePaused = useServerFn(setPaused);
	const runNow = useServerFn(requestRun);

	// Toggles are applied locally so the timetable isn't refetched from BookingBoard each time.
	const [options, setOptions] = useState(initial);
	const titles = useMemo(
		() => [...new Set(options.map((o) => o.classTitle))].sort((a, b) => a.localeCompare(b, "da")),
		[options],
	);
	const [filter, setFilter] = useState<string[]>(() => {
		const picked = [...new Set(initial.filter((o) => o.selected).map((o) => o.classTitle))];
		if (picked.length > 0) return picked;
		return titles.includes("WOD") ? ["WOD"] : titles;
	});
	const [running, setRunning] = useState(false);

	const selectedCount = options.filter((o) => o.selected).length;
	const visible = options.filter((o) => filter.includes(o.classTitle) || o.selected);
	const byWeekday = new Map<number, SlotOption[]>();
	for (const o of visible) byWeekday.set(o.weekday, [...(byWeekday.get(o.weekday) ?? []), o]);

	async function toggle(option: SlotOption, selected: boolean) {
		const update = (value: boolean) =>
			setOptions((all) => all.map((o) => (keyOf(o) === keyOf(option) ? { ...o, selected: value } : o)));
		update(selected);
		try {
			const { classTitle, weekday, hour, minute } = option;
			await saveSlot({ data: { classTitle, weekday, hour, minute, selected } });
		} catch (error) {
			update(!selected);
			notifyError(error);
		}
	}

	async function onRunNow() {
		setRunning(true);
		try {
			const result = await runNow();
			if (!result.ok) {
				notifyInfo(result.error);
				return;
			}
			await router.navigate({ to: "/aktivitet" });
		} catch (error) {
			notifyError(error);
		} finally {
			setRunning(false);
		}
	}

	return (
		<Stack>
			{user.status === "needs_reauth" && (
				<Alert color="red" title="Login virker ikke længere">
					Dit BookingBoard-login blev afvist, så der bookes ikke.{" "}
					<Link to="/login">Log ind igen</Link>.
				</Alert>
			)}

			<Card withBorder>
				<Stack gap="sm">
					<Text size="sm">
						Vælg de hold, du vil have booket hver uge. Hver aften kl. 19 booker vi de næste
						hold, der passer, indtil du har 5 bookinger.
					</Text>
					<Group justify="space-between">
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
						<Button
							leftSection={<IconPlayerPlay size={16} />}
							variant="light"
							loading={running}
							disabled={selectedCount === 0 || user.status === "needs_reauth"}
							onClick={onRunNow}
						>
							Kør min booking nu
						</Button>
					</Group>
				</Stack>
			</Card>

			<Chip.Group multiple value={filter} onChange={setFilter}>
				<Group gap="xs">
					{titles.map((title) => (
						<Chip key={title} value={title} size="sm">
							{title}
						</Chip>
					))}
				</Group>
			</Chip.Group>

			{[...byWeekday.entries()].map(([weekday, slots]) => (
				<Stack key={weekday} gap="xs">
					<Title order={5}>{WEEKDAYS[weekday]}</Title>
					{slots.map((option) => (
						<Card key={keyOf(option)} withBorder padding="sm">
							<Switch
								checked={option.selected}
								onChange={(event) => toggle(option, event.currentTarget.checked)}
								label={`${pad(option.hour)}:${pad(option.minute)} · ${option.classTitle}`}
								description={option.offered ? undefined : "Udbydes ikke længere"}
								labelPosition="left"
								styles={{ body: { justifyContent: "space-between" }, labelWrapper: { flex: 1 } }}
							/>
						</Card>
					))}
				</Stack>
			))}
			{visible.length === 0 && <Text c="dimmed">Vælg en eller flere holdtyper ovenfor.</Text>}
		</Stack>
	);
}
