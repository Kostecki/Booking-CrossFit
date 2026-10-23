import {
	Alert,
	Button,
	Container,
	PasswordInput,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useState } from "react";

import { loginWithBookingBoard } from "#/server/auth.functions.ts";

export const Route = createFileRoute("/login")({
	beforeLoad: ({ context }) => {
		if (context.user && context.user.status !== "needs_reauth")
			throw redirect({ to: "/" });
	},
	component: Login,
});

function Login() {
	const router = useRouter();
	const login = useServerFn(loginWithBookingBoard);
	const [error, setError] = useState<string>();
	const [submitting, setSubmitting] = useState(false);

	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		setSubmitting(true);
		setError(undefined);
		try {
			const result = await login({
				data: {
					email: String(form.get("email")),
					password: String(form.get("password")),
				},
			});
			if (!result.ok) {
				setError(result.error);
				return;
			}
			await router.invalidate();
			await router.navigate({ to: "/" });
		} catch {
			setError("Noget gik galt. Prøv igen.");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Container size={420} py="xl">
			<form onSubmit={onSubmit}>
				<Stack>
					<Stack gap={2}>
						<Title order={2}>Auto CFR</Title>
						<Text>
							Booker automatisk dine faste hold hos CrossFit Roskilde.
						</Text>
					</Stack>
					<Text c="dimmed" size="sm">
						Log ind med samme email og adgangskode som i CrossFit
						Roskilde-appen.
					</Text>
					{error && <Alert color="red">{error}</Alert>}
					<TextInput
						name="email"
						type="email"
						label="Email"
						autoComplete="username"
						required
					/>
					<PasswordInput
						name="password"
						label="Adgangskode"
						autoComplete="current-password"
						required
					/>
					<Button type="submit" loading={submitting}>
						Log ind
					</Button>
				</Stack>
			</form>
		</Container>
	);
}
