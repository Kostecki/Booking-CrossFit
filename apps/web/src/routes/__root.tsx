import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import {
	ColorSchemeScript,
	createTheme,
	MantineProvider,
	mantineHtmlProps,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { getCurrentUser } from "#/server/auth.functions.ts";

const theme = createTheme({ primaryColor: "orange" });

export const Route = createRootRoute({
	beforeLoad: async () => ({ user: await getCurrentUser() }),
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
			{ title: "CrossFit Booking" },
			{ name: "theme-color", content: "#fd7e14" },
			{ name: "apple-mobile-web-app-capable", content: "yes" },
			{ name: "apple-mobile-web-app-title", content: "Booking" },
			{ name: "apple-mobile-web-app-status-bar-style", content: "default" },
		],
		links: [
			{ rel: "manifest", href: "/manifest.webmanifest" },
			{ rel: "icon", type: "image/png", href: "/favicon.png" },
			{ rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
		],
	}),
	shellComponent: RootDocument,
});

function useServiceWorker() {
	useEffect(() => {
		if ("serviceWorker" in navigator) {
			navigator.serviceWorker.register("/sw.js").catch((error) => {
				console.error("Service worker registration failed", error);
			});
		}
	}, []);
}

function RootDocument({ children }: { children: ReactNode }) {
	useServiceWorker();
	return (
		<html lang="da" {...mantineHtmlProps}>
			<head>
				<ColorSchemeScript defaultColorScheme="auto" />
				<HeadContent />
			</head>
			<body>
				<MantineProvider theme={theme} defaultColorScheme="auto">
					<Notifications position="top-center" />
					{children}
				</MantineProvider>
				<Scripts />
			</body>
		</html>
	);
}
