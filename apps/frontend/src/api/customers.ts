import type { CreateCustomerInput, Customer, DeleteCustomerInput, UpdateCustomerInput } from "./types";
import { requestClient } from "@/http";
import { idempotencyConfig } from "./idempotency";

export function fetchCustomers(): Promise<Customer[]> {
    return requestClient.get<Customer[]>("/customers");
}

export function createCustomer(input: CreateCustomerInput): Promise<Customer> {
    return requestClient.post<Customer>("/customers", input, idempotencyConfig());
}

/** 编辑客户档案（联系人/电话/行政区划/地址/付款条件/负责人） */
export function updateCustomer(code: string, input: UpdateCustomerInput): Promise<Customer> {
    return requestClient.put<Customer>(`/customers/${code}`, input);
}

/** 删除客户档案（清理手误建档；仅无任何销售订单的客户可删） */
export function deleteCustomer(code: string, input: DeleteCustomerInput): Promise<null> {
    return requestClient.post<null>(`/customers/${code}/delete`, input, idempotencyConfig());
}
