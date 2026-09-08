import { store } from "./store";
import type { Snapshot } from "./types";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const api = {
  async fetchSnapshot(): Promise<Snapshot> {
    await delay(60);
    return store.snapshot();
  },
  async createOrder(input: Parameters<typeof store.createOrder>[0]) {
    await delay(160);
    return store.createOrder(input);
  },
  async updateOrder(input: Parameters<typeof store.updateOrder>[0]) {
    await delay(160);
    return store.updateOrder(input);
  },
  async createCustomer(input: Parameters<typeof store.createCustomer>[0]) {
    await delay(160);
    return store.createCustomer(input);
  },
  async createBom(input: Parameters<typeof store.createBom>[0]) {
    await delay(160);
    return store.createBom(input);
  },
  async createInbound(input: Parameters<typeof store.createInbound>[0]) {
    await delay(160);
    return store.createInbound(input);
  },
  async createOutbound(input: Parameters<typeof store.createOutbound>[0]) {
    await delay(160);
    return store.createOutbound(input);
  },
  async upsertUser(input: Parameters<typeof store.upsertUser>[0]) {
    await delay(120);
    return store.upsertUser(input);
  },
  async setUserActive(input: { id: number; active: boolean }) {
    await delay(80);
    return store.setUserActive(input.id, input.active);
  },
};
