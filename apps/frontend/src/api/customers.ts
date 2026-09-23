import type { CreateCustomerInput, Customer, CustomerPhone, UpdateCustomerInput } from "./types";
import { requestClient } from "@/http";
import { idempotencyConfig } from "./idempotency";

export function fetchCustomers(): Promise<Customer[]> {
    return requestClient.get<Customer[]>("/customers");
}

/** 获取完整手机号（仅超管或客户当前负责人；复制场景专用，取号后不回显） */
export function fetchCustomerPhone(code: string): Promise<CustomerPhone> {
    return requestClient.get<CustomerPhone>(`/customers/${code}/phone`);
}

export function createCustomer(input: CreateCustomerInput): Promise<Customer> {
    return requestClient.post<Customer>("/customers", input, idempotencyConfig());
}

/** 编辑客户档案（联系人/电话/行政区划/地址/付款条件/负责人；客户不可删除） */
export function updateCustomer(code: string, input: UpdateCustomerInput): Promise<Customer> {
    return requestClient.put<Customer>(`/customers/${code}`, input);
}
