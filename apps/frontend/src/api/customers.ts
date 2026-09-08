import type { CreateCustomerInput, Customer } from "./types";
import { requestClient } from "@/http";

export function fetchCustomers(): Promise<Customer[]> {
    return requestClient.get<Customer[]>("/customers");
}

export function createCustomer(input: CreateCustomerInput): Promise<Customer> {
    return requestClient.post<Customer>("/customers", input);
}
