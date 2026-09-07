import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export const wbKeys = {
  all: ["wb"] as const,
};

export function useWbSnapshot() {
  return useQuery({ queryKey: wbKeys.all, queryFn: api.fetchSnapshot });
}

function useWbMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: wbKeys.all }),
  });
}

export const useCreateOrder = () => useWbMutation(api.createOrder.bind(api));
export const useUpdateOrder = () => useWbMutation(api.updateOrder.bind(api));
export const useCreateCustomer = () => useWbMutation(api.createCustomer.bind(api));
export const useCreateCustomBom = () => useWbMutation(api.createCustomBom.bind(api));
export const useCreateInbound = () => useWbMutation(api.createInbound.bind(api));
export const useCreateOutbound = () => useWbMutation(api.createOutbound.bind(api));
