import { DA_MONTHS, DA_WEEKDAYS } from "@booking/core/automation";
import type { PersonalStats } from "@booking/core/stats";
import {
	Box,
	Card,
	Group,
	Loader,
	SimpleGrid,
	Stack,
	Text,
	Title,
	Tooltip,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

import { type AppStats, getStats } from "#/server/stats.functions.ts";

export const Route = createFileRoute("/_app/stats")({
	loader: () => getStats(),
	pendingComponent: () => <Loader m="xl" />,
	component: Stats,
});

// Monday first, like the heatmap rows and stats.weekdays
const WEEKDAYS_SHORT = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
// Sequential green, light → dark, for 0, 1, 2 and 3+ classes a day
const HEAT = [
	"var(--mantine-color-ink-0)",
	"var(--mantine-color-green-3)",
	"var(--mantine-color-green-6)",
	"var(--mantine-color-green-9)",
];

const lower = (s: string) => s.toLowerCase();
const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

function Stats() {
	const { personal, app } = Route.useLoaderData();
	return (
		<Stack gap="lg">
			<Stack gap={0}>
				<Title order={4}>Statistik</Title>
				<Text size="xs" c="dimmed">
					{personal?.since
						? `Din træning siden ${formatDate(personal.since)}, så langt tilbage som BookingBoard husker.`
						: "Din træning, så langt tilbage som BookingBoard husker."}
				</Text>
			</Stack>
			{personal ? (
				<Personal stats={personal} />
			) : (
				<Text c="dimmed">
					Din træning kunne ikke hentes fra BookingBoard lige nu.
				</Text>
			)}
			<App stats={app} />
		</Stack>
	);
}

function formatDate(iso: string) {
	const date = new Date(iso);
	return `${date.getDate()}. ${lower(DA_MONTHS[date.getMonth()])} ${date.getFullYear()}`;
}

function Tile({
	label,
	value,
	detail,
}: {
	label: string;
	value: string | number;
	detail?: string;
}) {
	return (
		<Card withBorder padding="sm">
			<Text size="xs" c="dimmed">
				{label}
			</Text>
			<Text fz={26} fw={700} lh={1.2}>
				{value}
			</Text>
			{detail && (
				<Text size="xs" c="dimmed">
					{detail}
				</Text>
			)}
		</Card>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<Stack gap={6}>
			<Text size="xs" fw={600} c="dimmed" tt="uppercase" px="xs">
				{title}
			</Text>
			{children}
		</Stack>
	);
}

function Personal({ stats }: { stats: PersonalStats }) {
	const monthDiff = stats.thisMonth - stats.lastMonth;
	const { morning, midday, evening } = stats.timeOfDay;
	const type =
		stats.attended === 0
			? undefined
			: morning >= evening && morning >= midday
				? "Morgenfrisk"
				: evening >= midday
					? "Aftenmenneske"
					: "Frokosttræner";

	return (
		<>
			<Section title="Din træning">
				<SimpleGrid cols={2} spacing="xs">
					<Tile
						label="Hold i alt"
						value={stats.attended}
						detail={`ca. ${plural(stats.hoursTrained, "time", "timer")}`}
					/>
					<Tile
						label="Denne måned"
						value={stats.thisMonth}
						detail={
							monthDiff === 0
								? "Samme som sidste måned"
								: `${monthDiff > 0 ? "+" : ""}${monthDiff} ift. sidste måned`
						}
					/>
					<Tile
						label="Uger i træk"
						value={stats.currentStreakWeeks}
						detail={`Rekord: ${plural(stats.longestStreakWeeks, "uge", "uger")}`}
					/>
					<Tile
						label="Kommende"
						value={stats.upcoming}
						detail="Booket eller på venteliste"
					/>
				</SimpleGrid>
			</Section>

			<Section title="De sidste 12 uger">
				<Card withBorder padding="sm">
					<Heatmap days={stats.heatmap} start={stats.heatmapStart} />
				</Card>
			</Section>

			{stats.attended > 0 && (
				<Section title="Vaner">
					<Card withBorder padding="sm">
						<WeekdayBars weekdays={stats.weekdays} />
					</Card>
					<SimpleGrid cols={2} spacing="xs">
						{stats.favouriteTime && (
							<Tile
								label="Yndlingstid"
								value={stats.favouriteTime.time}
								detail={plural(stats.favouriteTime.count, "gang", "gange")}
							/>
						)}
						{type && (
							<Tile
								label="Du er"
								value={type}
								detail={`${morning} morgen · ${midday} middag · ${evening} aften`}
							/>
						)}
						{stats.favouriteClass && (
							<Tile
								label="Yndlingshold"
								value={stats.favouriteClass.title}
								detail={plural(stats.favouriteClass.count, "gang", "gange")}
							/>
						)}
						{stats.bestMonth && (
							<Tile
								label="Bedste måned"
								value={DA_MONTHS[stats.bestMonth.month - 1]}
								detail={`${plural(stats.bestMonth.count, "hold", "hold")} i ${stats.bestMonth.year}`}
							/>
						)}
						{stats.averageLeadDays !== undefined && (
							<Tile
								label="Booker i forvejen"
								value={`${stats.averageLeadDays.toLocaleString("da-DK")} d`}
								detail="I gennemsnit før holdet"
							/>
						)}
						<Tile
							label="Afmeldinger"
							value={stats.cancellations + stats.lateCancellations}
							detail={`${stats.lateCancellations} for sent · ${plural(stats.noShows, "udeblivelse", "udeblivelser")}`}
						/>
					</SimpleGrid>
				</Section>
			)}
		</>
	);
}

/** 12 rows of Monday–Sunday cells; days after today are left out. */
function Heatmap({ days, start }: { days: (number | null)[]; start: string }) {
	const startMs = Date.parse(`${start}T00:00:00Z`);
	return (
		<Stack gap={6}>
			<Box
				style={{
					display: "grid",
					gridTemplateColumns: "auto repeat(7, 1fr)",
					gap: 3,
					alignItems: "center",
				}}
			>
				<span />
				{WEEKDAYS_SHORT.map((day) => (
					<Text key={day} fz={10} c="dimmed" ta="center">
						{day}
					</Text>
				))}
				{days.map((count, index) => {
					// Calendar dates in UTC, so server and browser agree
					const date = new Date(startMs + index * 24 * 60 * 60 * 1000);
					const label = `${date.getUTCDate()}/${date.getUTCMonth() + 1}`;
					return [
						index % 7 === 0 && (
							<Text
								key={`week-${date.toISOString()}`}
								fz={10}
								c="dimmed"
								pr={4}
							>
								{label}
							</Text>
						),
						<Tooltip
							key={date.toISOString()}
							label={`${DA_WEEKDAYS[date.getUTCDay()]} ${label}: ${plural(count ?? 0, "hold", "hold")}`}
							events={{ hover: true, focus: true, touch: true }}
							disabled={count === null}
						>
							<Box
								aria-label={
									count === null ? undefined : `${label}: ${count} hold`
								}
								style={{
									height: 14,
									borderRadius: 3,
									background:
										count === null ? "transparent" : HEAT[Math.min(count, 3)],
								}}
							/>
						</Tooltip>,
					];
				})}
			</Box>
			<Group gap={4} justify="flex-end">
				<Text fz={10} c="dimmed">
					Ingen
				</Text>
				{HEAT.slice(1).map((color) => (
					<Box
						key={color}
						w={10}
						h={10}
						style={{ background: color, borderRadius: 2 }}
					/>
				))}
				<Text fz={10} c="dimmed">
					Flere hold
				</Text>
			</Group>
		</Stack>
	);
}

/** Attended classes per weekday as thin vertical bars, with the count above each. */
function WeekdayBars({ weekdays }: { weekdays: number[] }) {
	const max = Math.max(...weekdays, 1);
	return (
		<Stack gap={6}>
			<Text size="xs" c="dimmed">
				Hold pr. ugedag
			</Text>
			<Group gap={0} align="flex-end" wrap="nowrap" h={110}>
				{weekdays.map((count, index) => (
					<Stack
						key={WEEKDAYS_SHORT[index]}
						gap={2}
						align="center"
						justify="flex-end"
						h="100%"
						style={{ flex: 1 }}
						aria-label={`${WEEKDAYS_SHORT[index]}: ${count} hold`}
					>
						<Text fz={11} c="dimmed">
							{count > 0 ? count : ""}
						</Text>
						<Box
							w={18}
							h={`${(count / max) * 70}px`}
							style={{
								background: "var(--mantine-color-green-6)",
								borderRadius: "4px 4px 0 0",
								minHeight: count > 0 ? 3 : 0,
							}}
						/>
						<Box
							w="100%"
							h={1}
							style={{ background: "var(--mantine-color-ink-1)" }}
						/>
						<Text fz={11} c="dimmed">
							{WEEKDAYS_SHORT[index]}
						</Text>
					</Stack>
				))}
			</Group>
		</Stack>
	);
}

function App({ stats }: { stats: AppStats }) {
	return (
		<Section title="Auto CFR">
			<SimpleGrid cols={2} spacing="xs">
				<Tile
					label="Booket for dig"
					value={stats.bookedForYou}
					detail={
						stats.waitingListBookings > 0
							? `heraf ${stats.waitingListBookings} på venteliste`
							: `Bruger siden ${formatDate(stats.memberSince)}`
					}
				/>
				<Tile
					label="Booket for alle"
					value={stats.bookedForEveryone}
					detail={`${plural(stats.activeUsers, "aktiv bruger", "aktive brugere")}`}
				/>
				<Tile
					label="Kørsler for dig"
					value={stats.successfulRuns}
					detail={`${stats.totalRuns} for alle i alt`}
				/>
				{stats.popularSlot && (
					<Tile
						label="Mest populære hold"
						value={stats.popularSlot.time}
						detail={`${stats.popularSlot.classTitle}, ${lower(DA_WEEKDAYS[stats.popularSlot.weekday])} · ${plural(stats.popularSlot.users, "bruger", "brugere")}`}
					/>
				)}
			</SimpleGrid>
		</Section>
	);
}
