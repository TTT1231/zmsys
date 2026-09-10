import type { CreateCustomerInput, Customer, UpdateCustomerInput } from "./types";
import { requestClient } from "@/http";

export function fetchCustomers(): Promise<Customer[]> {
    return requestClient.get<Customer[]>("/customers");
}

export function createCustomer(input: CreateCustomerInput): Promise<Customer> {
    return requestClient.post<Customer>("/customers", input);
}

/** 编辑客户档案（联系人/电话/行政区划/地址/付款条件/负责人；客户不可删除） */
export function updateCustomer(code: string, input: UpdateCustomerInput): Promise<Customer> {
    return requestClient.put<Customer>(`/customers/${code}`, input);
}
