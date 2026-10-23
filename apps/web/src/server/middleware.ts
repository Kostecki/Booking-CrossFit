import { createMiddleware } from "@tanstack/react-start";

import { requireUser } from "./session.ts";

// Adds the logged-in user to a server function's context, or rejects the call.
export const authMiddleware = createMiddleware({ type: "function" }).server(
	({ next }) => next({ context: { user: requireUser() } }),
);

// Like authMiddleware, but only for admins (users.is_admin).
export const adminMiddleware = createMiddleware({ type: "function" })
	.middleware([authMiddleware])
	.server(({ next, context: { user } }) => {
		if (!user.isAdmin) throw new Error("Forbidden");
		return next();
	});
