export const money = (amount: number) => new Intl.NumberFormat('en-CA', {style: 'currency', currency: 'CAD'}).format(amount);
