import {
    PaymentService,
} from "./service.js";

export function checkout(amount: number): number {
    return new PaymentService().calculate(amount);
}
