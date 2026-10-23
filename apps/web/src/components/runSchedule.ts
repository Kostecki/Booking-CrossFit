import { getRouteApi } from "@tanstack/react-router";

const appRoute = getRouteApi("/_app");

/** The daily run times ("HH:MM", sorted), loaded once by the _app layout. */
export const useRunTimes = () => appRoute.useLoaderData().runTimes;
