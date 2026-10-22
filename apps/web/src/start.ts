import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

// Only state-changing requests need an origin check; page loads stay open.
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export const startInstance = createStart(() => ({
	requestMiddleware: [
		createCsrfMiddleware({
			filter: ({ request }) => !safeMethods.has(request.method),
		}),
	],
}));
