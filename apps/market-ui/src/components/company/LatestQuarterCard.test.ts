import { computeQuarterRows } from './LatestQuarterCard';

function check(name: string, cond: boolean) {
    if (!cond) throw new Error(`FAIL: ${name}`);
    console.log(`ok - ${name}`);
}

const metrics = [
    { metric: 'Revenue (Total Revenue, Net Sales)', value: 416161000000, period: 'FY2025' },
    { metric: 'Net Income (Net Earnings, Profit)', value: 112010000000, period: 'FY2025' },
    { metric: 'Earnings Per Share (EPS) Diluted', value: 7.46, period: 'FY2025' },
    { metric: 'Revenue (Total Revenue, Net Sales)', value: 400000000000, period: 'FY2024' },
    { metric: 'Net Income (Net Earnings, Profit)', value: 100000000000, period: 'FY2024' },
];

const out = computeQuarterRows(metrics)!;
check('picks newest period', out.latest === 'FY2025' && out.prior === 'FY2024');
check('revenue formatted + delta', out.rows[0].label === 'Revenue' && out.rows[0].cur === '$416.16B' && out.rows[0].delta !== null && Math.abs(out.rows[0].delta - 4.04) < 0.1);
check('eps rendered as dollars', out.rows.some(r => r.label === 'Diluted EPS' && r.cur === '$7.46' && r.delta === null));
check('empty metrics → null', computeQuarterRows([]) === null);

console.log('\nAll LatestQuarterCard checks passed.');
