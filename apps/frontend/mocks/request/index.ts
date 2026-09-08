import { authHandlers } from "./auth";
import { bomHandlers, customerHandlers, eventHandlers, ledgerHandlers, orderHandlers } from "./business";
import { roleHandlers, userHandlers } from "./system";

export const handlers = [
    ...authHandlers,
    ...orderHandlers,
    ...customerHandlers,
    ...bomHandlers,
    ...ledgerHandlers,
    ...eventHandlers,
    ...userHandlers,
    ...roleHandlers,
];
