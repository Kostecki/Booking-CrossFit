import { Button, Container, Stack, Text, Title } from "@mantine/core";
import { Link } from "@tanstack/react-router";

export function NotFound() {
	return (
		<Container size={420} py="xl">
			<Stack align="flex-start">
				<Title order={2}>Siden findes ikke</Title>
				<Text c="dimmed">Linket er forkert, eller siden er flyttet.</Text>
				<Button component={Link} to="/">
					Til forsiden
				</Button>
			</Stack>
		</Container>
	);
}
