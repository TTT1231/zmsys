import { authHandlers } from "./auth";
import { bomHandlers, customerHandlers, ledgerHandlers, orderHandlers } from "./business";
import { roleHandlers, userHandlers } from "./system";

export const handlers = [
    ...authHandlers,
    ...orderHandlers,
    ...customerHandlers,
    ...bomHandlers,
    ...ledgerHandlers,
    ...userHandlers,
    ...roleHandlers,
];
