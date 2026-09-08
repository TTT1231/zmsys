import { setupWorker } from "msw/browser";
import { handlers } from "./request";

export const worker = setupWorker(...handlers);
