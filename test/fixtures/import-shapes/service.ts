export class PaymentService {
    calculate(amount: number): number {
        return amount * 100;
    }
}

export function formatAmount(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
}
